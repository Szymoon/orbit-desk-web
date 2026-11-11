"""Demo mode: realistic sample feeds, pushed through the real parsers.

Handy for working on the frontend without internet, and for the tests.
Raw formats match the live services as checked in September 2026.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone

from .cache import Store
from .sources import donki, dsn, gallery, iss, mars, radio, swpc

DSN_CONFIG = """<?xml version="1.0" encoding="UTF-8"?><config><sites>
<site name="gdscc" friendlyName="Goldstone"><dish name="DSS14" friendlyName="DSS 14" type="70M"/><dish name="DSS24" friendlyName="DSS 24" type="34M"/><dish name="DSS26" friendlyName="DSS 26" type="34M"/></site>
<site name="mdscc" friendlyName="Madrid"><dish name="DSS63" friendlyName="DSS 63" type="70M"/><dish name="DSS56" friendlyName="DSS 56" type="34M"/><dish name="DSS54" friendlyName="DSS 54" type="34M"/></site>
<site name="cdscc" friendlyName="Canberra"><dish name="DSS43" friendlyName="DSS 43" type="70M"/><dish name="DSS36" friendlyName="DSS 36" type="34M"/><dish name="DSS35" friendlyName="DSS 35" type="34M"/></site>
</sites><spacecraftMap>
<spacecraft name="mro" friendlyName="Mars Reconnaissance Orbiter"/><spacecraft name="jno" friendlyName="Juno"/>
<spacecraft name="vgr1" friendlyName="Voyager 1"/><spacecraft name="vgr2" friendlyName="Voyager 2"/>
<spacecraft name="jwst" friendlyName="James Webb Space Telescope"/><spacecraft name="m20" friendlyName="Mars 2020"/>
<spacecraft name="psyc" friendlyName="Psyche"/><spacecraft name="mex" friendlyName="Mars Express"/>
</spacecraftMap></config>"""

DSN_FEED = """<dsn>
<station name="gdscc" friendlyName="Goldstone" timeUTC="0" timeZoneOffset="-25200000.0"/>
<dish name="DSS14" azimuthAngle="140" elevationAngle="41" isMSPA="false" activity="Spacecraft Telemetry, Tracking, and Command">
 <downSignal active="true" signalType="data" dataRate="18000" band="X" spacecraft="JNO" spacecraftID="-61"/>
 <target name="JNO" id="61" uplegRange="8.8e8" downlegRange="8.8e8" rtlt="5876"/></dish>
<dish name="DSS26" azimuthAngle="246" elevationAngle="38" isMSPA="true" activity="Spacecraft Telemetry, Tracking, and Command">
 <upSignal active="true" signalType="data" dataRate="0" band="X" power="4.9" spacecraft="MRO" spacecraftID="-74"/>
 <downSignal active="true" signalType="data" dataRate="1500000" band="X" spacecraft="MRO" spacecraftID="-74"/>
 <downSignal active="true" signalType="data" dataRate="174800" band="X" spacecraft="MEX" spacecraftID="-41"/>
 <target name="MRO" id="74" rtlt="1706"/><target name="MEX" id="41" rtlt="1706"/></dish>
<dish name="DSS24" azimuthAngle="0" elevationAngle="90" activity="Engineering Upgrades"><target name="DSN" id="99" rtlt="-1"/></dish>
<station name="mdscc" friendlyName="Madrid" timeUTC="0" timeZoneOffset="7200000.0"/>
<dish name="DSS63" azimuthAngle="200" elevationAngle="30" activity="Spacecraft Telemetry, Tracking, and Command">
 <downSignal active="true" signalType="data" dataRate="160" band="X" spacecraft="VGR1" spacecraftID="-31"/>
 <target name="VGR1" id="31" rtlt="168480"/></dish>
<dish name="DSS56" azimuthAngle="110" elevationAngle="52" activity="Spacecraft Telemetry, Tracking, and Command">
 <downSignal active="true" signalType="data" dataRate="28000000" band="Ka" spacecraft="JWST" spacecraftID="-170"/>
 <target name="JWST" id="170" rtlt="10.2"/></dish>
<dish name="DSS54" azimuthAngle="95" elevationAngle="22" activity="Spacecraft Telemetry, Tracking, and Command">
 <upSignal active="true" signalType="data" dataRate="2000" band="X" spacecraft="M20" spacecraftID="-168"/>
 <target name="M20" id="168" rtlt="1706"/></dish>
