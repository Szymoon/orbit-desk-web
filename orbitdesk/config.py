"""Settings loaded from config.toml, merged over sensible defaults."""
from __future__ import annotations

import copy
import os
import re
import tomllib
from pathlib import Path

DEFAULTS: dict = {
    "location": {
        "name": "Kraków",
        "short": "KRK",  # label for the status-bar clock
        "lat": 50.0614,
        "lon": 19.9366,
        "elevation_m": 220,
        "timezone": "Europe/Warsaw",
    },
    "nasa": {
        # Free key from https://api.nasa.gov. DEMO_KEY works but is limited to ~30 calls/hour.
        "api_key": "DEMO_KEY",
    },
    "aurora": {
        # Kp you typically need to see aurora from your latitude. ~7 for southern Poland.
        "kp_threshold": 7,
    },
    "iss": {
        # Anything that plays in an <iframe>, e.g. a YouTube embed URL of a live ISS Earth-view stream.
        "stream_url": "",
    },
    "sun": {
        # Tried in order; the freshest image wins.
        "image_urls": [
            "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0304.jpg",
            "https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png",
        ],
    },
    "gallery": {
        "queries": ["Webb nebula", "Webb galaxy", "Webb NIRCam", "Webb MIRI"],
        "year_start": 2022,
        # Skip photos of people and hardware that also mention Webb.
        "exclude_words": [
            "town hall", "engineer", "technician", "clean room", "cleanroom", "ceremony",
            "team", "administrator", "press", "visit", "mirror", "sunshield", "crane", "shipping",
        ],
        "rotate_minutes": 15,
    },
    "radio": {
        # One station per country. `search` is looked up in radio-browser.info;
        # leave it out to take that country's most-played station there;
        # set `url` to pin a stream and skip the lookup.
        "stations": [
            {"id": "pl", "country": "Poland", "countrycode": "PL", "tz": "Europe/Warsaw", "name": "RMF FM", "search": "RMF FM"},
            {"id": "jp", "country": "Japan", "countrycode": "JP", "tz": "Asia/Tokyo", "search": "NHK"},
            {"id": "us", "country": "USA", "countrycode": "US", "tz": "America/New_York"},
            {"id": "gb", "country": "United Kingdom", "countrycode": "GB", "tz": "Europe/London", "name": "BBC Radio 2", "search": "BBC Radio 2"},
            {"id": "nl", "country": "Netherlands", "countrycode": "NL", "tz": "Europe/Amsterdam", "name": "NPO Radio 2", "search": "NPO Radio 2"},
            {"id": "is", "country": "Iceland", "countrycode": "IS", "tz": "Atlantic/Reykjavik", "name": "Rás 2", "search": "Rás 2"},
            {"id": "za", "country": "South Africa", "countrycode": "ZA", "tz": "Africa/Johannesburg", "name": "Ukhozi FM", "search": "Ukhozi"},
        ],
    },
    "server": {
        "host": "127.0.0.1",
        "port": 8321,
        "data_dir": "data",
    },
    # Seconds between refreshes of each feed.
    "intervals": {
        "swpc": 120,
        "alerts": 300,
        "donki": 1800,
        "dsn": 10,
        "dsn_config": 86400,
        "tle": 21600,
        "sun_image": 900,
        "gallery_pool": 43200,
        "apod": 10800,
        "mars": 21600,
        "radio": 86400,
    },
}


# Colour themes. Every key is a CSS colour. In config.toml, [[themes]] entries
# replace this list (and set its order); an entry whose id matches a built-in
# one only needs the keys it changes. A new id starts from Solar's colours.
THEME_KEYS = ["bg", "panel", "line", "text", "muted", "accent", "accent2", "warn", "crit", "good", "land"]
BUILTIN_THEMES = [
    {"id": "solar", "name": "Solar", "bg": "#070B14", "panel": "#0E1524", "line": "#1E2A40", "text": "#E8ECF4",
     "muted": "#8591A8", "accent": "#F5A524", "accent2": "#45D0B0", "warn": "#FFC857", "crit": "#FF5A5F",
     "good": "#45D0B0", "land": "#16223A"},
    {"id": "night", "name": "Night red", "bg": "#070000", "panel": "#120303", "line": "#2C0907", "text": "#FF4A3D",
     "muted": "#A1322A", "accent": "#FF3B2F", "accent2": "#D8352A", "warn": "#FF3B2F", "crit": "#FF6A5E",
     "good": "#D8352A", "land": "#240606",
     "image_filter": "grayscale(1) sepia(1) hue-rotate(-50deg) saturate(4) brightness(.7)"},
    {"id": "day", "name": "Daylight", "light": True, "bg": "#E9EDF3", "panel": "#FFFFFF", "line": "#D3DAE5",
     "text": "#121826", "muted": "#5B6577", "accent": "#B35F00", "accent2": "#0B8069", "warn": "#B35F00",
     "crit": "#C62828", "good": "#0B8069", "land": "#DCE3EC"},
]
_SAFE = re.compile(r"^[#A-Za-z0-9(),.%\s-]{1,80}$")


def build_themes(user: list | None) -> list[dict]:
    builtin = {t["id"]: t for t in BUILTIN_THEMES}
    out = []
    for t in (user or BUILTIN_THEMES):
        if not isinstance(t, dict) or not t.get("id"):
            continue
        tid = str(t["id"])
        merged = {**builtin.get(tid, {**BUILTIN_THEMES[0], "name": tid}), **t, "id": tid}
        # keep only values that are safe to put into CSS
        for k in THEME_KEYS + ["image_filter"]:
            if k in merged and not _SAFE.match(str(merged[k])):
                merged[k] = builtin.get(tid, BUILTIN_THEMES[0]).get(k, BUILTIN_THEMES[0].get(k))
        out.append(merged)
    return out or BUILTIN_THEMES


def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def _read(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path, "rb") as fh:
        return tomllib.load(fh)


def load(path: str | os.PathLike | None = None) -> dict:
    """config.toml, then config.local.toml next to it (private, git-ignored), then env vars.

    Keep secrets such as the NASA key out of config.toml if the repo is public:
    put them in config.local.toml, or set NASA_API_KEY in the environment.
    """
    path = Path(path or os.environ.get("ORBITDESK_CONFIG", "config.toml"))
    user = _merge(_read(path), _read(path.with_name("config.local.toml")))
    cfg = _merge(DEFAULTS, user)
    if os.environ.get("NASA_API_KEY"):
        cfg["nasa"]["api_key"] = os.environ["NASA_API_KEY"].strip()
    cfg["themes"] = build_themes(user.get("themes"))
    # DEMO_KEY has a tight hourly quota; slow DONKI down so it stays inside it.
    if cfg["nasa"]["api_key"] == "DEMO_KEY":
        cfg["intervals"]["donki"] = max(cfg["intervals"]["donki"], 3 * 3600)
    return cfg
