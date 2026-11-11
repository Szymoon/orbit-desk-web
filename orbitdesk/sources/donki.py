"""NASA DONKI: flares, CMEs and geomagnetic storms from the Moon to Mars Space Weather Analysis Office."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

BASE = "https://api.nasa.gov/DONKI"


def urls(api_key: str, now: datetime, days: int = 10) -> dict[str, str]:
    start = (now - timedelta(days=days)).strftime("%Y-%m-%d")
    end = now.strftime("%Y-%m-%d")
    q = f"startDate={start}&endDate={end}&api_key={api_key}"
    return {k: f"{BASE}/{k}?{q}" for k in ("FLR", "CME", "GST")}


def _t(s: str | None) -> str | None:
    if not s:
        return None
    s = s.rstrip("Z")
    return s + ("Z" if len(s) > 13 else ":00Z")


def _best_analysis(cme: dict) -> dict | None:
    an = cme.get("cmeAnalyses") or []
    for a in an:
        if a.get("isMostAccurate"):
            return a
    return an[-1] if an else None


def summarize(flr: Any, cme: Any, gst: Any, limit: int = 8) -> list[dict]:
    events: list[dict] = []
    for f in flr or []:
        region = f.get("activeRegionNum")
        where = ", ".join(x for x in (f"region {region}" if region else "", f.get("sourceLocation") or "") if x)
        events.append({
            "type": "flare",
            "t": _t(f.get("peakTime") or f.get("beginTime")),
            "title": f"{f.get('classType', '?')} flare",
            "detail": f"Peak {(_t(f.get('peakTime')) or '')[11:16]} UTC" + (f", {where}" if where else ""),
            "link": f.get("link"),
        })
    for c in cme or []:
        a = _best_analysis(c)
        speed = a.get("speed") if a else None
        arrivals = []
        for e in (a or {}).get("enlilList") or []:
            # estimatedShockArrivalTime is the modelled arrival at Earth; null when it misses.
            if e.get("estimatedShockArrivalTime"):
                arrivals.append(e["estimatedShockArrivalTime"])
        arrival = _t(sorted(arrivals)[0]) if arrivals else None
        if arrivals:
            detail = "Earth arrival estimated"
        elif a and a.get("enlilList"):
            detail = "No Earth arrival predicted"
        else:
            detail = c.get("note", "")[:120] or "Analysis pending"
        events.append({
            "type": "cme",
            "t": _t(c.get("startTime")),
            "title": f"CME, {int(speed)} km/s" if speed else "Coronal mass ejection",
            "detail": detail,
            "earth": bool(arrivals),
            "arrival": arrival,
            "link": c.get("link"),
        })
    for g in gst or []:
        kps = [k.get("kpIndex") for k in g.get("allKpValues") or [] if k.get("kpIndex") is not None]
        peak = max(kps) if kps else None
        events.append({
            "type": "storm",
            "t": _t(g.get("startTime")),
            "title": f"Geomagnetic storm, Kp {peak:g}" if peak is not None else "Geomagnetic storm",
            "detail": "Observed at Earth",
            "link": g.get("link"),
        })
    events = [e for e in events if e["t"]]
    events.sort(key=lambda e: e["t"], reverse=True)
    return events[:limit]