<station name="cdscc" friendlyName="Canberra" timeUTC="0" timeZoneOffset="36000000.0"/>
<dish name="DSS43" azimuthAngle="80" elevationAngle="60" activity="Spacecraft Telemetry, Tracking, and Command">
 <upSignal active="true" signalType="data" dataRate="16" band="S" spacecraft="VGR2" spacecraftID="-32"/>
 <downSignal active="true" signalType="data" dataRate="160" band="X" spacecraft="VGR2" spacecraftID="-32"/>
 <target name="VGR2" id="32" rtlt="140400"/></dish>
<dish name="DSS36" azimuthAngle="300" elevationAngle="44" activity="Spacecraft Telemetry, Tracking, and Command">
 <downSignal active="true" signalType="data" dataRate="350000" band="Ka" spacecraft="PSYC" spacecraftID="-255"/>
 <target name="PSYC" id="255" rtlt="2520"/></dish>
<dish name="DSS35" azimuthAngle="0" elevationAngle="90" activity=""><target name="DSN" id="99" rtlt="-1"/></dish>
<timestamp>0</timestamp>
</dsn>"""

# A plausible ISS element set (epoch 2026-09-25). Only for demo; the real one comes from CelesTrak.
DEMO_TLE = """ISS (ZARYA)
1 25544U 98067A   26268.50000000  .00016717  00000+0  30177-3 0  9993
2 25544  51.6400 208.9163 0006317  69.9862 290.1600 15.50030000 51234"""


def _tle_checksum(line: str) -> str:
    return str(sum(int(c) if c.isdigit() else c == "-" for c in line[:68]) % 10)


def demo_tle(now: datetime) -> str:
    """DEMO_TLE with its epoch moved to a few hours ago, so the demo never looks stale."""
    name, l1, l2 = DEMO_TLE.splitlines()
    ep = now - timedelta(hours=3)
    day = (ep - datetime(ep.year, 1, 1, tzinfo=timezone.utc)).total_seconds() / 86400 + 1
    l1 = l1[:18] + f"{ep.year % 100:02d}{day:012.8f}" + l1[32:68]
    return "\n".join([name, l1 + _tle_checksum(l1), l2])


def _svg_sun() -> str:
    spots = "".join(
        f'<circle cx="{256 + 170 * math.cos(a) * r:.0f}" cy="{256 + 170 * math.sin(a) * r * .8:.0f}" r="{s:.0f}" fill="#ffe7a3" opacity="{o:.2f}"/>'
        for a, r, s, o in ((random.random() * 7, random.random() * .9, 6 + random.random() * 22, .1 + random.random() * .3)
                           for _ in range(60)))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#000"/>
<defs><radialGradient id="g"><stop offset="0" stop-color="#ffcf6a"/><stop offset=".8" stop-color="#e2711d"/><stop offset="1" stop-color="#7a2104"/></radialGradient>
<clipPath id="c"><circle cx="256" cy="256" r="200"/></clipPath></defs>
<circle cx="256" cy="256" r="214" fill="#e2711d" opacity=".25"/><circle cx="256" cy="256" r="200" fill="url(#g)"/>
<g clip-path="url(#c)">{spots}</g></svg>"""


def _svg_nebula() -> str:
    rnd = random.Random(4)
    blobs = "".join(
        f'<circle cx="{rnd.uniform(150, 850):.0f}" cy="{rnd.uniform(100, 560):.0f}" r="{rnd.uniform(60, 240):.0f}" fill="{rnd.choice(["#c2410c", "#f5a524", "#6ec5e9", "#8a5cf6"])}" opacity=".13"/>'
        for _ in range(60))
    stars = "".join(f'<circle cx="{rnd.uniform(0, 1000):.0f}" cy="{rnd.uniform(0, 680):.0f}" r="{rnd.choice([.6, .6, .9, 1.5])}" fill="#fff"/>'
                    for _ in range(500))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 680"><rect width="1000" height="680" fill="#120b24"/>
