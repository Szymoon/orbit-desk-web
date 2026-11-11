"""Minimize the panel window so the desktop underneath can be used.

The server runs as a service, outside the desktop session, so it has to find
the session's display itself. Tries, in order:
  1. wlrctl  (Wayland desktops: labwc, Wayfire) - minimizes the window
  2. xdotool (older X11 desktop)                - minimizes the window
  3. closing Chromium                           - always works; the desktop icon reopens it
The panel's window is found by its title, "Orbit Desk".
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess

TITLE = "Orbit Desk"


def _session_env() -> dict:
    env = dict(os.environ)
    run = f"/run/user/{os.getuid()}"
    env.setdefault("XDG_RUNTIME_DIR", run)
    socks = sorted(p for p in glob.glob(f"{run}/wayland-*") if not p.endswith(".lock"))
    if socks and "WAYLAND_DISPLAY" not in env:
        env["WAYLAND_DISPLAY"] = os.path.basename(socks[0])
    env.setdefault("DISPLAY", ":0")
    return env


def _run(cmd: list[str], env: dict) -> bool:
    try:
        return subprocess.run(cmd, env=env, timeout=5, capture_output=True).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def minimize() -> str:
    env = _session_env()
    if shutil.which("wlrctl") and env.get("WAYLAND_DISPLAY"):
        if _run(["wlrctl", "toplevel", "minimize", f"title:{TITLE}"], env):
            return "minimized"
    if shutil.which("xdotool"):
        if _run(["xdotool", "search", "--name", TITLE, "windowminimize"], env):
            return "minimized"
    _run(["pkill", "-f", "orbitdesk-profile"], env)
    return "closed"
