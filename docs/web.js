/* Orbit Desk without a server.
 *
 * When no Raspberry Pi server answers (GitHub Pages, or any plain web host),
 * the page fetches every feed itself, straight from the source, and parses it
 * here into the same shapes the Pi server's /api/... answers with. This is a
 * port of the parsers in orbitdesk/sources/*.py.
 *
 * Nothing needs a key. Each result is kept in localStorage, so a reload doesn't
 * fetch again before the feed is due, and a feed that fails shows its last good
 * copy, marked stale. Slow feeds (ISS orbit data, Mars weather, the picture pool)
 * are fetched rarely, to be kind to the services.
 *
 * A browser can only read a feed whose server allows it (CORS). If one doesn't,
 * its tile says so and everything else keeps working.
 */
window.OrbitWeb = (function () {
"use strict";
const CFG = () => window.ORBIT_CONFIG || {};
const now = () => Date.now() / 1000;
const rad = Math.PI / 180;

/* ------------------------------------------------------------ fetch + cache */
const mem = {}, inflight = {}, errors = {}, failedAt = {};
const LS = "orbitdesk.cache.v1.";
function loadLS(k) { try { return JSON.parse(localStorage.getItem(LS + k)); } catch (e) { return null; } }
function saveLS(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } }

async function get(url, type = "json") {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return type === "json" ? await r.json() : await r.text();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("timed out");
    if (e instanceof TypeError) throw new Error("blocked or offline (the source may not allow browsers to read it)");
    throw e;
  } finally { clearTimeout(timer); }
}

// {fetched_at, data}: the stored copy while it's younger than ttl seconds,
// otherwise a fresh one; if fetching fails, the last good copy (or data: null).
function feed(name, ttl, loader) {
  const c = mem[name] || (mem[name] = loadLS(name));
  if (c && now() - c.fetched_at < ttl) return Promise.resolve(c);
  // after a failure, wait at least a minute (or the feed's interval) before asking again
  if (errors[name] && now() - failedAt[name] < Math.max(ttl, 60)) return Promise.resolve(c || { fetched_at: null, data: null, error: errors[name] });
  if (inflight[name]) return inflight[name];
  return (inflight[name] = (async () => {
    try {
      const fresh = { fetched_at: now(), data: await loader() };
      mem[name] = fresh; saveLS(name, fresh); errors[name] = null;
      return fresh;
    } catch (e) {
      errors[name] = String(e.message || e); failedAt[name] = now();
      console.warn(`Orbit Desk: ${name} failed: ${errors[name]}`);
      return mem[name] || { fetched_at: null, data: null, error: errors[name] };
    } finally { delete inflight[name]; }
  })());
}

/* ------------------------------------------------------------ space weather (NOAA SWPC) */
const SWPC = "https://services.swpc.noaa.gov";
const URLS = {
  kp: `${SWPC}/products/noaa-planetary-k-index.json`,
  kp_forecast: `${SWPC}/products/noaa-planetary-k-index-forecast.json`,
  xray: `${SWPC}/json/goes/primary/xrays-1-day.json`,
  wind: `${SWPC}/json/rtsw/rtsw_wind_1m.json`,
  mag: `${SWPC}/json/rtsw/rtsw_mag_1m.json`,
  alerts: `${SWPC}/products/alerts.json`,
};
const SUN_IMAGES = [
  "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0304.jpg",
  "https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png",
];
const ptime = (s) => Date.parse(String(s).trim().replace(" ", "T").replace(/Z$/, "").split(".")[0] + "Z");
const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + "Z";
const num = (v) => { if (v == null || v === "") return null; const f = Number(v); return Number.isFinite(f) ? f : null; };
const pick = (r, a, b) => (a in r ? r[a] : r[b]);

