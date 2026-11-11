#!/usr/bin/env bash
# Opens the panel full screen in Chromium once the local server answers.
# Log: ~/.cache/orbitdesk-kiosk.log
URL="http://127.0.0.1:${ORBITDESK_PORT:-8321}/?kiosk"
PROFILE="$HOME/.config/orbitdesk-profile"
LOG="$HOME/.cache/orbitdesk-kiosk.log"
mkdir -p "$HOME/.cache"
exec >>"$LOG" 2>&1
echo "=== $(date '+%F %T') kiosk.sh started (session: ${XDG_SESSION_TYPE:-?}, display: ${WAYLAND_DISPLAY:-${DISPLAY:-none}})"

# Only one copy at a time, even if several autostart mechanisms fire.
exec 9>"/tmp/orbitdesk-kiosk-$(id -u).lock"
flock -n 9 || { echo "another kiosk.sh is running, exiting"; exit 0; }

for i in $(seq 90); do
  curl -fs -o /dev/null "$URL" && { echo "server answered after ${i}s"; break; }
  sleep 1
done

if pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null; then
  # Already running (maybe minimized): bring the window back to the front.
  wlrctl toplevel focus "title:Orbit Desk" 2>/dev/null \
    || xdotool search --name "Orbit Desk" windowactivate 2>/dev/null \
    || true
  echo "panel already open, brought to front"; exit 0
fi

BROWSER="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$BROWSER" ]; then echo "Chromium not found"; exit 1; fi
echo "starting $BROWSER"
exec "$BROWSER" \
  --kiosk "$URL" \
  --user-data-dir="$PROFILE" \
  --noerrdialogs --disable-infobars --no-first-run \
  --disable-session-crashed-bubble --disable-features=Translate \
  --overscroll-history-navigation=0 --disable-pinch \
  --password-store=basic --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required
