"""Parser tests, using payloads copied from the live services (September 2026)."""
from datetime import datetime, timezone

from orbitdesk.sources import donki, dsn, gallery, iss, swpc
from orbitdesk import demo

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)


def test_kp_objects_and_legacy_arrays():
    objs = [{"time_tag": "2026-09-18T00:00:00", "Kp": 1.67, "a_running": 6, "station_count": 8}]
    arrs = [["time_tag", "Kp", "a_running", "station_count"], ["2026-09-18 00:00:00.000", "1.67", "6", "8"]]
    assert swpc.parse_kp(objs) == swpc.parse_kp(arrs) == [{"t": "2026-09-18T00:00:00Z", "kp": 1.67}]


def test_g_scale_counts_5_minus():
    assert swpc.g_scale(4.33) == 0
    assert swpc.g_scale(4.67) == 1
    assert swpc.g_scale(7.0) == 3
    assert swpc.g_scale(9.0) == 5


def test_flare_classes():
    assert swpc.flare_class(6.36e-07) == "B6.4"
    assert swpc.flare_class(2.1e-05) == "M2.1"
    assert swpc.flare_class(1.2e-03) == "X12.0"
    assert swpc.r_scale(5.2e-5) == 2


def test_xray_keeps_long_channel_only():
    raw = [
        {"time_tag": "2026-09-19T01:48:00Z", "satellite": 18, "flux": 1.7e-08, "energy": "0.05-0.4nm"},
        {"time_tag": "2026-09-19T01:48:00Z", "satellite": 18, "flux": 6.35e-07, "energy": "0.1-0.8nm"},
    ]
    assert swpc.parse_xray(raw) == [{"t": "2026-09-19T01:48:00Z", "flux": 6.35e-07}]


def test_wind_prefers_active_spacecraft():
    wind = [
        {"time_tag": "2026-09-26T11:59:00", "active": False, "source": "ACE", "proton_speed": 300.0, "proton_density": 1.0},
        {"time_tag": "2026-09-26T11:59:00", "active": True, "source": "IMAP", "proton_speed": 450.0, "proton_density": 6.6},
    ]
    mag = [{"time_tag": "2026-09-26T11:59:02", "active": True, "source": "IMAP", "bt": 4.2, "bz_gsm": -3.1}]
    w = swpc.summarize_wind(wind, mag, NOW)
    assert w["speed"] == 450.0 and w["source"] == "IMAP" and w["bz"] == -3.1
    assert 90 < w["sun_earth_hours"] < 95


def test_alerts_title_and_short_banner():
    raw = [{"product_id": "K04A", "issue_datetime": "2026-09-25 21:58:25.860",
            "message": "Space Weather Message Code: ALTK04\r\nSerial Number: 2687\r\n\r\nALERT: Geomagnetic K-index of 4 \nThreshold Reached: 2026 Sep 25 2158 UTC"}]
    a = swpc.parse_alerts(raw)[0]
    assert a["kind"] == "Alert" and a["title"] == "Geomagnetic K-index of 4"
    assert a["issued"] == "2026-09-25T21:58:25Z"
    assert swpc.short_alert({"kind": "Watch", "title": "Geomagnetic Storm Category G2 Predicted"}) == "G2 storm watch"


def test_dsn_feed():
    conf = dsn.parse_config(demo.DSN_CONFIG)
    d = dsn.parse_feed(demo.DSN_FEED, conf)
    names = [s["name"] for s in d["sites"]]
    assert names == ["Goldstone", "Madrid", "Canberra"]
    gold = d["sites"][0]["dishes"]
    mro = next(L for di in gold for L in di["links"] if L["code"] == "MRO")
    assert mro["up"] and mro["down"] and mro["down_rate"] == 1_500_000 and mro["rtlt_s"] == 1706
    assert gold[2]["links"] == []  # maintenance, target "DSN"


