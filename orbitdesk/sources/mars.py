"""Curiosity's REMS weather station in Gale crater, via the feed behind NASA's Mars weather widget.

The data comes from Spain's Centro de Astrobiología (CAB). It usually runs a few
weeks behind real time, because the readings are processed before release.
Both URLs serve the same JSON: {"descriptions": {...}, "soles": [...]}, newest first,
every value a string and "--" for missing.
"""
from __future__ import annotations

from typing import Any

URLS = [
    "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json",
    "http://cab.inta-csic.es/rems/wp-content/plugins/marsweather-widget/api.php",
]


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _str(v: Any) -> str | None:
    v = (v or "").strip() if isinstance(v, str) else v
    return None if v in (None, "", "--") else v


def parse(raw: Any, keep: int = 14) -> list[dict]:
    sols = (raw or {}).get("soles") or []
    out = []
    for s in sols:
        sol = _num(s.get("sol"))
        if sol is None:
            continue
        out.append({
            "sol": int(sol),
            "date": _str(s.get("terrestrial_date")),
            "season": _str(s.get("season")),
            "ls": _num(s.get("ls")),
            "min_temp": _num(s.get("min_temp")),
            "max_temp": _num(s.get("max_temp")),
            "min_ground": _num(s.get("min_gts_temp")),
            "max_ground": _num(s.get("max_gts_temp")),
            "pressure": _num(s.get("pressure")),
            "sky": _str(s.get("atmo_opacity")),
            "uv": _str(s.get("local_uv_irradiance_index")),
            "sunrise": _str(s.get("sunrise")),
            "sunset": _str(s.get("sunset")),
        })
    out.sort(key=lambda r: r["sol"], reverse=True)
    # Keep sols that actually have temperatures.
    return [r for r in out if r["min_temp"] is not None or r["max_temp"] is not None][:keep]
