"""Pictures: random Webb images from NASA's Image and Video Library, and APOD."""
from __future__ import annotations

import html
import re
from typing import Any
from urllib.parse import urlencode

SEARCH = "https://images-api.nasa.gov/search"
# APOD moved to science.nasa.gov in September 2026. The old api.nasa.gov/planetary/apod
# now returns a "we moved" placeholder, so this reads the new WordPress feed (no key needed).
APOD_URL = "https://science.nasa.gov/wp-json/wp/v2/apod-basic?per_page=1"


def search_url(query: str, year_start: int, page: int = 1) -> str:
    return f"{SEARCH}?" + urlencode({"q": query, "media_type": "image", "year_start": year_start, "page": page})


_TAGS = re.compile(r"<[^>]+>")


def clean(text: str, limit: int = 420) -> str:
    # inline tags (links, bold) vanish without a gap; block tags become a space
    t = re.sub(r"</?(a|b|i|em|strong|span|sup|sub)\b[^>]*>", "", text or "", flags=re.I)
    t = html.unescape(_TAGS.sub(" ", t))
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\(\s+", "(", t)
    t = re.sub(r"\s+([),.;:!?])", r"\1", t)
    if len(t) > limit:
        t = t[:limit].rsplit(" ", 1)[0] + "…"
    return t


def large_url(href: str) -> str:
    return re.sub(r"~(thumb|small|medium|orig)\.(jpg|jpeg|png)$", r"~large.\2", href, flags=re.I)


def parse_search(raw: Any, exclude_words: list[str]) -> list[dict]:
    items = ((raw or {}).get("collection") or {}).get("items") or []
    out = []
    bad = [w.lower() for w in exclude_words]
    for it in items:
        d = (it.get("data") or [{}])[0]
        links = it.get("links") or []
        if not links or d.get("media_type") != "image":
            continue
        title = d.get("title") or ""
        desc = d.get("description") or ""
        blob = f"{title} {desc}".lower()
        if "webb" not in blob and "jwst" not in blob:
            continue
        if any(w in blob for w in bad):
            continue
        href = links[0].get("href", "")
        out.append({
            "id": d.get("nasa_id"),
            "title": clean(title, 90),
            "text": clean(desc),
            "date": (d.get("date_created") or "")[:10],
            "credit": d.get("photographer") or d.get("secondary_creator") or d.get("center") or "NASA",
            "preview": href,
            "image": large_url(href),
        })
    return out


def parse_apod(raw: Any) -> dict:
    """NASA Science apod-basic item. `url` is now the article page; the picture is `hdurl`."""
    item = raw[0] if isinstance(raw, list) and raw else raw or {}
    title = item.get("title")
    if isinstance(title, dict):  # plain WordPress shape, just in case
        title = title.get("rendered", "")
    text = clean(item.get("explanation", ""), 700)
    text = re.sub(r"^Explanation:\s*", "", text)
    img = item.get("hdurl") if item.get("media_type", "image") == "image" else None
    if img:  # the image CDN resizes on request; 1280 px is plenty for this screen
        img = re.sub(r"([?&])w=\d+", r"\1w=1280", img)
    return {
        "title": clean(title or "", 120),
        "date": item.get("date", ""),
        "text": text,
        "credit": clean(item.get("copyright") or item.get("credit") or "NASA", 80),
        "media_type": item.get("media_type", "image"),
        "image": img,
        "page": item.get("permalink") or item.get("url"),
    }
