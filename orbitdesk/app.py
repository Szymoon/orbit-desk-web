"""FastAPI app: serves the panel and a small JSON API built from the cache."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config as config_mod
from .cache import Store
from .jobs import Jobs, run_forever
from .payloads import STALE_AFTER, entry as _entry, public_config as _public_config, spaceweather as _spaceweather, status as _status

FRONTEND = Path(__file__).resolve().parent.parent / "docs"
log = logging.getLogger("orbitdesk")



def create_app(cfg: dict | None = None, demo: bool = False) -> FastAPI:
    cfg = cfg or config_mod.load()
    store = Store(cfg["server"]["data_dir"])
    jobs = Jobs(cfg, store)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        tasks = []
        if demo:
            from .demo import seed
            await seed(cfg, store, jobs)
        else:
            jobs.load_tracker()
            for i, (name, fn, interval) in enumerate(jobs.schedule()):
                delay = 4 if name == "dsn" else i * 0.5  # dsn needs dsn_config first
                tasks.append(asyncio.create_task(run_forever(name, fn, interval, store, delay)))
        yield
        for t in tasks:
            t.cancel()
        await jobs.close()

    app = FastAPI(title="Orbit Desk", lifespan=lifespan)
    app.state.cfg, app.state.store, app.state.jobs = cfg, store, jobs

    @app.middleware("http")
    async def no_stale_files(request, call_next):
        # Make browsers check for a newer copy of the page files every time,
        # so an update shows without clearing the cache (cheap: it's local).
        resp = await call_next(request)
        if not request.url.path.startswith("/media"):
            resp.headers["Cache-Control"] = "no-cache"
        return resp

    def entry(name: str) -> dict:
        return _entry(store, name)

    # ------------------------------------------------------------------ API
    @app.get("/api/config")
    def public_config():
        return _public_config(cfg, demo)

    @app.get("/api/spaceweather")
    def spaceweather():
        return _spaceweather(cfg, store)

    @app.get("/api/donki")
    def donki_events():
        return entry("donki")

    @app.get("/api/dsn")
    def dsn_now():
        return entry("dsn")

    @app.get("/api/iss")
    async def iss_now():
        if not jobs.tracker and not jobs.load_tracker():
            raise HTTPException(503, "No orbital elements yet")
        pos = await asyncio.to_thread(jobs.tracker.now)
        return {"now": pos, "passes": store.data("iss_passes") or [],
                "tle_fetched_at": (store.get("tle") or {}).get("fetched_at")}

    @app.get("/api/gallery")
    def gallery_now():
        return entry("gallery_current")

    @app.post("/api/gallery/next")
    async def gallery_next():
        try:
            cur = await jobs.gallery_next()
        except Exception as e:
            raise HTTPException(502, str(e))
        return {"fetched_at": time.time(), "data": cur}

    @app.get("/api/mars")
    def mars_weather():
        return entry("mars")

    @app.post("/api/kiosk/minimize")
    async def kiosk_minimize():
        from . import kiosk
        return {"result": await asyncio.to_thread(kiosk.minimize)}

    @app.get("/api/radio")
    def radio_stations():
        return entry("radio")

    @app.get("/api/radio/nowplaying")
    async def radio_now(id: str):
        return await jobs.now_playing(id)

    @app.get("/api/apod")
    def apod():
        return entry("apod")

    @app.get("/api/status")
    def status():
        return _status(store, demo)

    prefs_path = store.root / "prefs.json"

    @app.get("/api/prefs")
    def get_prefs():
        try:
            return json.loads(prefs_path.read_text())
        except (OSError, ValueError):
            return {}

    @app.post("/api/prefs")
    def set_prefs(prefs: dict = Body(...)):
        prefs_path.write_text(json.dumps(prefs))
        return JSONResponse(prefs)

    # ------------------------------------------------------------------ files
    app.mount("/media", StaticFiles(directory=store.media_dir), name="media")

    @app.get("/")
    def index():
        return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-cache"})

    app.mount("/", StaticFiles(directory=FRONTEND), name="docs")
    return app