def test_dsn_live_sample_shape():
    xml = """<dsn><station name="gdscc" friendlyName="Goldstone" timeUTC="1" timeZoneOffset="-25200000.0"/>
    <dish name="DSS23" azimuthAngle="286" elevationAngle="15" windSpeed="20" isMSPA="false" isArray="false" isDDOR="false" activity="Spacecraft Telemetry, Tracking, and Command">
    <upSignal active="true" signalType="data" dataRate="0" frequency="0" band="S" power="4.9" spacecraft="MRO" spacecraftID="-74"/>
    <downSignal active="true" signalType="data" dataRate="1500000" frequency="0" band="X" power="-120" spacecraft="MRO" spacecraftID="-74"/>
    <downSignal active="false" signalType="none" dataRate="1011000" frequency="0" band="X" power="-480" spacecraft="TGO" spacecraftID="-143"/>
    <target name="MRO" id="74" uplegRange="-1" downlegRange="-1" rtlt="-1"/><target name="TGO" id="143" uplegRange="-1" downlegRange="-1" rtlt="-1"/>
    </dish></dsn>"""
    links = dsn.parse_feed(xml)["sites"][0]["dishes"][0]["links"]
    assert [L["code"] for L in links] == ["MRO"]  # inactive TGO dropped
    assert links[0]["rtlt_s"] is None  # rtlt=-1 means unknown


def test_donki_summary_orders_and_flags_earth():
    raw = demo.build_raw(NOW)
    ev = donki.summarize(raw["flr"], raw["cme"], raw["gst"])
    assert ev[0]["type"] == "cme" and ev[0]["earth"] and ev[0]["arrival"]
    assert [e["t"] for e in ev] == sorted((e["t"] for e in ev), reverse=True)


def test_gallery_filters_people_photos():
    raw = demo.build_raw(NOW)["images"]
    items = gallery.parse_search(raw, ["town hall", "engineer"])
    assert [i["id"] for i in items] == ["demo-1"]
    assert items[0]["image"].endswith("~large.jpg")


def test_iss_tracker_from_tle():
    t = iss.Tracker(iss.parse_tle(demo.DEMO_TLE), {"lat": 50.06, "lon": 19.94, "elevation_m": 220})
    n = t.now(NOW)
    assert -52 <= n["lat"] <= 52 and 380 < n["alt_km"] < 460
    assert len(n["track"]) == 187
    ps = t.passes(when=NOW)
    assert ps and all(p["max_alt"] >= 10 for p in ps)


def test_mars_feed_strings_and_placeholders():
    from orbitdesk.sources import mars
    raw = {"descriptions": {}, "soles": [
        {"id": "4745", "terrestrial_date": "2026-08-24", "sol": "4994", "ls": "340", "season": "Month 12",
         "min_temp": "-70", "max_temp": "-7", "pressure": "777", "abs_humidity": "--", "wind_speed": "--",
         "atmo_opacity": "Sunny", "sunrise": "06:46", "sunset": "18:52", "local_uv_irradiance_index": "Moderate",
         "min_gts_temp": "-82", "max_gts_temp": "4"},
        {"id": "4746", "terrestrial_date": "2026-08-25", "sol": "4995", "min_temp": "-71", "max_temp": "-5",
         "pressure": "777", "atmo_opacity": "--"},
        {"id": "1", "terrestrial_date": "2026-08-26", "sol": "4996", "min_temp": "--", "max_temp": "--"},
    ]}
    s = mars.parse(raw)
    assert [x["sol"] for x in s] == [4995, 4994]  # newest first, empty sol dropped
    assert s[0]["max_temp"] == -5.0 and s[0]["sky"] is None and s[1]["min_ground"] == -82.0


def test_radio_pick_prefers_working_plain_streams():
    from orbitdesk.sources import radio
    res = [
        {"name": "RMF FM", "url_resolved": "https://x/rmf.m3u8", "hls": 1, "codec": "AAC", "votes": 900, "lastcheckok": 1},
        {"name": "RMF FM", "url_resolved": "http://x/rmf.mp3", "hls": 0, "codec": "MP3", "votes": 500, "lastcheckok": 1},
        {"name": "RMF FM Classic", "url_resolved": "http://x/c.mp3", "hls": 0, "codec": "MP3", "votes": 5000, "lastcheckok": 0},
        {"name": "Radio ZET", "url_resolved": "http://x/z.mp3", "hls": 0, "codec": "MP3", "votes": 9000, "lastcheckok": 1},
    ]
    assert radio.pick(res, "RMF FM")["url_resolved"] == "http://x/rmf.mp3"
    st = radio.to_station({"id": "pl", "country": "Poland", "tz": "Europe/Warsaw", "name": "RMF FM"}, radio.pick(res, "RMF FM"))
    assert st["url"] == "http://x/rmf.mp3" and st["hls"] is False and st["name"] == "RMF FM"