<filter id="b"><feGaussianBlur stdDeviation="30"/></filter><g filter="url(#b)">{blobs}</g>{stars}</svg>"""


def build_raw(now: datetime) -> dict:
    """Raw payloads shaped like the real services."""
    r = random.Random(1)
    # Planetary Kp: 3-hour values for the past week (array of objects).
    kp, fc = [], []
    start = (now - timedelta(days=7)).replace(minute=0, second=0, microsecond=0)
    start = start.replace(hour=start.hour - start.hour % 3)
    t = start
    while t <= now + timedelta(days=3):
        h = (t - now).total_seconds() / 3600
        val = round(min(9, max(0.33, 2.3 + 2.7 * math.exp(-((h + 6) / 9) ** 2) + r.uniform(-.5, .5))) * 3) / 3
        tag = t.strftime("%Y-%m-%dT%H:%M:%S")
        if t <= now:
            kp.append({"time_tag": tag, "Kp": round(val, 2), "a_running": 7, "station_count": 8})
        kind = "observed" if t <= now - timedelta(hours=3) else "estimated" if t <= now else "predicted"
        fc.append({"time_tag": tag, "kp": round(val, 2), "observed": kind, "noaa_scale": None})
        t += timedelta(hours=3)

    # GOES X-ray flux: one minute cadence, both channels, with an M-class flare 6.6 h ago.
    xr = []
    for m in range(0, 1440):
        tt = now - timedelta(minutes=1440 - m)
        h = m / 60
        base = 4e-7 * (1 + .3 * math.sin(h * 1.7) + .15 * math.sin(h * 5.1))
        base += 1.8e-6 * math.exp(-((h - 6.2) / .25) ** 2)
        if h >= 17:
            base += 2.1e-5 * math.exp(-max(0, h - 17.4) / .9) * min(1, (h - 17) / .4)
        tag = tt.strftime("%Y-%m-%dT%H:%M:00Z")
        xr.append({"time_tag": tag, "satellite": 18, "flux": base * .05, "energy": "0.05-0.4nm"})
        xr.append({"time_tag": tag, "satellite": 18, "flux": base, "energy": "0.1-0.8nm"})

    # Real-time solar wind: several spacecraft, newest first, only one active.
    wind, mag = [], []
    for m in range(0, 1440, 1):
        tt = now - timedelta(minutes=m)
        tag = tt.strftime("%Y-%m-%dT%H:%M:%S")
        sp = 480 + 130 * (1 - m / 1440) + r.uniform(-15, 15)
        wind.append({"time_tag": tag, "active": True, "source": "DSCOVR", "proton_speed": round(sp, 1),
                     "proton_density": round(6 + r.uniform(-1.5, 2.5), 2), "proton_temperature": 150000})
        wind.append({"time_tag": tag, "active": False, "source": "ACE", "proton_speed": round(sp - 20, 1),
                     "proton_density": 3.1, "proton_temperature": 140000})
        mag.append({"time_tag": tag, "active": True, "source": "DSCOVR", "bt": round(10 + r.uniform(-1, 1.5), 2),
                    "bz_gsm": round(-6 + r.uniform(-3, 2), 2)})

    alerts = [{
        "product_id": "A20F",
        "issue_datetime": (now - timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S.000"),
        "message": "Space Weather Message Code: WATA20\r\nSerial Number: 1100\r\nIssue Time: now\r\n\r\n"
                   "WATCH: Geomagnetic Storm Category G1 Predicted\r\n\r\nHighest Storm Level Predicted by Day:\r\n"
                   "NOAA Scale: G1 - Minor",
    }]

    d = lambda hrs: (now - timedelta(hours=hrs)).strftime("%Y-%m-%dT%H:%MZ")
    flr = [{"classType": "M2.1", "beginTime": d(6.8), "peakTime": d(6.6), "sourceLocation": "N14W22",
            "activeRegionNum": 14231, "link": ""},
           {"classType": "C4.3", "beginTime": d(18), "peakTime": d(17.8), "sourceLocation": "S09E41",
            "activeRegionNum": 14236, "link": ""}]
    cme = [{"startTime": d(6.1), "note": "", "link": "",
            "cmeAnalyses": [{"isMostAccurate": True, "speed": 870,
                             "enlilList": [{"estimatedShockArrivalTime": (now + timedelta(hours=40)).strftime("%Y-%m-%dT%H:%MZ")}]}]}]
    gst = [{"startTime": d(50), "allKpValues": [{"kpIndex": 5.67}, {"kpIndex": 6}], "link": ""}]

    images = {"collection": {"items": [
        {"data": [{"title": "Webb's view of the Cosmic Cliffs", "description": "A star-forming region imaged by Webb's NIRCam.",
                   "media_type": "image", "nasa_id": "demo-1", "date_created": "2022-07-12T00:00:00Z", "center": "GSFC"}],
         "links": [{"href": "https://example.invalid/demo-1~medium.jpg"}]},
        {"data": [{"title": "JWST Town Hall", "description": "Engineers at the Webb town hall.", "media_type": "image",
                   "nasa_id": "demo-2", "date_created": "2022-01-01T00:00:00Z"}],
         "links": [{"href": "https://example.invalid/demo-2~medium.jpg"}]},
    ]}}
    return dict(kp=kp, fc=fc, xr=xr, wind=wind, mag=mag, alerts=alerts, flr=flr, cme=cme, gst=gst, images=images)


def demo_mars(now: datetime) -> dict:
    """Shaped like the live feed: strings everywhere, '--' for missing, newest first."""
    r = random.Random(3)
    soles = []
    for i in range(14):
        d = now - timedelta(days=32 + i)
        soles.append({"id": str(4746 - i), "terrestrial_date": d.strftime("%Y-%m-%d"), "sol": str(4995 - i),
                      "ls": str(341 - i // 2), "season": "Month 12", "min_temp": str(-70 - r.randint(0, 6)),
                      "max_temp": str(-4 - r.randint(0, 6)), "pressure": str(777 - i), "pressure_string": "Higher",
                      "abs_humidity": "--", "wind_speed": "--", "wind_direction": "--", "atmo_opacity": "Sunny",
                      "sunrise": "06:46", "sunset": "18:51", "local_uv_irradiance_index": "Moderate",
                      "min_gts_temp": str(-84 - r.randint(0, 6)), "max_gts_temp": str(r.randint(2, 5))})
    return {"descriptions": {}, "soles": soles}


async def seed(cfg: dict, store: Store, jobs) -> None:
    now = datetime.now(timezone.utc)
    raw = build_raw(now)
    store.put("kp", swpc.parse_kp(raw["kp"]))
    store.put("kp_forecast", swpc.parse_kp_forecast(raw["fc"]))
    store.put("xray", swpc.summarize_xray(swpc.parse_xray(raw["xr"]), now))
    store.put("wind", swpc.summarize_wind(raw["wind"], raw["mag"], now))
    store.put("alerts", swpc.parse_alerts(raw["alerts"]))
    store.put("donki", donki.summarize(raw["flr"], raw["cme"], raw["gst"]))
    conf = dsn.parse_config(DSN_CONFIG)
    store.put("dsn_config", conf)
    store.put("dsn", dsn.parse_feed(DSN_FEED, conf))

    (store.media_dir / "demo_sun.svg").write_text(_svg_sun())
    store.put("sun_image", {"file": "demo_sun.svg", "url": "demo", "image_time": now.timestamp(),
                            "saved_at": now.timestamp()})
    (store.media_dir / "demo_gallery.svg").write_text(_svg_nebula())
    pool = gallery.parse_search(raw["images"], cfg["gallery"]["exclude_words"])
    store.put("gallery_pool", pool)
    store.put("gallery_current", {**pool[0], "file": "demo_gallery.svg", "saved_at": now.timestamp(),
                                  "text": "Demo image drawn locally. On the Pi this is a random Webb image from "
                                          "NASA's Image and Video Library."})
    store.put("apod", {"title": "Demo picture of the day", "date": now.strftime("%Y-%m-%d"),
                       "text": "Demo mode. With internet this shows today's Astronomy Picture of the Day.",
                       "credit": "Orbit Desk", "file": "demo_gallery.svg", "saved_at": now.timestamp()})

    store.put("mars", mars.parse(demo_mars(now)))

    store.put("radio", [{**s, "name": s.get("name") or {"jp": "NHK Radio 1"}.get(s["id"], "WXYZ 100.3"), "url": "", "hls": False, "codec": "MP3",
                         "bitrate": 128, "homepage": ""} for s in cfg["radio"]["stations"]])

    store.put("tle", iss.parse_tle(demo_tle(now)))
    jobs.load_tracker()
    await jobs.passes()

    songs = ["Dawid Podsiadło - Małomiasteczkowy", "Kate Bush - Running Up That Hill", "Hania Rani - Glass"]

    async def _np(station_id):
        return {"id": station_id, **radio.split_title(random.choice(songs)), "supported": True}
    jobs.now_playing = _np

    async def _noop():
        return store.data("gallery_current")
    jobs.gallery_next = _noop
