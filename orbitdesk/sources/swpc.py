"""NOAA Space Weather Prediction Center feeds (no API key needed).

Formats verified against the live service in September 2026. SWPC has changed
some products from "array of arrays with a header row" to "array of objects",
so every parser here accepts both.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

BASE = "https://services.swpc.noaa.gov"
URLS = {
    "kp": f"{BASE}/products/noaa-planetary-k-index.json",
    "kp_forecast": f"{BASE}/products/noaa-planetary-k-index-forecast.json",
    "xray": f"{BASE}/json/goes/primary/xrays-1-day.json",
    "wind": f"{BASE}/json/rtsw/rtsw_wind_1m.json",
    "mag": f"{BASE}/json/rtsw/rtsw_mag_1m.json",
    "alerts": f"{BASE}/products/alerts.json",
}

UTC = timezone.utc


# ---------------------------------------------------------------- helpers
def parse_time(s: str) -> datetime:
    s = s.strip().replace(" ", "T").rstrip("Z")
    if "." in s:
        s = s.split(".")[0]
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def rows(raw: Any) -> list[dict]:
    """Normalise SWPC JSON to a list of dicts, whatever shape it arrives in."""
    if isinstance(raw, list) and raw and isinstance(raw[0], list):
        header = [str(h) for h in raw[0]]
        return [dict(zip(header, r)) for r in raw[1:]]
    if isinstance(raw, list):
        return [r for r in raw if isinstance(r, dict)]
    return []


def num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f


def g_scale(kp: float | None) -> int:
    """NOAA G-scale from Kp. Kp 5- (4.67) already counts as G1."""
    if kp is None:
        return 0
    for level, need in ((5, 9), (4, 8), (3, 7), (2, 6), (1, 5)):
        if kp >= need - 0.34:
            return level
    return 0


def flare_class(flux: float | None) -> str:
    """GOES 0.1-0.8 nm flux (W/m²) to a flare class like 'M2.1'."""
    if not flux or flux <= 0:
        return "–"
    for letter, base in (("X", 1e-4), ("M", 1e-5), ("C", 1e-6), ("B", 1e-7)):
        if flux >= base:
            return f"{letter}{flux / base:.1f}"
    return f"A{flux / 1e-8:.1f}"


def r_scale(flux: float | None) -> int:
    if not flux:
        return 0
    for level, need in ((5, 2e-3), (4, 1e-3), (3, 1e-4), (2, 5e-5), (1, 1e-5)):
        if flux >= need:
            return level
    return 0


# ---------------------------------------------------------------- Kp
def parse_kp(raw: Any) -> list[dict]:
    out = []
    for r in rows(raw):
        kp = num(r.get("Kp", r.get("kp")))
        if kp is None or not r.get("time_tag"):
            continue
        out.append({"t": iso(parse_time(r["time_tag"])), "kp": kp})
    return sorted(out, key=lambda x: x["t"])


def parse_kp_forecast(raw: Any) -> list[dict]:
    out = []
    for r in rows(raw):
        kp = num(r.get("kp", r.get("Kp")))
        if kp is None or not r.get("time_tag"):
            continue
        out.append({
            "t": iso(parse_time(r["time_tag"])),
            "kp": kp,
            "kind": str(r.get("observed") or "predicted"),
        })
    return sorted(out, key=lambda x: x["t"])


def kp_window(forecast: list[dict], now: datetime) -> list[dict]:
    """24 three-hour bars: the last 8 that have started, then 16 ahead."""
    if not forecast:
        return []
    started = [i for i, r in enumerate(forecast) if parse_time(r["t"]) <= now]
    i = started[-1] if started else 0
    lo = max(0, i - 7)
    return forecast[lo:lo + 24]


# ---------------------------------------------------------------- X-rays
def parse_xray(raw: Any) -> list[dict]:
    """Long-channel (0.1-0.8 nm) flux, oldest first."""
    seen: dict[str, float] = {}
    for r in rows(raw):
        if r.get("energy") != "0.1-0.8nm":
            continue
        f = num(r.get("flux"))
        if f is None or f <= 0 or not r.get("time_tag"):
            continue
        seen[iso(parse_time(r["time_tag"]))] = f
    return [{"t": t, "flux": f} for t, f in sorted(seen.items())]


def summarize_xray(series: list[dict], now: datetime, buckets: int = 288) -> dict:
    if not series:
        return {"current": None, "series": []}
    day_ago = now - timedelta(hours=24)
    last = [r for r in series if parse_time(r["t"]) >= day_ago] or series
    peak = max(last, key=lambda r: r["flux"])
    three_h = [r for r in series if parse_time(r["t"]) >= now - timedelta(hours=3)]
    peak3 = max(three_h, key=lambda r: r["flux"]) if three_h else None
    cur = series[-1]

    # Downsample to one max-value point per 5 minutes for the chart.
    step = 86400 / buckets
    binned: dict[int, dict] = {}
    for r in last:
        k = int((parse_time(r["t"]) - day_ago).total_seconds() // step)
        if k not in binned or r["flux"] > binned[k]["flux"]:
            binned[k] = r
    return {
        "current": {"t": cur["t"], "flux": cur["flux"], "class": flare_class(cur["flux"])},
        "peak_24h": {"t": peak["t"], "flux": peak["flux"], "class": flare_class(peak["flux"])},
        "peak_3h": ({"t": peak3["t"], "flux": peak3["flux"], "class": flare_class(peak3["flux"]),
                     "r": r_scale(peak3["flux"])} if peak3 else None),
        "series": [binned[k] for k in sorted(binned)],
    }


# ---------------------------------------------------------------- solar wind
def _active_rows(raw: Any) -> list[dict]:
    """RTSW files hold several spacecraft (DSCOVR, ACE, IMAP); keep the active one."""
    rs = [r for r in rows(raw) if r.get("time_tag")]
    act = [r for r in rs if r.get("active") is True]
    use = act or rs
    return sorted(use, key=lambda r: r["time_tag"])


def _mean(vals: Iterable[float | None]) -> float | None:
    v = [x for x in vals if x is not None]
    return sum(v) / len(v) if v else None


def summarize_wind(wind_raw: Any, mag_raw: Any, now: datetime) -> dict:
    wind = _active_rows(wind_raw)
    mag = _active_rows(mag_raw)
    hour = now - timedelta(hours=1)

    def recent(rs):
        return [r for r in rs if parse_time(r["time_tag"]) >= hour]

    def latest(rs, key):
        for r in reversed(rs):
            v = num(r.get(key))
            if v is not None:
                return v, r
        return None, None

    speed, wr = latest(wind, "proton_speed")
    dens, _ = latest(wind, "proton_density")
    bz, mr = latest(mag, "bz_gsm")
    bt, _ = latest(mag, "bt")
    w1, m1 = recent(wind), recent(mag)
    mean_speed = _mean(num(r.get("proton_speed")) for r in w1)
    travel_h = (149_597_870.7 / (mean_speed or speed)) / 3600 if (mean_speed or speed) else None

    # 10-minute means over the last day, for sparklines.
    spark = []
    day = now - timedelta(hours=24)
    bins: dict[int, list[float]] = {}
    for r in wind:
        t = parse_time(r["time_tag"])
        v = num(r.get("proton_speed"))
        if t >= day and v is not None:
            bins.setdefault(int((t - day).total_seconds() // 600), []).append(v)
    for k in sorted(bins):
        spark.append(round(sum(bins[k]) / len(bins[k]), 1))

    return {
        "t": (wr or mr or {}).get("time_tag"),
        "source": (wr or {}).get("source"),
        "speed": speed,
        "density": dens,
        "bz": bz,
        "bt": bt,
        "speed_1h": mean_speed,
        "density_1h": _mean(num(r.get("proton_density")) for r in w1),
        "bz_1h": _mean(num(r.get("bz_gsm")) for r in m1),
        "bt_1h": _mean(num(r.get("bt")) for r in m1),
        "sun_earth_hours": travel_h,
        "speed_spark": spark,
    }


# ---------------------------------------------------------------- alerts
_HEAD = re.compile(
    r"^(EXTENDED WARNING|CONTINUED ALERT|WARNING|ALERT|WATCH|SUMMARY|CANCEL(?:LATION)?[A-Z ]*?):\s*(.+?)\s*$",
    re.M,
)


def parse_alerts(raw: Any) -> list[dict]:
    out = []
    for r in rows(raw):
        msg = str(r.get("message", "")).replace("\r\n", "\n")
        m = _HEAD.search(msg)
        kind, title = (m.group(1).title(), m.group(2)) if m else ("Notice", "Space weather message")
        issued = r.get("issue_datetime")
        try:
            issued = iso(parse_time(issued)) if issued else None
        except ValueError:
            issued = None
        scale = re.search(r"NOAA Scale:\s*(.+)", msg)
        out.append({
            "id": r.get("product_id"),
            "issued": issued,
            "kind": kind,
            "title": title,
            "scale": scale.group(1).strip() if scale else None,
            "message": msg.strip(),
        })
    return sorted(out, key=lambda a: a["issued"] or "", reverse=True)


# ---------------------------------------------------------------- banner
def banner(kp_latest: float | None, xray: dict, alerts: list[dict], now: datetime) -> dict | None:
    """The one thing worth shouting about in the status bar, if anything."""
    g = g_scale(kp_latest)
    if g:
        return {"level": "crit" if g >= 3 else "warn", "text": f"G{g} geomagnetic storm · Kp {kp_latest:.1f}",
                "go": "sun"}
    p3 = (xray or {}).get("peak_3h")
    if p3 and p3.get("r"):
        return {"level": "crit" if p3["r"] >= 3 else "warn",
                "text": f"R{p3['r']} radio blackout · {p3['class']} flare", "go": "sun"}
    for a in alerts:
        if not a["issued"]:
            continue
        if now - parse_time(a["issued"]) > timedelta(hours=12):
            break
        if a["kind"] in ("Watch", "Warning", "Extended Warning"):
            return {"level": "warn", "text": short_alert(a), "go": "sun"}
    return None


def short_alert(a: dict) -> str:
    """'WATCH: Geomagnetic Storm Category G1 Predicted' -> 'G1 storm watch'."""
    kind = a["kind"].lower()
    m = re.search(r"Category\s+([GRS]\d)", a["title"])
    if m:
        what = {"G": "storm", "R": "radio blackout", "S": "radiation storm"}[m.group(1)[0]]
        return f"{m.group(1)} {what} {kind}"
    m = re.search(r"K-index of (\d)", a["title"])
    if m:
        return f"K-index {m.group(1)} {kind}"
    return f"{a['kind']}: {a['title']}"[:48]


def aurora_verdict(window: list[dict], now: datetime, threshold: float) -> dict:
    ahead = [r for r in window if now - timedelta(hours=3) <= parse_time(r["t"]) <= now + timedelta(hours=24)]
    peak = max((r["kp"] for r in ahead), default=None)
    if peak is None:
        return {"peak": None, "level": "unknown", "text": "No forecast"}
    if peak >= threshold - 0.34:
        return {"peak": peak, "level": "go", "text": "Possible tonight"}
    if peak >= threshold - 1.34:
        return {"peak": peak, "level": "watch", "text": "Worth a look north"}
    return {"peak": peak, "level": "no", "text": "Unlikely tonight"}
