"""ISS position, ground track and passes, computed on the Pi with Skyfield.

Only the orbital elements (TLE) come from the internet, once every few hours;
everything else is computed locally, so the tracker keeps working offline.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import numpy as np
from skyfield.api import EarthSatellite, Loader, wgs84

TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"

_loader = None
_ts = None
_eph = None


def _init():
    global _loader, _ts, _eph
    if _ts is None:
        from skyfield_data import get_skyfield_data_path  # ships de421.bsp, no download needed
        _loader = Loader(get_skyfield_data_path(), expire=False)
        _ts = _loader.timescale(builtin=True)
        _eph = _loader("de421.bsp")
    return _ts, _eph


def parse_tle(text: str) -> dict:
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    l1 = next(i for i, ln in enumerate(lines) if ln.startswith("1 "))
    name = lines[l1 - 1] if l1 > 0 else "ISS (ZARYA)"
    if not lines[l1 + 1].startswith("2 "):
        raise ValueError("TLE line 2 missing")
    return {"name": name, "line1": lines[l1], "line2": lines[l1 + 1]}


def _compass(az: float) -> str:
    pts = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return pts[int((az % 360) / 45 + 0.5) % 8]


class Tracker:
    def __init__(self, tle: dict, home: dict):
        ts, self.eph = _init()
        self.ts = ts
        self.sat = EarthSatellite(tle["line1"], tle["line2"], tle["name"], ts)
        self.home = wgs84.latlon(home["lat"], home["lon"], elevation_m=home.get("elevation_m", 0))
        self.home_ll = (home["lat"], home["lon"])
        self.epoch = self.sat.epoch.utc_datetime()

    # ---- now + track ----------------------------------------------------
    def now(self, when: datetime | None = None) -> dict:
        when = when or datetime.now(timezone.utc)
        t = self.ts.from_datetime(when)
        g = self.sat.at(t)
        sp = wgs84.subpoint_of(g)
        height = wgs84.height_of(g).km
        speed = float(np.linalg.norm(g.velocity.km_per_s)) * 3600
        alt, az, dist = (self.sat - self.home).at(t).altaz()
        sunlit = bool(g.is_sunlit(self.eph))

        # Ground track: one orbit back, one ahead, one point per minute.
        mins = np.arange(-93, 94, 1.0)
        tt = self.ts.from_datetimes([when + timedelta(minutes=float(m)) for m in mins])
        gs = self.sat.at(tt)
        tr = wgs84.subpoint_of(gs)
        track = [[round(float(a), 2), round(float(o), 2), int(m)] for a, o, m in
                 zip(tr.latitude.degrees, tr.longitude.degrees, mins)]
        return {
            "t": when.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "lat": round(sp.latitude.degrees, 3),
            "lon": round(sp.longitude.degrees, 3),
            "alt_km": round(height, 1),
            "speed_kmh": round(speed),
            "sunlit": sunlit,
            "home_alt_deg": round(alt.degrees, 1),
            "home_range_km": round(dist.km),
            "ground_km_to_home": round(_great_circle(sp.latitude.degrees, sp.longitude.degrees, *self.home_ll)),
            "tle_age_h": round((when - self.epoch).total_seconds() / 3600, 1),
            "track": track,
        }

    # ---- passes ---------------------------------------------------------
    def passes(self, days: float = 3, min_alt: float = 10, when: datetime | None = None) -> list[dict]:
        when = when or datetime.now(timezone.utc)
        t0 = self.ts.from_datetime(when)
        t1 = self.ts.from_datetime(when + timedelta(days=days))
        times, kinds = self.sat.find_events(self.home, t0, t1, altitude_degrees=min_alt)
        sun, earth = self.eph["sun"], self.eph["earth"]
        observer = earth + self.home
        out, cur = [], None
        for t, k in zip(times, kinds):
            if k == 0:
                cur = {"rise": t}
            elif k == 1 and cur is not None:
                cur["peak"] = t
            elif k == 2 and cur is not None and "peak" in cur:
                cur["set"] = t
                out.append(self._describe(cur, sun, observer))
                cur = None
        return out

    def _describe(self, p: dict, sun, observer) -> dict:
        topo = self.sat - self.home
        alt_peak, _, _ = topo.at(p["peak"]).altaz()
        _, az_rise, _ = topo.at(p["rise"]).altaz()
        _, az_set, _ = topo.at(p["set"]).altaz()
        sun_alt = observer.at(p["peak"]).observe(sun).apparent().altaz()[0].degrees
        lit = bool(self.sat.at(p["peak"]).is_sunlit(self.eph))
        rise = p["rise"].utc_datetime()
        return {
            "start": rise.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "duration_s": int((p["set"].utc_datetime() - rise).total_seconds()),
            "max_alt": int(round(float(alt_peak.degrees))),
            "from": _compass(az_rise.degrees),
            "to": _compass(az_set.degrees),
            # Visible to the eye: ISS in sunlight while your sky is dark.
            "visible": bool(lit and sun_alt < -6),
        }


def _great_circle(a1: float, o1: float, a2: float, o2: float) -> float:
    p1, p2, dl = math.radians(a1), math.radians(a2), math.radians(o2 - o1)
    c = math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl)
    return 6371.0 * math.acos(max(-1.0, min(1.0, c)))