// SWPC serves some products as arrays of arrays with a header row, some as arrays of objects.
function rows(raw) {
  if (Array.isArray(raw) && raw.length && Array.isArray(raw[0])) {
    const h = raw[0].map(String);
    return raw.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
  }
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r === "object" && !Array.isArray(r)) : [];
}
function gScale(kp) {
  if (kp == null) return 0;
  for (const [lvl, need] of [[5, 9], [4, 8], [3, 7], [2, 6], [1, 5]]) if (kp >= need - 0.34) return lvl;
  return 0;
}
function flareClass(f) {
  if (!f || f <= 0) return "–";
  for (const [l, b] of [["X", 1e-4], ["M", 1e-5], ["C", 1e-6], ["B", 1e-7]]) if (f >= b) return l + (f / b).toFixed(1);
  return "A" + (f / 1e-8).toFixed(1);
}
function rScale(f) {
  if (!f) return 0;
  for (const [lvl, need] of [[5, 2e-3], [4, 1e-3], [3, 1e-4], [2, 5e-5], [1, 1e-5]]) if (f >= need) return lvl;
  return 0;
}
const parseKp = (raw) => rows(raw).map((r) => ({ t: r.time_tag, kp: num(pick(r, "Kp", "kp")) }))
  .filter((r) => r.kp != null && r.t).map((r) => ({ t: iso(ptime(r.t)), kp: r.kp })).sort((a, b) => (a.t < b.t ? -1 : 1));
const parseKpForecast = (raw) => rows(raw).map((r) => ({ t: r.time_tag, kp: num(pick(r, "kp", "Kp")), kind: String(r.observed || "predicted") }))
  .filter((r) => r.kp != null && r.t).map((r) => ({ ...r, t: iso(ptime(r.t)) })).sort((a, b) => (a.t < b.t ? -1 : 1));
