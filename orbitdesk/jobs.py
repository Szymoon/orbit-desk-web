"""Background jobs: each one fetches a feed, parses it and writes the cache."""
from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from .cache import Store, client
from .sources import donki, dsn, gallery, iss, mars, radio, swpc

log = logging.getLogger("orbitdesk.jobs")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Jobs:
    def __init__(self, cfg: dict, store: Store):
        self.cfg = cfg
        self.store = store
        self.http = client()
        self.tracker: iss.Tracker | None = None
        self._recent_gallery: list[str] = []
        self._np: dict[str, tuple[float, dict]] = {}

    async def close(self):
        await self.http.aclose()

    async def _json(self, url: str):
        r = await self.http.get(url)
        r.raise_for_status()
        return r.json()

    async def _text(self, url: str) -> str:
        r = await self.http.get(url)
        r.raise_for_status()
        return r.text

    # ---------------------------------------------------------- space weather
    async def swpc(self):
        U = swpc.URLS
        kp, fc, xr, wind, mag = await asyncio.gather(
            self._json(U["kp"]), self._json(U["kp_forecast"]), self._json(U["xray"]),
            self._json(U["wind"]), self._json(U["mag"]), return_exceptions=True)
        now = utcnow()
        errors = []
        if not isinstance(kp, Exception):
            self.store.put("kp", swpc.parse_kp(kp))
        else:
            errors.append(kp)
        if not isinstance(fc, Exception):
            self.store.put("kp_forecast", swpc.parse_kp_forecast(fc))
        else:
            errors.append(fc)
        if not isinstance(xr, Exception):
            self.store.put("xray", swpc.summarize_xray(swpc.parse_xray(xr), now))
        else:
            errors.append(xr)
        if not isinstance(wind, Exception) and not isinstance(mag, Exception):
            self.store.put("wind", swpc.summarize_wind(wind, mag, now))
        else:
            errors += [e for e in (wind, mag) if isinstance(e, Exception)]
        if errors:
            raise errors[0]

    async def alerts(self):
        self.store.put("alerts", swpc.parse_alerts(await self._json(swpc.URLS["alerts"]))[:20])

    async def donki(self):
        u = donki.urls(self.cfg["nasa"]["api_key"], utcnow())
        flr, cme, gst = await asyncio.gather(self._json(u["FLR"]), self._json(u["CME"]), self._json(u["GST"]))
        self.store.put("donki", donki.summarize(flr, cme, gst))

    async def sun_image(self):
        best = None
        for url in self.cfg["sun"]["image_urls"]:
            try:
                r = await self.http.get(url)
                r.raise_for_status()
                if not r.headers.get("content-type", "").startswith("image/"):
                    continue
                lm = r.headers.get("last-modified")
                ts = parsedate_to_datetime(lm).timestamp() if lm else 0
                if best is None or ts > best[0]:
                    best = (ts, url, r.content, r.headers.get("content-type"))
            except Exception as e:  # try the next source
                log.info("sun image %s failed: %s", url, e)
        if not best:
            raise RuntimeError("no Sun image source answered")
        ts, url, content, ctype = best
        ext = "png" if "png" in (ctype or "") else "jpg"
        name = f"sun.{ext}"
        (self.store.media_dir / name).write_bytes(content)
        self.store.put("sun_image", {"file": name, "url": url, "image_time": ts or None,
                                     "saved_at": utcnow().timestamp()})

    # ---------------------------------------------------------- Mars
    async def mars(self):
        last = None
        for url in mars.URLS:  # NASA's copy first, CAB's original as fallback
            try:
                sols = mars.parse(await self._json(url))
            except Exception as e:
                last = e
                continue
            if sols:
                self.store.put("mars", sols)
                return
        raise last or RuntimeError("no Mars weather in either feed")

    # ---------------------------------------------------------- radio
    async def radio(self):
        stations = await radio.resolve_all(self.http, self.cfg["radio"]["stations"])
        if not any(s.get("url") for s in stations):
            raise RuntimeError("no radio stream found; is radio-browser.info reachable?")
        self.store.put("radio", stations)

    async def now_playing(self, station_id: str) -> dict:
        """Song title for one station, cached 20 s so polling pages don't hammer the stream."""
        import time
        hit = self._np.get(station_id)
        if hit and time.time() - hit[0] < 20:
            return hit[1]
        st = next((s for s in self.store.data("radio") or [] if s["id"] == station_id), None)
        title = None
        if st and st.get("url") and not st.get("hls"):
            title = await radio.icy_title(self.http, st["url"])
        res = {"id": station_id, **radio.split_title(title), "supported": bool(st and not st.get("hls"))}
        self._np[station_id] = (time.time(), res)
        return res

    # ---------------------------------------------------------- deep space network
    async def dsn_config(self):
        self.store.put("dsn_config", dsn.parse_config(await self._text(dsn.CONFIG_URL)))

    async def dsn(self):
        conf = self.store.data("dsn_config")
        self.store.put("dsn", dsn.parse_feed(await self._text(dsn.FEED_URL), conf))

    # ---------------------------------------------------------- ISS
    async def tle(self):
        tle = iss.parse_tle(await self._text(iss.TLE_URL))
        self.store.put("tle", tle)
        self.load_tracker()
        await self.passes()

    def load_tracker(self):
        tle = self.store.data("tle")
        if tle:
            self.tracker = iss.Tracker(tle, self.cfg["location"])
        return self.tracker

    async def passes(self):
        if not self.tracker and not self.load_tracker():
            return
        result = await asyncio.to_thread(self.tracker.passes)
        self.store.put("iss_passes", result)

    # ---------------------------------------------------------- pictures
    async def gallery_pool(self):
        g = self.cfg["gallery"]
        pool: dict[str, dict] = {}
        for q in g["queries"]:
            try:
                raw = await self._json(gallery.search_url(q, g["year_start"]))
            except Exception as e:
                log.info("gallery query %r failed: %s", q, e)
                continue
            for it in gallery.parse_search(raw, g["exclude_words"]):
                pool.setdefault(it["id"], it)
        if not pool:
            raise RuntimeError("image search returned nothing usable")
        self.store.put("gallery_pool", list(pool.values()))
        if not self.store.get("gallery_current"):
            await self.gallery_next()

    async def gallery_next(self):
        pool = self.store.data("gallery_pool") or []
        if not pool:
            return None
        fresh = [p for p in pool if p["id"] not in self._recent_gallery] or pool
        for pick in random.sample(fresh, k=min(4, len(fresh))):
            for url in (pick["image"], pick["preview"]):
                try:
                    meta = await self.store.download(self.http, url, "gallery.jpg")
                except Exception as e:
                    log.info("gallery image %s failed: %s", url, e)
                    continue
                self._recent_gallery = (self._recent_gallery + [pick["id"]])[-30:]
                cur = {**pick, "file": "gallery.jpg", "saved_at": meta["saved_at"]}
                self.store.put("gallery_current", cur)
                return cur
        raise RuntimeError("could not download any gallery image")

    async def apod(self):
        a = gallery.parse_apod(await self._json(gallery.APOD_URL))
        if a.get("image"):
            meta = await self.store.download(self.http, a["image"], "apod.jpg")
            a["file"], a["saved_at"] = "apod.jpg", meta["saved_at"]
        self.store.put("apod", a)

    # ---------------------------------------------------------- schedule
    def schedule(self) -> list[tuple[str, callable, float]]:
        iv = self.cfg["intervals"]
        return [
            ("swpc", self.swpc, iv["swpc"]),
            ("alerts", self.alerts, iv["alerts"]),
            ("donki", self.donki, iv["donki"]),
            ("sun_image", self.sun_image, iv["sun_image"]),
            ("dsn_config", self.dsn_config, iv["dsn_config"]),
            ("dsn", self.dsn, iv["dsn"]),
            ("tle", self.tle, iv["tle"]),
            ("iss_passes", self.passes, 1800),
            ("gallery_pool", self.gallery_pool, iv["gallery_pool"]),
            ("gallery_rotate", self.gallery_next, self.cfg["gallery"]["rotate_minutes"] * 60),
            ("apod", self.apod, iv["apod"]),
            ("mars", self.mars, iv["mars"]),
            ("radio", self.radio, iv["radio"]),
        ]


async def run_forever(name: str, fn, interval: float, store: Store, first_delay: float = 0):
    """Run fn every `interval` seconds. On failure retry sooner, backing off to the interval."""
    await asyncio.sleep(first_delay)
    backoff = 30.0
    while True:
        try:
            await fn()
            store.mark_ok(name)
            backoff = 30.0
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            store.mark_error(name, e)
            log.warning("%s failed: %s", name, e)
            await asyncio.sleep(min(interval, backoff))
            backoff = min(backoff * 2, max(interval, 30.0))