def test_radio_pick_prefers_https_among_plain_streams():
    from orbitdesk.sources import radio
    res = [
        {"name": "KEXP", "url_resolved": "http://x/kexp.mp3", "hls": 0, "codec": "MP3", "votes": 900, "lastcheckok": 1},
        {"name": "KEXP", "url_resolved": "https://x/kexp.aac", "hls": 0, "codec": "AAC", "votes": 100, "lastcheckok": 1},
    ]
    assert radio.pick(res, "KEXP")["url_resolved"] == "https://x/kexp.aac"


def test_radio_icy_metadata_parsing():
    from orbitdesk.sources import radio
    assert radio.parse_meta(b"StreamTitle='Kult - Arahja';StreamUrl='';") == "Kult - Arahja"
    assert radio.parse_meta("StreamTitle='Sigur Rós - Hoppípolla';".encode("latin-1", "replace")) is not None
    assert radio.split_title("Kult - Arahja") == {"artist": "Kult", "title": "Arahja", "raw": "Kult - Arahja"}
    assert radio.split_title(None)["title"] is None


def test_apod_new_science_feed():
    raw = [{"date": "2026-09-26", "title": "Mirrored Meteor and Milky Way",
            "permalink": "https://science.nasa.gov/image-article/apod-2026-september-26-mirrored-meteor-and-milky-way/",
            "media_type": "image",
            "explanation": "<strong>Explanation:</strong> On August 15, this <a href='x'>perseid meteor</a> streaked through night skies.",
            "copyright": "<a href='x'>Jeff Dai</a> (<a href='y'>TWAN</a>)",
            "url": "https://science.nasa.gov/image-article/apod-2026-september-26-mirrored-meteor-and-milky-way/",
            "hdurl": "https://assets.science.nasa.gov/dynamicimage/assets/science/cds/apod/apod/2026/september/MilkyWayMeteorLSTJeffDai.jpg?w=2000&h=1334&fit=clip&crop=faces%2Cfocalpoint"}]
    a = gallery.parse_apod(raw)
    assert a["title"] == "Mirrored Meteor and Milky Way"
    assert a["text"].startswith("On August 15, this perseid meteor")
    assert a["credit"] == "Jeff Dai (TWAN)"
    assert "w=1280" in a["image"] and a["image"].startswith("https://assets.science.nasa.gov/")
    assert gallery.parse_apod([{"media_type": "video", "title": "x"}])["image"] is None


def test_themes_from_config():
    from orbitdesk.config import build_themes
    t = build_themes([{"id": "solar"}, {"id": "martian", "name": "Martian Dust", "bg": "#140C08", "accent": "#FF4500"},
                      {"id": "night", "name": "Observatory", "bg": "#000000"}, {"id": "bad", "bg": "red;} body{display:none"}])
    ids = [x["id"] for x in t]
    assert ids == ["solar", "martian", "night", "bad"]
    assert t[0]["accent"] == "#F5A524"                      # built-in kept
    assert t[1]["accent"] == "#FF4500" and t[1]["panel"] == "#0E1524"  # new id starts from Solar
    assert t[2]["name"] == "Observatory" and t[2]["text"] == "#FF4A3D"  # only bg changed
    assert t[3]["bg"] == "#070B14"                          # unsafe CSS rejected
    assert [x["id"] for x in build_themes(None)] == ["solar", "night", "day"]


def test_local_config_and_env_key(tmp_path, monkeypatch):
    from orbitdesk import config
    (tmp_path / "config.toml").write_text('[location]\nname = "Gdańsk"\n[nasa]\napi_key = "DEMO_KEY"\n')
    (tmp_path / "config.local.toml").write_text('[nasa]\napi_key = "from-local"\n')
    monkeypatch.delenv("NASA_API_KEY", raising=False)
    cfg = config.load(tmp_path / "config.toml")
    assert cfg["location"]["name"] == "Gdańsk" and cfg["nasa"]["api_key"] == "from-local"
    monkeypatch.setenv("NASA_API_KEY", "from-env")
    assert config.load(tmp_path / "config.toml")["nasa"]["api_key"] == "from-env"
