"""World radio: find each station's live stream, and read the song that's playing.

Streams are looked up by name in radio-browser.info, a free community directory,
instead of being hard-coded: broadcasters change stream addresses, and the
directory keeps up. A station can also be pinned to a fixed `url` in config.

The song title comes from ICY metadata, which most Icecast/Shoutcast streams
send every few kilobytes. Browsers can't read it, so the server does.
HLS streams (BBC, some public broadcasters) don't carry it.
"""
from __future__ import annotations

import asyncio
import random
import re
import socket
from typing import Any
from urllib.parse import urlencode

import httpx

MIRRORS = ["de1.api.radio-browser.info", "fi1.api.radio-browser.info", "at1.api.radio-browser.info",
           "de2.api.radio-browser.info", "nl1.api.radio-browser.info"]
GOOD_CODECS = {"MP3", "AAC", "AAC+", "OGG", "OPUS"}


def mirrors() -> list[str]:
    """radio-browser asks clients to pick a server from the all.api DNS name; fall back to known ones."""
    found = []
    try:
        for info in socket.getaddrinfo("all.api.radio-browser.info", 443, proto=socket.IPPROTO_TCP):
            try:
                found.append(socket.gethostbyaddr(info[4][0])[0])
            except OSError:
                pass
    except OSError:
        pass
    hosts = list(dict.fromkeys(found)) or MIRRORS[:]
    random.shuffle(hosts)
    return hosts


def search_query(st: dict) -> str:
    q = {"countrycode": st["countrycode"], "hidebroken": "true", "limit": 25, "reverse": "true"}
    if st.get("search"):
        q.update(name=st["search"], order="votes")
    else:  # no station named: the country's most-played station in the directory
        q.update(order="clickcount")
    return "/json/stations/search?" + urlencode(q)


def pick(results: list[dict], search: str | None) -> dict | None:
    """Best match: working, name matches, plain stream over HLS, common codec, most votes."""
    cands = [r for r in results if r.get("lastcheckok") in (1, "1", True)] or results
    if search:
        s = search.lower()
        named = [r for r in cands if s in (r.get("name") or "").lower()]
        cands = named or cands

    def score(r):
        url = r.get("url_resolved") or r.get("url") or ""
        return (
            int(r.get("hls") in (0, "0", False)),
            # then https: browsers refuse http audio on an https page (the GitHub Pages site)
            int(url.startswith("https://")),
            int((r.get("codec") or "").upper() in GOOD_CODECS),
            int(r.get("votes") or 0),
            int(r.get("clickcount") or 0),
        )
    return max(cands, key=score) if cands else None


def to_station(st: dict, r: dict | None) -> dict:
    url = st.get("url") or (r or {}).get("url_resolved") or (r or {}).get("url")
    return {
        "id": st["id"],
        "country": st["country"],
        "tz": st["tz"],
        "name": st.get("name") or (r or {}).get("name", "").strip() or st.get("search") or st["country"],
        "url": url,
        "hls": bool(url and ".m3u8" in url) or (r or {}).get("hls") in (1, "1", True),
        "codec": (r or {}).get("codec") or "",
        "bitrate": int((r or {}).get("bitrate") or 0),
        "homepage": (r or {}).get("homepage") or "",
        "uuid": (r or {}).get("stationuuid"),
    }


async def resolve_all(http: httpx.AsyncClient, stations: list[dict]) -> list[dict]:
    hosts = mirrors()

    async def one(st: dict) -> dict:
        if st.get("url"):
            return to_station(st, None)
        last = None
        for h in hosts[:3]:
            try:
                r = await http.get(f"https://{h}{search_query(st)}")
                r.raise_for_status()
                return to_station(st, pick(r.json(), st.get("search")))
            except Exception as e:  # try the next mirror
                last = e
        return {**to_station(st, None), "error": str(last)[:200]}

    return list(await asyncio.gather(*(one(s) for s in stations)))


# ---------------------------------------------------------------- now playing
_TITLE = re.compile(rb"StreamTitle='(.*?)';", re.S)


def _decode(b: bytes) -> str:
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("latin-1")


def parse_meta(block: bytes) -> str | None:
    m = _TITLE.search(block)
    if not m:
        return None
    t = _decode(m.group(1)).strip()
    return t or None


async def icy_title(http: httpx.AsyncClient, url: str, max_blocks: int = 3) -> str | None:
    """Open the stream, read up to a few metadata blocks, return the first StreamTitle."""
    async def read() -> str | None:
        async with http.stream("GET", url, headers={"Icy-MetaData": "1"}) as r:
            metaint = int(r.headers.get("icy-metaint") or 0)
            if not metaint:
                return None
            buf, blocks = b"", 0
            async for chunk in r.aiter_raw():
                buf += chunk
                while len(buf) > metaint:
                    size = buf[metaint] * 16
                    if len(buf) < metaint + 1 + size:
                        break
                    title = parse_meta(buf[metaint + 1: metaint + 1 + size]) if size else None
                    if title:
                        return title
                    buf = buf[metaint + 1 + size:]
                    blocks += 1
                    if blocks >= max_blocks:
                        return None
        return None
    try:
        return await asyncio.wait_for(read(), timeout=12)
    except Exception:  # old Shoutcast "ICY 200" replies, timeouts, resets
        return None


def split_title(t: str | None) -> dict:
    """'Artist - Song' -> parts; anything else stays as one line."""
    if not t:
        return {"artist": None, "title": None, "raw": None}
    if " - " in t:
        a, s = t.split(" - ", 1)
        return {"artist": a.strip(), "title": s.strip(), "raw": t}
    return {"artist": None, "title": t, "raw": t}
