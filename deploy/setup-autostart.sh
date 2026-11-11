#!/usr/bin/env bash
# Makes the desktop open the panel at login. Safe to run again.
# Registers kiosk.sh with every desktop Raspberry Pi OS has used:
#   labwc (current), Wayfire (early Bookworm), LXDE on X11 (older), plus the XDG autostart folder.
# kiosk.sh holds a lock, so being started twice opens only one window.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
KIOSK="$DIR/deploy/kiosk.sh"
chmod +x "$KIOSK"
# Files copied from Windows can carry CRLF line endings, which break bash scripts.
sed -i 's/\r$//' "$KIOSK" "$DIR/deploy/"*.sh

add_line() {  # add_line <file> <line>: append once
  grep -qxF "$2" "$1" 2>/dev/null || echo "$2" >> "$1"
}

# 1. XDG autostart (used by LXDE, and by labwc/Wayfire on some images)
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/orbitdesk-kiosk.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Orbit Desk
Exec=$KIOSK
X-GNOME-Autostart-enabled=true
DESK
echo "    XDG autostart entry written"

# 2. labwc. A user autostart file replaces the system one, so start from a copy of it
#    to keep the normal desktop and taskbar.
if command -v labwc >/dev/null || [ -d /etc/xdg/labwc ]; then
  mkdir -p "$HOME/.config/labwc"
  f="$HOME/.config/labwc/autostart"
  if [ ! -f "$f" ] && [ -f /etc/xdg/labwc/autostart ]; then cp /etc/xdg/labwc/autostart "$f"; fi
  add_line "$f" "$KIOSK &"
  echo "    labwc: added to $f"
fi

# 3. Wayfire
if [ -f "$HOME/.config/wayfire.ini" ]; then
  f="$HOME/.config/wayfire.ini"
  if ! grep -q "orbitdesk" "$f"; then
    if grep -q '^\[autostart\]' "$f"; then
      sed -i "/^\[autostart\]/a orbitdesk = $KIOSK" "$f"
    else
      printf '\n[autostart]\norbitdesk = %s\n' "$KIOSK" >> "$f"
    fi
  fi
  echo "    Wayfire: added to $f"
fi

# 4. LXDE on X11. Same rule: copy the system file first.
if [ -d /etc/xdg/lxsession/LXDE-pi ]; then
  mkdir -p "$HOME/.config/lxsession/LXDE-pi"
  f="$HOME/.config/lxsession/LXDE-pi/autostart"
  if [ ! -f "$f" ] && [ -f /etc/xdg/lxsession/LXDE-pi/autostart ]; then cp /etc/xdg/lxsession/LXDE-pi/autostart "$f"; fi
  add_line "$f" "@$KIOSK"
  echo "    LXDE: added to $f"
fi

# 5. An "Orbit Desk" icon on the desktop and in the menu: reopens or restores the panel.
LAUNCHER="[Desktop Entry]
Type=Application
Name=Orbit Desk
Comment=Open the space panel
Exec=$KIOSK
Icon=applications-science
Terminal=false
Categories=Education;Science;"
mkdir -p "$HOME/.local/share/applications"
echo "$LAUNCHER" > "$HOME/.local/share/applications/orbitdesk.desktop"
if [ -d "$HOME/Desktop" ]; then
  echo "$LAUNCHER" > "$HOME/Desktop/orbitdesk.desktop"
  chmod +x "$HOME/Desktop/orbitdesk.desktop"
fi
echo "    Orbit Desk icon added to the menu (and the desktop)"

# The panel can only open if the desktop logs in by itself.
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_boot_behaviour B4 2>/dev/null && echo "    Desktop auto-login on" \
    || echo "    Turn on auto-login: raspi-config > System Options > Boot / Auto Login > Desktop Autologin"
fi
