"""The JSON the panel reads, built from the cache.

Used by the Pi server (app.py). The website version builds the same shapes
in the browser (docs/web.js).
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

from . import config as config_mod
from .cache import Store
from .sources import swpc

# How old each feed may get before the panel marks it stale (seconds).
STALE_AFTER = {"swpc": 900, "alerts": 1800, "dsn": 120, "tle": 3 * 86400, "sun_image": 6 * 3600,
               "donki": 12 * 3600, "gallery_current": 6 * 3600, "apod": 36 * 3600,
               "mars": 3 * 86400, "radio": 3 * 86400}


def entry(store: Store, name: str) -> dict:
    e = store.get(name)
    return {"fetched_at": e["fetched_at"] if e else None, "data": e["data"] if e else None}


def public_config(cfg: dict, demo: bool = False) -> dict:
    return {
        "location": cfg["location"],
        "aurora_kp_threshold": cfg["aurora"]["kp_threshold"],
        "iss_stream_url": cfg["iss"]["stream_url"],
        "themes": cfg.get("themes") or config_mod.build_themes(None),
        "gallery_rotate_minutes": cfg["gallery"]["rotate_minutes"],
        "site": cfg.get("site", {}),
        "demo": demo,
    }


def spaceweather(cfg: dict, store: Store, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    kp = store.data("kp") or []
    fc = store.data("kp_forecast") or []
    xray = store.data("xray") or {}
    alerts = store.data("alerts") or []
    latest = kp[-1] if kp else None
    window = swpc.kp_window(fc, now)
    return {
        "kp": {
            "latest": latest,
            "g": swpc.g_scale(latest["kp"]) if latest else 0,
            "window": window,
            "fetched_at": (store.get("kp") or {}).get("fetched_at"),
        },
        "aurora": swpc.aurora_verdict(window, now, cfg["aurora"]["kp_threshold"]),
        "xray": {**xray, "fetched_at": (store.get("xray") or {}).get("fetched_at")},
        "wind": {**(store.data("wind") or {}), "fetched_at": (store.get("wind") or {}).get("fetched_at")},
        "alerts": alerts[:5],
        "banner": swpc.banner(latest["kp"] if latest else None, xray, alerts, now),
        "sun_image": store.data("sun_image"),
    }


def status(store: Store, demo: bool = False) -> dict:
    """Feed health, with `fetched_at` + `limit_s` so the page can recheck staleness later."""
    now = time.time()
    feeds = {}
    for name, limit in STALE_AFTER.items():
        e = store.get("kp" if name == "swpc" else name)
        age = now - e["fetched_at"] if e else None
        st = store.status.get(name, {})
        feeds[name] = {"age_s": round(age) if age is not None else None,
                       "fetched_at": e["fetched_at"] if e else None,
                       "limit_s": limit,
                       "stale": age is None or age > limit,
                       "error": st.get("error")}
    return {"feeds": feeds, "demo": demo, "server_time": now}
