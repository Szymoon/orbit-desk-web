#!/usr/bin/env bash
# Orbit Desk installer for Raspberry Pi OS (Bookworm or newer, with desktop).
# Run from the project folder:  ./deploy/install.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(id -un)"
echo "Installing Orbit Desk from $DIR for user $USER_NAME"

echo "==> System packages"
sudo apt-get update
sudo apt-get install -y python3-venv python3-pip curl
# window tools for the Minimize button (either may be missing on some images; that's fine)
sudo apt-get install -y wlrctl || true
sudo apt-get install -y xdotool || true
command -v chromium >/dev/null || command -v chromium-browser >/dev/null || \
  sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser

echo "==> Python environment"
python3 -m venv "$DIR/.venv"
"$DIR/.venv/bin/pip" install --upgrade pip
"$DIR/.venv/bin/pip" install -r "$DIR/requirements.txt"

if [ ! -f "$DIR/config.toml" ]; then
  cp "$DIR/config.example.toml" "$DIR/config.toml"
  echo "    Created config.toml."
fi
if [ ! -f "$DIR/config.local.toml" ]; then
  printf '# Private settings for this Pi (git-ignored). Overrides config.toml.\n[nasa]\napi_key = "DEMO_KEY"\n' > "$DIR/config.local.toml"
  echo "    Created config.local.toml. Put your NASA API key there."
fi

echo "==> Background service"
sudo tee /etc/systemd/system/orbitdesk.service >/dev/null <<UNIT
[Unit]
Description=Orbit Desk space dashboard server
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$DIR
ExecStart=$DIR/.venv/bin/python -m orbitdesk --config $DIR/config.toml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now orbitdesk.service

echo "==> Kiosk autostart"
bash "$DIR/deploy/setup-autostart.sh"

echo "==> Keep the screen on"
sudo raspi-config nonint do_blanking 1 2>/dev/null || echo "    (turn off Screen Blanking in raspi-config > Display Options)"

echo
echo "Done. Check the server:  curl -s localhost:8321/api/status"
echo "Reboot to start the panel full screen:  sudo reboot"
