"""Disk cache for fetched feeds and images, plus per-feed health status.

Everything a screen shows comes from this cache, so the panel keeps working
(with the last good data) when the Wi-Fi or a feed goes down.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import httpx

USER_AGENT = "OrbitDesk/0.1 (Raspberry Pi desk dashboard)"


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(20.0, connect=10.0),
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    )


class Store:
    def __init__(self, data_dir: str | os.PathLike):
        self.root = Path(data_dir)
        self.cache_dir = self.root / "cache"
        self.media_dir = self.root / "media"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.status: dict[str, dict[str, Any]] = {}

    # ---- JSON entries -------------------------------------------------
    def put(self, name: str, data: Any) -> None:
        entry = {"fetched_at": time.time(), "data": data}
        tmp = self.cache_dir / f".{name}.json.tmp"
        tmp.write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.cache_dir / f"{name}.json")

    def get(self, name: str) -> dict | None:
        p = self.cache_dir / f"{name}.json"
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def data(self, name: str, default: Any = None) -> Any:
        e = self.get(name)
        return e["data"] if e else default

    # ---- health ---------------------------------------------------------
    def mark_ok(self, job: str) -> None:
        s = self.status.setdefault(job, {})
        s.update(ok_at=time.time(), error=None)

    def mark_error(self, job: str, err: BaseException) -> None:
        s = self.status.setdefault(job, {})
        s.update(error=f"{type(err).__name__}: {err}"[:300], error_at=time.time())

    # ---- binary files ---------------------------------------------------
    async def download(self, http: httpx.AsyncClient, url: str, filename: str) -> dict:
        """Download url into media/<filename> atomically. Returns metadata."""
        r = await http.get(url)
        r.raise_for_status()
        ctype = r.headers.get("content-type", "")
        if not ctype.startswith("image/"):
            raise ValueError(f"not an image ({ctype}) from {url}")
        tmp = self.media_dir / f".{filename}.tmp"
        tmp.write_bytes(r.content)
        os.replace(tmp, self.media_dir / filename)
        return {
            "file": filename,
            "url": url,
            "bytes": len(r.content),
            "last_modified": r.headers.get("last-modified"),
            "saved_at": time.time(),
        }
