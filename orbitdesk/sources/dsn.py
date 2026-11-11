"""JPL Deep Space Network Now feed (the same data behind eyes.nasa.gov/apps/dsn-now)."""
from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any

FEED_URL = "https://eyes.nasa.gov/dsn/data/dsn.xml"
CONFIG_URL = "https://eyes.nasa.gov/dsn/config.xml"

SITE_TZ = {"gdscc": "America/Los_Angeles", "mdscc": "Europe/Madrid", "cdscc": "Australia/Sydney"}
SITE_ORDER = ["gdscc", "mdscc", "cdscc"]
SITE_PLACE = {"gdscc": "California", "mdscc": "Spain", "cdscc": "Australia"}

# Friendlier short names where the official one is too long for the panel.
SHORT_NAMES = {
    "JWST": "Webb (JWST)", "MRO": "MRO (Mars orbiter)", "M20": "Perseverance", "MSL": "Curiosity",
    "SPP": "Parker Solar Probe", "LRO": "LRO (Moon orbiter)", "EMM": "Hope (Emirates Mars)",
    "TGO": "ExoMars TGO", "MVN": "MAVEN", "NHPC": "New Horizons", "EURC": "Europa Clipper",
    "ORX": "OSIRIS-APEX", "STA": "STEREO-A", "BEPI": "BepiColombo",
}

# Codes that mean "not a spacecraft": testing, maintenance, calibration.
NON_TARGETS = {"DSN", "TEST", "RSTS", "RFC", "DSS", "GBRA"}


def parse_config(xml_text: str) -> dict:
    root = ET.fromstring(xml_text)
    dishes, spacecraft = {}, {}
    for site in root.iter("site"):
        for d in site.iter("dish"):
            t = (d.get("type") or "").upper()
            size = "70 m" if t.startswith("70") else "34 m" if t.startswith("34") else t.lower()
            dishes[d.get("name", "").upper()] = {"friendly": d.get("friendlyName"), "size": size}
    for s in root.iter("spacecraft"):
        spacecraft[(s.get("name") or "").upper()] = s.get("friendlyName")
    return {"dishes": dishes, "spacecraft": spacecraft}


def _f(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_feed(xml_text: str, config: dict | None = None) -> dict:
    """Stations and dishes arrive as siblings; each dish belongs to the station above it."""
    config = config or {"dishes": {}, "spacecraft": {}}
    names = config.get("spacecraft", {})
    dish_info = config.get("dishes", {})
    root = ET.fromstring(xml_text)
    sites: dict[str, dict] = {}
    current = None
    for el in root:
        if el.tag == "station":
            key = el.get("name", "")
            current = sites.setdefault(key, {
                "id": key,
                "name": el.get("friendlyName") or key,
                "place": SITE_PLACE.get(key, ""),
                "tz": SITE_TZ.get(key, "UTC"),
                "dishes": [],
            })
        elif el.tag == "dish" and current is not None:
            current["dishes"].append(_parse_dish(el, names, dish_info))
    ordered = [sites[k] for k in SITE_ORDER if k in sites] + [v for k, v in sites.items() if k not in SITE_ORDER]
    return {"sites": ordered, "timestamp": root.find("timestamp").text if root.find("timestamp") is not None else None}


def _parse_dish(el: ET.Element, names: dict, dish_info: dict) -> dict:
    dname = el.get("name", "").upper()
    info = dish_info.get(dname, {})
    rtlt = {}
    for t in el.findall("target"):
        r = _f(t.get("rtlt"))
        if r and r > 0:
            rtlt[(t.get("name") or "").upper()] = r

    links: dict[str, dict] = {}

    def link(code: str) -> dict:
        return links.setdefault(code, {
            "code": code,
            "name": SHORT_NAMES.get(code) or names.get(code) or code,
            "up": False, "down": False,
            "down_rate": 0.0, "band": None,
            "rtlt_s": rtlt.get(code),
        })

    for s in el.findall("downSignal"):
        code = (s.get("spacecraft") or "").upper()
        if s.get("active") != "true" or not code or code in NON_TARGETS:
            continue
        L = link(code)
        L["down"] = True
        rate = _f(s.get("dataRate")) or 0.0
        if rate >= L["down_rate"]:
            L["down_rate"], L["band"] = rate, s.get("band")
    for s in el.findall("upSignal"):
        code = (s.get("spacecraft") or "").upper()
        if s.get("active") != "true" or not code or code in NON_TARGETS:
            continue
        L = link(code)
        L["up"] = True
        L["band"] = L["band"] or s.get("band")

    return {
        "name": info.get("friendly") or dname.replace("DSS", "DSS-"),
        "size": info.get("size", ""),
        "activity": el.get("activity") or "",
        "az": _f(el.get("azimuthAngle")),
        "el": _f(el.get("elevationAngle")),
        "links": list(links.values()),
    }