function kpWindow(fc, nowMs) {
  if (!fc.length) return [];
  let i = 0;
  fc.forEach((r, k) => { if (Date.parse(r.t) <= nowMs) i = k; });
  const lo = Math.max(0, i - 7);
  return fc.slice(lo, lo + 24);
}
function parseXray(raw) {
  const seen = new Map();
  rows(raw).forEach((r) => {
    if (r.energy !== "0.1-0.8nm" || !r.time_tag) return;
    const f = num(r.flux); if (f == null || f <= 0) return;
    seen.set(iso(ptime(r.time_tag)), f);
  });
  return [...seen.entries()].sort().map(([t, flux]) => ({ t, flux }));
}
function summarizeXray(series, nowMs, buckets = 288) {
  if (!series.length) return { current: null, series: [] };
  const dayAgo = nowMs - 86400000;
  const last = series.filter((r) => Date.parse(r.t) >= dayAgo);
  const use = last.length ? last : series;
  const max = (a) => a.reduce((m, r) => (r.flux > m.flux ? r : m));
  const peak = max(use), three = series.filter((r) => Date.parse(r.t) >= nowMs - 3 * 3600000);
  const p3 = three.length ? max(three) : null, cur = series[series.length - 1];
  const step = 86400000 / buckets, bins = new Map();
  use.forEach((r) => {
    const k = Math.floor((Date.parse(r.t) - dayAgo) / step);
    if (!bins.has(k) || r.flux > bins.get(k).flux) bins.set(k, r);
  });
  const C = (r) => ({ t: r.t, flux: r.flux, class: flareClass(r.flux) });
  return {
    current: C(cur), peak_24h: C(peak),
    peak_3h: p3 ? { ...C(p3), r: rScale(p3.flux) } : null,
    series: [...bins.keys()].sort((a, b) => a - b).map((k) => bins.get(k)),
  };
}
function activeRows(raw) { // RTSW files hold several spacecraft; keep the active one
  const rs = rows(raw).filter((r) => r.time_tag), act = rs.filter((r) => r.active === true);
  return (act.length ? act : rs).sort((a, b) => (a.time_tag < b.time_tag ? -1 : 1));
}
const mean = (vals) => { const v = vals.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
function summarizeWind(windRaw, magRaw, nowMs) {
  const wind = activeRows(windRaw), mag = activeRows(magRaw), hour = nowMs - 3600000;
  const recent = (rs) => rs.filter((r) => ptime(r.time_tag) >= hour);
  const latest = (rs, key) => { for (let i = rs.length - 1; i >= 0; i--) { const v = num(rs[i][key]); if (v != null) return [v, rs[i]]; } return [null, null]; };
  const [speed, wr] = latest(wind, "proton_speed"), [dens] = latest(wind, "proton_density");
  const [bz, mr] = latest(mag, "bz_gsm"), [bt] = latest(mag, "bt");
  const w1 = recent(wind), m1 = recent(mag), ms = mean(w1.map((r) => num(r.proton_speed)));
  const v = ms || speed, day = nowMs - 86400000, bins = new Map();
  wind.forEach((r) => {
    const t = ptime(r.time_tag), s = num(r.proton_speed);
    if (t >= day && s != null) { const k = Math.floor((t - day) / 600000); (bins.get(k) || bins.set(k, []).get(k)).push(s); }
  });
  return {
    t: (wr || mr || {}).time_tag, source: (wr || {}).source, speed, density: dens, bz, bt,
    speed_1h: ms, density_1h: mean(w1.map((r) => num(r.proton_density))),
    bz_1h: mean(m1.map((r) => num(r.bz_gsm))), bt_1h: mean(m1.map((r) => num(r.bt))),
    sun_earth_hours: v ? 149597870.7 / v / 3600 : null,
    speed_spark: [...bins.keys()].sort((a, b) => a - b).map((k) => +(mean(bins.get(k))).toFixed(1)),
  };
}
const HEAD = /^(EXTENDED WARNING|CONTINUED ALERT|WARNING|ALERT|WATCH|SUMMARY|CANCEL(?:LATION)?[A-Z ]*?):\s*(.+?)\s*$/m;
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
function parseAlerts(raw) {
  return rows(raw).map((r) => {
    const msg = String(r.message || "").replace(/\r\n/g, "\n"), m = msg.match(HEAD), sc = msg.match(/NOAA Scale:\s*(.+)/);
    const issued = r.issue_datetime && !isNaN(ptime(r.issue_datetime)) ? iso(ptime(r.issue_datetime)) : null;
    return { id: r.product_id, issued, kind: m ? titleCase(m[1]) : "Notice", title: m ? m[2] : "Space weather message",
             scale: sc ? sc[1].trim() : null, message: msg.trim() };
  }).sort((a, b) => ((b.issued || "") > (a.issued || "") ? 1 : -1));
}
function shortAlert(a) {
  const kind = a.kind.toLowerCase();
  let m = a.title.match(/Category\s+([GRS]\d)/);
  if (m) return `${m[1]} ${{ G: "storm", R: "radio blackout", S: "radiation storm" }[m[1][0]]} ${kind}`;
  m = a.title.match(/K-index of (\d)/);
  if (m) return `K-index ${m[1]} ${kind}`;
  return `${a.kind}: ${a.title}`.slice(0, 48);
}
function banner(kp, xray, alerts, nowMs) {
  const g = gScale(kp);
  if (g) return { level: g >= 3 ? "crit" : "warn", text: `G${g} geomagnetic storm · Kp ${kp.toFixed(1)}`, go: "sun" };
  const p3 = (xray || {}).peak_3h;
  if (p3 && p3.r) return { level: p3.r >= 3 ? "crit" : "warn", text: `R${p3.r} radio blackout · ${p3.class} flare`, go: "sun" };
  for (const a of alerts) {
    if (!a.issued) continue;
    if (nowMs - Date.parse(a.issued) > 12 * 3600000) break;
    if (["Watch", "Warning", "Extended Warning"].includes(a.kind)) return { level: "warn", text: shortAlert(a), go: "sun" };
  }
  return null;
}
function auroraVerdict(win, nowMs, threshold) {
  const ahead = win.filter((r) => { const t = Date.parse(r.t); return t >= nowMs - 3 * 3600000 && t <= nowMs + 24 * 3600000; });
  if (!ahead.length) return { peak: null, level: "unknown", text: "No forecast" };
  const peak = Math.max(...ahead.map((r) => r.kp));
  if (peak >= threshold - 0.34) return { peak, level: "go", text: "Possible tonight" };
  if (peak >= threshold - 1.34) return { peak, level: "watch", text: "Worth a look north" };
  return { peak, level: "no", text: "Unlikely tonight" };
}

const swKp = () => feed("kp", 600, async () => parseKp(await get(URLS.kp)));
const swFc = () => feed("kp_forecast", 1800, async () => parseKpForecast(await get(URLS.kp_forecast)));
const swXray = () => feed("xray", 120, async () => summarizeXray(parseXray(await get(URLS.xray)), Date.now()));
const swWind = () => feed("wind", 120, async () => { const [w, m] = await Promise.all([get(URLS.wind), get(URLS.mag)]); return summarizeWind(w, m, Date.now()); });
const swAlerts = () => feed("alerts", 300, async () => parseAlerts(await get(URLS.alerts)).slice(0, 20));

async function spaceweather() {
  const [kp, fc, xr, wind, al] = await Promise.all([swKp(), swFc(), swXray(), swWind(), swAlerts()]);
  const nowMs = Date.now(), list = kp.data || [], latest = list.length ? list[list.length - 1] : null;
  const win = kpWindow(fc.data || [], nowMs), xray = xr.data || {}, alerts = al.data || [];
  const bucket = Math.floor(nowMs / 900000) * 900; // a new Sun picture every 15 minutes
  return {
    kp: { latest, g: latest ? gScale(latest.kp) : 0, window: win, fetched_at: kp.fetched_at },
    aurora: auroraVerdict(win, nowMs, CFG().aurora_kp_threshold || 7),
    xray: { ...xray, fetched_at: xr.fetched_at },
    wind: { ...(wind.data || {}), fetched_at: wind.fetched_at },
    alerts: alerts.slice(0, 5),
    banner: banner(latest ? latest.kp : null, xray, alerts, nowMs),
    sun_image: { url: `${SUN_IMAGES[0]}?t=${bucket}`, fallback: `${SUN_IMAGES[1]}?t=${bucket}`, image_time: null, saved_at: bucket },
  };
}
// Stands in for NASA DONKI (which needs a key): the latest NOAA alerts, watches and warnings.
async function events() {
  const al = await swAlerts();
  const data = (al.data || []).filter((a) => a.issued && a.kind !== "Summary").slice(0, 8).map((a) => ({
    type: "alert", t: a.issued, title: a.title.slice(0, 70),
    detail: a.kind + (a.scale ? " · " + a.scale : ""), earth: /Warning|Alert/.test(a.kind),
  }));
  return { fetched_at: al.fetched_at, data };
}

/* ------------------------------------------------------------ Deep Space Network (JPL) */
const DSN_FEED = "https://eyes.nasa.gov/dsn/data/dsn.xml", DSN_CONFIG = "https://eyes.nasa.gov/dsn/config.xml";
const SITE_TZ = { gdscc: "America/Los_Angeles", mdscc: "Europe/Madrid", cdscc: "Australia/Sydney" };
const SITE_PLACE = { gdscc: "California", mdscc: "Spain", cdscc: "Australia" };
const SITE_ORDER = ["gdscc", "mdscc", "cdscc"];
const SHORT_NAMES = { JWST: "Webb (JWST)", MRO: "MRO (Mars orbiter)", M20: "Perseverance", MSL: "Curiosity", SPP: "Parker Solar Probe",
  LRO: "LRO (Moon orbiter)", EMM: "Hope (Emirates Mars)", TGO: "ExoMars TGO", MVN: "MAVEN", NHPC: "New Horizons", EURC: "Europa Clipper",
  ORX: "OSIRIS-APEX", STA: "STEREO-A", BEPI: "BepiColombo" };
const NON_TARGETS = new Set(["DSN", "TEST", "RSTS", "RFC", "DSS", "GBRA"]);
const xml = (text) => { const d = new DOMParser().parseFromString(text, "application/xml"); if (d.querySelector("parsererror")) throw new Error("bad XML"); return d; };
const at = (el, k) => el.getAttribute(k);
function parseDsnConfig(text) {
  const d = xml(text), dishes = {}, spacecraft = {};
  d.querySelectorAll("site dish").forEach((el) => {
    const t = (at(el, "type") || "").toUpperCase();
    dishes[(at(el, "name") || "").toUpperCase()] = { friendly: at(el, "friendlyName"), size: t.startsWith("70") ? "70 m" : t.startsWith("34") ? "34 m" : t.toLowerCase() };
  });
  d.querySelectorAll("spacecraft").forEach((el) => { spacecraft[(at(el, "name") || "").toUpperCase()] = at(el, "friendlyName"); });
  return { dishes, spacecraft };
}
function parseDsn(text, conf) {
  conf = conf || { dishes: {}, spacecraft: {} };
  const root = xml(text).documentElement, sites = {}, f = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  let cur = null;
  for (const el of root.children) {
    if (el.tagName === "station") {
      const key = at(el, "name") || "";
      cur = sites[key] = sites[key] || { id: key, name: at(el, "friendlyName") || key, place: SITE_PLACE[key] || "", tz: SITE_TZ[key] || "UTC", dishes: [] };
    } else if (el.tagName === "dish" && cur) {
      const dn = (at(el, "name") || "").toUpperCase(), info = conf.dishes[dn] || {}, rtlt = {}, links = {};
      el.querySelectorAll("target").forEach((t) => { const r = f(at(t, "rtlt")); if (r && r > 0) rtlt[(at(t, "name") || "").toUpperCase()] = r; });
      const link = (code) => (links[code] = links[code] || { code, name: SHORT_NAMES[code] || conf.spacecraft[code] || code, up: false, down: false, down_rate: 0, band: null, rtlt_s: rtlt[code] || null });
      el.querySelectorAll("downSignal").forEach((s) => {
        const code = (at(s, "spacecraft") || "").toUpperCase();
        if (at(s, "active") !== "true" || !code || NON_TARGETS.has(code)) return;
        const L = link(code), rate = f(at(s, "dataRate")) || 0;
        L.down = true; if (rate >= L.down_rate) { L.down_rate = rate; L.band = at(s, "band"); }
      });
      el.querySelectorAll("upSignal").forEach((s) => {
        const code = (at(s, "spacecraft") || "").toUpperCase();
        if (at(s, "active") !== "true" || !code || NON_TARGETS.has(code)) return;
        const L = link(code); L.up = true; L.band = L.band || at(s, "band");
      });
      cur.dishes.push({ name: info.friendly || dn.replace("DSS", "DSS-"), size: info.size || "", activity: at(el, "activity") || "",
        az: f(at(el, "azimuthAngle")), el: f(at(el, "elevationAngle")), links: Object.values(links) });
    }
  }
  return { sites: [...SITE_ORDER.filter((k) => sites[k]).map((k) => sites[k]), ...Object.keys(sites).filter((k) => !SITE_ORDER.includes(k)).map((k) => sites[k])] };
}
async function dsn() {
  const conf = await feed("dsn_config", 86400, async () => parseDsnConfig(await get(DSN_CONFIG, "text")));
  return feed("dsn", 10, async () => parseDsn(await get(`${DSN_FEED}?r=${Math.floor(Date.now() / 5000)}`, "text"), conf.data));
}

/* ------------------------------------------------------------ ISS (CelesTrak + satellite.js) */
const TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE";
function parseTle(text) {
  const ls = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), i = ls.findIndex((l) => l.startsWith("1 "));
  if (i < 0 || !(ls[i + 1] || "").startsWith("2 ")) throw new Error("no TLE in the answer");
  return { name: i > 0 ? ls[i - 1] : "ISS (ZARYA)", line1: ls[i], line2: ls[i + 1] };
}
function sunEq(d) { // low-precision Sun direction, equatorial unit vector
  const n = d.getTime() / 86400000 + 2440587.5 - 2451545, g = (357.528 + 0.9856003 * n) * rad;
  const lam = (280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, eps = (23.439 - 4e-7 * n) * rad;
  return [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
}
const compass = (az) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.floor(((az % 360) + 360) % 360 / 45 + 0.5) % 8];
// Passes above 10°, like the Pi's Skyfield version: step 30 s, refine the edges to ~1 s.
function passes(tle, home, days = 3, minAlt = 10) {
  const S = window.satellite; if (!S || !tle) return [];
  const rec = S.twoline2satrec(tle.line1, tle.line2);
  const obs = { latitude: home.lat * rad, longitude: home.lon * rad, height: (home.elevation_m || 0) / 1000 };
  const look = (ms) => {
    const d = new Date(ms), pv = S.propagate(rec, d); if (!pv || !pv.position) return null;
    const gm = S.gstime(d), la = S.ecfToLookAngles(obs, S.eciToEcf(pv.position, gm));
    return { el: la.elevation / rad, az: la.azimuth / rad, p: pv.position, gm };
  };
  const edge = (a, b, rising) => { // bisect the 10° crossing between a and b
    for (let i = 0; i < 6; i++) { const m = (a + b) / 2, l = look(m); if (l && (l.el >= minAlt) === rising) b = m; else a = m; }
    return b;
  };
  const out = [], t0 = Date.now(), t1 = t0 + days * 86400000, step = 30000;
  let prev = look(t0), rise = prev && prev.el >= minAlt ? null : undefined, peak = null;
  for (let t = t0 + step; t <= t1; t += step) {
    const l = look(t); if (!l || !prev) { prev = l; continue; }
    if (prev.el < minAlt && l.el >= minAlt) { rise = edge(t - step, t, true); peak = { t, ...l }; }
    else if (rise && l.el >= minAlt && l.el > peak.el) peak = { t, ...l };
    if (rise && prev.el >= minAlt && l.el < minAlt) {
      let lo = peak.t - step, hi = peak.t + step; // refine the highest point
      for (let i = 0; i < 24; i++) { const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3, la = look(a), lb = look(b); if (la && lb && la.el < lb.el) lo = a; else hi = b; }
      const top = look((lo + hi) / 2); if (top && top.el > peak.el) peak = { t: (lo + hi) / 2, ...top };
      const set = edge(t - step, t, false), r = look(rise), s = look(set), d = new Date(peak.t);
      const sv = sunEq(d), p = [peak.p.x, peak.p.y, peak.p.z], along = p[0] * sv[0] + p[1] * sv[1] + p[2] * sv[2];
      const lit = along > 0 || Math.hypot(p[0] - along * sv[0], p[1] - along * sv[1], p[2] - along * sv[2]) > 6371;
      const ra = Math.atan2(sv[1], sv[0]), dec = Math.asin(sv[2]), ha = peak.gm + home.lon * rad - ra;
      const sunAlt = Math.asin(Math.sin(home.lat * rad) * Math.sin(dec) + Math.cos(home.lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
      out.push({ start: iso(rise), duration_s: Math.round((set - rise) / 1000), max_alt: Math.round(peak.el),
                 from: compass(r.az), to: compass(s.az), visible: lit && sunAlt < -6 });
      rise = null; peak = null;
    }
    prev = l;
  }
  return out;
}
let passMemo = { key: "", at: 0, data: [] };
async function iss() {
  const t = await feed("tle", 6 * 3600, async () => parseTle(await get(TLE_URL, "text"))); // CelesTrak asks for no more than every 2 h
  if (!t.data) return null;
  const key = t.data.line1 + JSON.stringify(CFG().location);
  if (passMemo.key !== key || Date.now() - passMemo.at > 1800000) {
    try { passMemo = { key, at: Date.now(), data: passes(t.data, CFG().location) }; } catch (e) { passMemo = { key, at: Date.now(), data: [] }; }
  }
  return { tle: t.data, tle_fetched_at: t.fetched_at, passes: passMemo.data, now: null };
}

/* ------------------------------------------------------------ pictures (NASA) */
function clean(text, limit = 420) {
  let t = String(text || "").replace(/<\/?(a|b|i|em|strong|span|sup|sub)\b[^>]*>/gi, "").replace(/<[^>]+>/g, " ");
  t = new DOMParser().parseFromString(`<!doctype html><body>${t.replace(/</g, "&lt;")}`, "text/html").body.textContent; // decode entities
  t = t.replace(/\s+/g, " ").trim().replace(/\(\s+/g, "(").replace(/\s+([),.;:!?])/g, "$1");
  if (t.length > limit) t = t.slice(0, limit).replace(/\s+\S*$/, "") + "…";
  return t;
}
const largeUrl = (h) => h.replace(/~(thumb|small|medium|orig)\.(jpg|jpeg|png)$/i, "~large.$2");
function parseSearch(raw, exclude) {
  const bad = (exclude || []).map((w) => w.toLowerCase());
  return (((raw || {}).collection || {}).items || []).flatMap((it) => {
    const d = (it.data || [{}])[0], links = it.links || [];
    if (!links.length || d.media_type !== "image") return [];
    const title = d.title || "", desc = d.description || "", blob = `${title} ${desc}`.toLowerCase();
    if (!blob.includes("webb") && !blob.includes("jwst")) return [];
    if (bad.some((w) => blob.includes(w))) return [];
    const href = links[0].href || "";
    return [{ id: d.nasa_id, title: clean(title, 90), text: clean(desc), date: (d.date_created || "").slice(0, 10),
              credit: d.photographer || d.secondary_creator || d.center || "NASA", preview: href, image: largeUrl(href) }];
  });
}
async function galleryPool() {
  const g = CFG().gallery || {}, pool = new Map();
  let last = null;
  for (const q of g.queries || ["Webb nebula", "Webb galaxy"]) {
    try {
      const u = "https://images-api.nasa.gov/search?" + new URLSearchParams({ q, media_type: "image", year_start: g.year_start || 2022 });
      parseSearch(await get(u), g.exclude_words).forEach((it) => { if (!pool.has(it.id)) pool.set(it.id, it); });
    } catch (e) { last = e; }
  }
  if (!pool.size) throw last || new Error("image search returned nothing usable");
  return [...pool.values()];
}
// APOD moved to science.nasa.gov in 2026; this is its public WordPress feed (no key).
const APOD_URL = "https://science.nasa.gov/wp-json/wp/v2/apod-basic?per_page=1";
function parseApod(raw) {
  const it = Array.isArray(raw) ? raw[0] || {} : raw || {};
  let title = it.title; if (title && typeof title === "object") title = title.rendered || "";
  const img = (it.media_type || "image") === "image" && it.hdurl ? it.hdurl.replace(/([?&])w=\d+/, "$1w=1280") : null;
  return { title: clean(title || "", 120), date: it.date || "", text: clean(it.explanation || "", 700).replace(/^Explanation:\s*/, ""),
           credit: clean(it.copyright || it.credit || "NASA", 80), media_type: it.media_type || "image", image: img, page: it.permalink || it.url };
}

/* ------------------------------------------------------------ Mars (Curiosity REMS) */
function parseMars(raw, keep = 14) {
  const n = (v) => num(v), s = (v) => (v == null || ["", "--"].includes(String(v).trim()) ? null : String(v).trim());
  return ((raw || {}).soles || []).filter((x) => n(x.sol) != null).map((x) => ({
    sol: Math.trunc(n(x.sol)), date: s(x.terrestrial_date), season: s(x.season), ls: n(x.ls), min_temp: n(x.min_temp), max_temp: n(x.max_temp),
    min_ground: n(x.min_gts_temp), max_ground: n(x.max_gts_temp), pressure: n(x.pressure), sky: s(x.atmo_opacity),
    uv: s(x.local_uv_irradiance_index), sunrise: s(x.sunrise), sunset: s(x.sunset),
  })).sort((a, b) => b.sol - a.sol).filter((r) => r.min_temp != null || r.max_temp != null).slice(0, keep);
}
async function mars() {
  return feed("mars", 6 * 3600, async () => {
    const urls = ["https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json"];
    if (location.protocol === "http:") urls.push("http://cab.inta-csic.es/rems/wp-content/plugins/marsweather-widget/api.php");
    let last;
    for (const u of urls) { try { const s = parseMars(await get(u)); if (s.length) return s; } catch (e) { last = e; } }
    throw last || new Error("no Mars weather in the feed");
  });
}

/* ------------------------------------------------------------ radio (radio-browser.info) */
const MIRRORS = ["de1.api.radio-browser.info", "fi1.api.radio-browser.info", "at1.api.radio-browser.info", "de2.api.radio-browser.info", "nl1.api.radio-browser.info"];
const GOOD_CODECS = new Set(["MP3", "AAC", "AAC+", "OGG", "OPUS"]);
function pickStation(results, search) {
  const ok = (v) => v === 1 || v === "1" || v === true;
  let c = results.filter((r) => ok(r.lastcheckok)); if (!c.length) c = results;
  if (search) { const s = search.toLowerCase(), named = c.filter((r) => (r.name || "").toLowerCase().includes(s)); if (named.length) c = named; }
  const score = (r) => [Number([0, "0", false].includes(r.hls)), Number((r.url_resolved || r.url || "").startsWith("https://")),
    Number(GOOD_CODECS.has((r.codec || "").toUpperCase())), +r.votes || 0, +r.clickcount || 0];
  const cmp = (a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  return c.length ? c.reduce((best, r) => (cmp(r, best) > 0 ? r : best)) : null;
}
function toStation(st, r) {
  r = r || {};
  const url = st.url || r.url_resolved || r.url || "";
  return { id: st.id, country: st.country, tz: st.tz, name: st.name || (r.name || "").trim() || st.search || st.country, url,
           hls: (!!url && url.includes(".m3u8")) || [1, "1", true].includes(r.hls), codec: r.codec || "", bitrate: +r.bitrate || 0,
           homepage: r.homepage || "", uuid: r.stationuuid || null };
}
async function radio() {
  return feed("radio", 86400, async () => {
    const hosts = [...MIRRORS].sort(() => Math.random() - 0.5);
    const list = await Promise.all((CFG().radio || []).map(async (st) => {
      if (st.url) return toStation(st, null);
      const q = { countrycode: st.countrycode, hidebroken: "true", limit: 25, reverse: "true" };
      Object.assign(q, st.search ? { name: st.search, order: "votes" } : { order: "clickcount" });
      let last;
      for (const h of hosts.slice(0, 3)) {
        try { return toStation(st, pickStation(await get(`https://${h}/json/stations/search?${new URLSearchParams(q)}`), st.search)); }
        catch (e) { last = e; }
      }
      return { ...toStation(st, null), error: String(last && last.message) };
    }));
    if (!list.some((s) => s.url)) throw new Error("no radio stream found");
    return list;
  });
}

/* ------------------------------------------------------------ status + entry point */
const LIMITS = { swpc: ["kp", 900], alerts: ["alerts", 1800], dsn: ["dsn", 120], tle: ["tle", 3 * 86400],
  gallery_current: ["gallery", 2 * 86400], apod: ["apod", 36 * 3600], mars: ["mars", 3 * 86400], radio: ["radio", 3 * 86400] };
function status() {
  const feeds = {};
  Object.entries(LIMITS).forEach(([name, [key, limit]]) => {
    const c = mem[key] || loadLS(key), err = errors[key];
    if (!c && err === undefined) return; // not asked for yet
    const age = c ? now() - c.fetched_at : null;
    feeds[name] = { fetched_at: c ? c.fetched_at : null, age_s: age, limit_s: limit, stale: age == null || age > limit, error: err || null };
  });
  return { feeds, demo: false, web: true };
}
function config() {
  const c = CFG();
  return { location: c.location, aurora_kp_threshold: c.aurora_kp_threshold || 7, iss_stream_url: c.iss_stream_url || "",
           themes: c.themes || [], gallery_rotate_minutes: (c.gallery || {}).rotate_minutes || 15, site: c.site || {}, demo: false, web: true };
}
async function api(path) {
  switch (path.replace(/^\/api\//, "").replace(/\?.*$/, "")) {
    case "config": return config();
    case "spaceweather": return spaceweather();
    case "donki": return events();
    case "dsn": return dsn();
    case "iss": return iss();
    case "gallery": return feed("gallery", 12 * 3600, galleryPool);
    case "apod": return feed("apod", 3 * 3600, async () => parseApod(await get(APOD_URL)));
    case "mars": return mars();
    case "radio": return radio();
    case "status": return status();
    default: return null;
  }
}
return { api, config, status, _test: { parseKp, parseKpForecast, kpWindow, parseXray, summarizeXray, summarizeWind, parseAlerts,
  banner, auroraVerdict, parseDsn, parseDsnConfig, parseTle, passes, parseSearch, parseApod, parseMars, pickStation, toStation, clean } };
})();
