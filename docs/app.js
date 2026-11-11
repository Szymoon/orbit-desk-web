(function () {
"use strict";
const $ = (s) => document.querySelector(s);
const stage = $("#stage");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = (n) => getComputedStyle(stage).getPropertyValue(n).trim();
const rad = Math.PI / 180;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

if (new URLSearchParams(location.search).has("kiosk")) document.body.classList.add("kiosk");

/* ------------------------------------------------------------ fit to screen */
function fitStage() {
  const s = Math.min(innerWidth / 1024, innerHeight / 600);
  stage.style.transform = `translate(${(innerWidth - 1024 * s) / 2}px, ${(innerHeight - 600 * s) / 2}px) scale(${s})`;
}
addEventListener("resize", fitStage); fitStage();

/* ------------------------------------------------------------ API */
// Two ways to run. On the Pi, a local Python server answers /api/...
// Anywhere else (GitHub Pages, any plain web host) there is no server, so the
// page fetches the feeds itself through web.js, which answers the same paths.
// The page checks for a server at start-up; add ?web to the address to skip it.
let STATIC = false;
async function api(path, opts) {
  if (STATIC) return (opts && opts.method && opts.method !== "GET") ? null : window.OrbitWeb.api(path);
  try {
    const r = await fetch(path, opts);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) { return null; }
}
const mediaUrl = (file, v) => `${STATIC ? "" : "/"}media/${encodeURIComponent(file)}?v=${Math.round(v || 0)}`;
// Small per-browser storage for the website's settings. Never required: it can be blocked.
const local = {
  get(k, d) { try { const v = localStorage.getItem("orbitdesk." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("orbitdesk." + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
let CFG = { location: { name: "Home", lat: 50.06, lon: 19.94, timezone: "Europe/Warsaw" }, aurora_kp_threshold: 7, iss_stream_url: "" };
let TZ = CFG.location.timezone;

function ago(ts) {
  if (!ts) return "no data";
  const s = Date.now() / 1000 - ts;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
function stamp(el, ts, limit, prefix = "") {
  if (!el) return;
  el.textContent = prefix + ago(ts);
  el.classList.toggle("stale", !ts || Date.now() / 1000 - ts > limit);
}
const fmtT = (d, tz = TZ) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const fmtDay = (d, tz = TZ) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(d);
const localDate = (d, tz = TZ) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
const fix = (v, n = 1) => (v == null || isNaN(v) ? "–" : Number(v).toFixed(n));

/* ------------------------------------------------------------ navigation */
const icons = {
  home: '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  worlds: '<circle cx="12" cy="12" r="5"/><ellipse cx="12" cy="12" rx="10.5" ry="3.5" transform="rotate(-20 12 12)"/>',
  iss: '<rect x="9" y="9" width="6" height="6"/><path d="M2 7h5v10H2zM17 7h5v10h-5zM7 12h2M15 12h2"/>',
  dsn: '<path d="M4 18a10 10 0 0 1 12-12"/><path d="M6 20L14 8"/><path d="M4 21h8"/><path d="M17 3a4 4 0 0 1 4 4M17 6a1 1 0 0 1 1 1"/>',
  gallery: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>',
  radio: '<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M7 9L17 3"/><circle cx="15.5" cy="15" r="2.5"/><path d="M6 13h4M6 17h4"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
};
const screens = [["home", "Home"], ["sun", "Sun"], ["worlds", "Worlds"], ["iss", "ISS"], ["dsn", "DSN"], ["gallery", "Gallery"], ["radio", "Radio"], ["settings", "Display"]];
const dock = $("#dock");
let current = "home", lastTouch = Date.now();
screens.forEach(([id, lab]) => {
  const b = document.createElement("button");
  b.dataset.go = id;
  b.innerHTML = `<svg viewBox="0 0 24 24">${icons[id]}</svg>${lab}`;
  dock.appendChild(b);
});
function go(id) {
  current = id;
  screens.forEach(([s]) => { $("#" + s).hidden = s !== id; });
  dock.querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", b.dataset.go === id ? "true" : "false"));
  $("#scrName").textContent = $("#" + id).dataset.name;
  closeLive();
  renderScreen();
}
stage.addEventListener("pointerdown", () => { lastTouch = Date.now(); });
stage.addEventListener("click", (e) => { const t = e.target.closest("[data-go]"); if (t) go(t.dataset.go); });
$("#alert").addEventListener("click", () => go("sun"));
// Minimize: the server hides this window so the desktop can be used.
// The Orbit Desk icon on the desktop (or in the taskbar) brings it back.
$("#minBtn").hidden = true; // shown at start-up when a Pi server answers
$("#minBtn").addEventListener("click", () => api("/api/kiosk/minimize", { method: "POST" }));

/* ------------------------------------------------------------ astronomy done here */
const EL = {
  Mercury: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
  Venus: [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890, 181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  Earth: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0],
  Mars: [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  Jupiter: [5.20288700, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  Saturn: [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
  Uranus: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451, 428.48202785, 170.95427630, 0.40805281, 74.01692503, 0.04240589],
  Neptune: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664],
};
const jd = (d) => d.getTime() / 86400000 + 2440587.5;
function helio(p, d) {
  const T = (jd(d) - 2451545) / 36525;
  let [a, da, e, de, I, dI, L, dL, W, dW, O, dO] = EL[p];
  a += da * T; e += de * T; I = (I + dI * T) * rad; L += dL * T; W += dW * T; O += dO * T;
  const w = (W - O) * rad; O *= rad;
  let M = ((((L - W) % 360) + 540) % 360 - 180) * rad, E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return { x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp, y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, z: sw * sI * xp + cw * sI * yp, a };
}
function fromEarth(p, d) {
  const P = helio(p, d), E = helio("Earth", d);
  const au = Math.hypot(P.x - E.x, P.y - E.y, P.z - E.z);
  return { au, min: (au * 499.004784) / 60 };
}
const fmtLT = (m) => (m < 60 ? `${m.toFixed(1)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")} m`);
const landing = Date.UTC(2012, 7, 6, 5, 17, 57), SOL = 88775.244 * 1000;
const sol = (d) => Math.floor((d - landing) / SOL + 0.6);
function moon(d) {
  const P = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
  let age = ((d - ref) / 86400000) % P; if (age < 0) age += P;
  const names = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
  return { ill: (1 - Math.cos((2 * Math.PI * age) / P)) / 2, name: names[Math.floor((age / P) * 8 + 0.5) % 8], frac: age / P };
}
function drawMoon() {
  const c = $("#moonCv"), x = c.getContext("2d"), m = moon(new Date());
  x.setTransform(2, 0, 0, 2, 0, 0); x.clearRect(0, 0, 80, 80);
  const r = 36, cx = 40, cy = 40, waxing = m.frac < 0.5, k = Math.cos(2 * Math.PI * m.frac);
  x.fillStyle = css("--line"); x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  x.fillStyle = css("--text"); x.beginPath(); x.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, !waxing); x.closePath(); x.fill();
  x.fillStyle = k > 0 ? css("--line") : css("--text"); x.beginPath(); x.ellipse(cx, cy, Math.max(0.5, Math.abs(k) * r), r, 0, 0, 7); x.fill();
  $("#moonPct").textContent = Math.round(m.ill * 100) + "%";
  $("#moonName").textContent = m.name;
}

/* ------------------------------------------------------------ clocks */
function tick() {
  const d = new Date();
  $("#cLocal").textContent = fmtT(d); $("#cUtc").textContent = fmtT(d, "UTC");
  $("#bigClock").textContent = fmtT(d);
  $("#bigDate").textContent = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(d);
  $("#solHome").textContent = "Sol " + sol(d);
  $("#ltMars").textContent = fromEarth("Mars", d).min.toFixed(1) + " min";
  if (current === "radio") renderRadioTimes(d);
  if (current === "dsn") document.querySelectorAll("#dsn [data-tz]").forEach((e) => (e.textContent = fmtT(d, e.dataset.tz)));
}
setInterval(tick, 1000);

/* ------------------------------------------------------------ space weather */
let SW = null, lastBanner = null;
const KP_WORDS = ["Quiet", "Quiet", "Quiet", "Unsettled", "Active", "Minor storm", "Moderate storm", "Strong storm", "Severe storm", "Extreme storm"];
const kpColor = (v) => (v >= 4.66 ? css("--warn") : v >= 4 ? css("--accent") : css("--good"));

async function loadSW() {
  const d = await api("/api/spaceweather");
  if (!d) return;
  SW = d;
  renderBanner(d.banner);
  renderSWHome();
  if (current === "sun") renderSWScreen();
}
function renderBanner(b) {
  const el = $("#alert");
  el.hidden = !b;
  if (!b) { lastBanner = null; return; }
  $("#alertText").textContent = b.text;
  el.classList.toggle("crit", b.level === "crit");
  if (lastBanner !== null && lastBanner !== b.text && current !== "sun") go("sun");
  lastBanner = b.text;
}
function renderSWHome() {
  const d = SW; if (!d) return;
  const k = d.kp.latest;
  $("#hKp").textContent = k ? `Kp ${fix(k.kp, 1).replace(".0", "")}` : "Kp –";
  const g = $("#hG");
  g.hidden = !d.kp.g; g.textContent = "G" + d.kp.g; g.className = "chip" + (d.kp.g >= 3 ? " crit" : "");
  $("#hKpText").textContent = k ? `${KP_WORDS[Math.min(9, Math.round(k.kp))]}. Aurora: ${d.aurora.text.toLowerCase()}.` : "";
  stamp($("#kpAge"), d.kp.fetched_at, 900);
  const bars = $("#kpMini"); bars.innerHTML = "";
  const now = new Date();
  (d.kp.window || []).forEach((w) => {
    const i = document.createElement("i");
    i.style.height = Math.max(4, (w.kp / 9) * 100) + "%";
    i.style.background = kpColor(w.kp);
    if (new Date(w.t) > now) i.className = "future";
    bars.appendChild(i);
  });
  const x = d.xray || {};
  $("#hFlare").textContent = x.peak_24h ? x.peak_24h.class : "–";
  const w = d.wind || {};
  $("#hSpeed").innerHTML = `${w.speed != null ? Math.round(w.speed) : "–"}<span class="unit">km/s</span>`;
  $("#hDens").textContent = w.density != null ? `${fix(w.density)} p/cm³` : "–";
  const bz = $("#hBz"); bz.textContent = w.bz != null ? `${w.bz > 0 ? "+" : "−"}${fix(Math.abs(w.bz))} nT` : "–";
  bz.style.color = w.bz != null && w.bz < -5 ? css("--warn") : "";
  stamp($("#windAge"), w.fetched_at, 900);
  const si = d.sun_image;
  if (si && (si.file || si.url)) {
    // Pi: the server saved the freshest image. Website: load NASA's latest straight away.
    const img = $("#sunImg"), src = si.file ? mediaUrl(si.file, si.saved_at) : si.url;
    if (img.getAttribute("src") !== src) { img.dataset.fallback = si.fallback || ""; img.src = src; }
    if (si.file) stamp($("#sunAge"), si.image_time || si.saved_at, 6 * 3600, "image ");
    else $("#sunAge").textContent = "latest";
  }
}
function renderSWScreen() {
  const d = SW; if (!d) return;
  drawXray(d.xray); drawKpChart(d.kp.window || []);
  stamp($("#xrAge"), d.xray.fetched_at, 900); stamp($("#kpAge2"), d.kp.fetched_at, 900);
  $("#auroraWhere").textContent = CFG.location.name;
  const a = d.aurora, v = $("#auroraVerdict");
  v.textContent = a.text; v.className = "verdict " + a.level;
  $("#auroraText").textContent = a.peak == null ? "" :
    `Forecast peak in the next 24 h is Kp ${fix(a.peak, 1)}. At about ${Math.round(Math.abs(CFG.location.lat))}° you typically need Kp ${CFG.aurora_kp_threshold} or more, plus a dark, clear northern horizon.`;
  const w = d.wind || {};
  $("#windSrc").textContent = w.source ? w.source : "--";
  $("#wSpeed").textContent = w.speed_1h != null ? `${Math.round(w.speed_1h)} km/s` : "–";
  $("#wDens").textContent = w.density_1h != null ? `${fix(w.density_1h)} p/cm³` : "–";
  $("#wB").textContent = w.bt_1h != null ? `${fix(w.bt_1h)} / ${fix(w.bz_1h)} nT` : "–";
  $("#wTravel").textContent = w.sun_earth_hours ? `≈ ${Math.round(w.sun_earth_hours)} h` : "–";
}
function drawXray(x) {
  const s = $("#xray"), W = 640, H = 230, L = 34, R = 8, T = 8, B = 20, lo = -9, hi = -3;
  const now = Date.now(), t0 = now - 86400000;
  const y = (v) => T + (H - T - B) * (1 - (Math.log10(Math.max(v, 1e-9)) - lo) / (hi - lo));
  const X = (t) => L + (W - L - R) * Math.min(1, Math.max(0, (t - t0) / 86400000));
  let h = "";
  [["A", -8], ["B", -7], ["C", -6], ["M", -5], ["X", -4]].forEach(([n, e]) => {
    const yy = y(10 ** e);
    h += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${css("--line")}"/><text x="${L - 8}" y="${yy - 3}" text-anchor="end" style="fill:${n === "M" || n === "X" ? css("--warn") : css("--muted")}">${n}</text>`;
  });
  for (let hh = 0; hh <= 24; hh += 6) h += `<text x="${X(t0 + hh * 3600000)}" y="${H - 4}" text-anchor="middle">${hh === 24 ? "now" : "−" + (24 - hh) + " h"}</text>`;
  const ser = (x && x.series) || [];
  if (ser.length > 1) {
    const pts = ser.map((r) => `${X(Date.parse(r.t)).toFixed(1)},${y(r.flux).toFixed(1)}`).join(" ");
    const first = X(Date.parse(ser[0].t)), last = X(Date.parse(ser[ser.length - 1].t));
    h += `<polygon points="${first},${H - B} ${pts} ${last},${H - B}" fill="${css("--accent")}" opacity=".12"/>`;
    h += `<polyline points="${pts}" fill="none" stroke="${css("--accent")}" stroke-width="1.8"/>`;
    if (x.peak_24h) {
      const px = X(Date.parse(x.peak_24h.t)), py = y(x.peak_24h.flux);
      const right = px > W - 140;
      h += `<circle cx="${px}" cy="${py}" r="4" fill="${css("--warn")}"/><text x="${right ? px - 8 : px + 8}" y="${py + 4}" text-anchor="${right ? "end" : "start"}" style="fill:${css("--text")}">${x.peak_24h.class} peak</text>`;
    }
  } else {
    h += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">Waiting for data</text>`;
  }
  s.innerHTML = h;
}
function drawKpChart(win) {
  const s = $("#kpChart"), W = 640, H = 170, L = 26, B = 22, T = 6, bw = (W - L) / 24;
  let h = "";
  for (let k = 0; k <= 9; k += 3) {
    const yy = T + (H - T - B) * (1 - k / 9);
    h += `<line x1="${L}" x2="${W}" y1="${yy}" y2="${yy}" stroke="${css("--line")}"/><text x="4" y="${yy + 4}">${k}</text>`;
  }
  const y5 = T + (H - T - B) * (1 - 4.67 / 9);
  h += `<line x1="${L}" x2="${W}" y1="${y5}" y2="${y5}" stroke="${css("--warn")}" stroke-dasharray="4 4"/><text x="${W - 4}" y="${y5 - 4}" text-anchor="end" style="fill:${css("--warn")}">storm G1</text>`;
  const now = Date.now(); let prevDay = null;
  win.forEach((w, i) => {
    const t = Date.parse(w.t), bh = ((H - T - B) * w.kp) / 9, x = L + i * bw + 2;
    h += `<rect x="${x}" y="${H - B - bh}" width="${bw - 4}" height="${bh}" fill="${kpColor(w.kp)}" opacity="${w.kind === "predicted" ? 0.5 : 1}"/>`;
    const day = localDate(new Date(t));
    if (day !== prevDay) {
      if (prevDay !== null) h += `<line x1="${L + i * bw}" x2="${L + i * bw}" y1="${T}" y2="${H - B}" stroke="${css("--line")}"/>`;
      h += `<text x="${L + i * bw + 4}" y="${H - 5}">${fmtDay(new Date(t))}</text>`;
      prevDay = day;
    }
    if (t <= now && now < t + 3 * 3600000) {
      const nx = L + i * bw + ((now - t) / (3 * 3600000)) * bw;
      h += `<line x1="${nx}" x2="${nx}" y1="${T}" y2="${H - B}" stroke="${css("--text")}" stroke-width="1.5"/><text x="${nx + 4}" y="${T + 10}" style="fill:${css("--text")}">now</text>`;
    }
  });
  if (!win.length) h += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">Waiting for data</text>`;
  s.innerHTML = h;
}

async function loadDonki() {
  const d = await api("/api/donki");
  const box = $("#donkiList");
  if (!d || !d.data) { box.innerHTML = '<div class="muted small">No events loaded yet.</div>'; return; }
  // The website has no NASA key, so this tile shows NOAA's latest alert instead of DONKI.
  stamp($("#donkiAge"), d.fetched_at, STATIC ? 1800 : 12 * 3600, STATIC ? "NOAA · " : "DONKI · ");
  box.innerHTML = d.data.slice(0, 1).map((e) => {
    const t = new Date(e.t);
    return `<div class="ev${e.earth ? " earth" : ""}"><time>${fmtDay(t)} ${fmtT(t)}</time><b>${esc(e.title)}</b><div class="d">${esc(e.detail)}${e.arrival ? " " + fmtDay(new Date(e.arrival)) + " " + fmtT(new Date(e.arrival)) : ""}</div></div>`;
  }).join("") || `<div class="muted small">Quiet: ${STATIC ? "no recent NOAA alerts" : "nothing in the last 10 days"}.</div>`;
}

/* ------------------------------------------------------------ ISS */
let ISS = null;
const cities = [["Houston", 29.76, -95.37], ["Baikonur", 45.96, 63.31], ["Tokyo", 35.68, 139.69], ["Sydney", -33.87, 151.21], ["Nairobi", -1.29, 36.82], ["Lima", -12.05, -77.04]];
function trackSVG(W, H, big) {
  const X = (l) => ((l + 180) / 360) * W, Y = (l) => ((90 - l) / 180) * H;
  let h = `<path d="${window.WORLD_PATH || ""}" transform="scale(${W / 360},${H / 180})" fill="${css("--land")}"/>`;
  for (let l = -60; l <= 60; l += 30) h += `<line x1="0" x2="${W}" y1="${Y(l)}" y2="${Y(l)}" stroke="${css("--line")}" stroke-width=".7"/>`;
  for (let l = -150; l <= 150; l += 30) h += `<line y1="0" y2="${H}" x1="${X(l)}" x2="${X(l)}" stroke="${css("--line")}" stroke-width=".7"/>`;
  if (big) cities.forEach(([n, a, b]) => { h += `<circle cx="${X(b)}" cy="${Y(a)}" r="2.5" fill="${css("--muted")}"/><text x="${X(b) + 6}" y="${Y(a) + 4}">${n}</text>`; });
  const hl = CFG.location;
  h += `<circle cx="${X(hl.lon)}" cy="${Y(hl.lat)}" r="${big ? 4 : 3}" fill="${css("--accent2")}"/>`;
  if (big) h += `<text x="${X(hl.lon) + 7}" y="${Y(hl.lat) - 5}" style="fill:${css("--accent2")}">${esc(hl.name)}</text>`;
  if (!ISS) return h;
  const segs = []; let seg = [], prev = null;
  ISS.now.track.forEach(([la, lo, m]) => {
    if (prev && (Math.abs(lo - prev[1]) > 180 || (prev[2] < 0) !== (m < 0))) {
      segs.push(seg); seg = (prev[2] < 0) !== (m < 0) && Math.abs(lo - prev[1]) <= 180 ? [prev] : [];
    }
    seg.push([la, lo, m]); prev = [la, lo, m];
  });
  segs.push(seg);
  segs.forEach((sg) => {
    if (sg.length < 2) return;
    const future = sg[sg.length - 1][2] > 0;
    h += `<polyline points="${sg.map((q) => X(q[1]).toFixed(1) + "," + Y(q[0]).toFixed(1)).join(" ")}" fill="none" stroke="${future ? css("--accent") : css("--muted")}" stroke-width="${future ? 2 : 1.4}" ${future ? "" : 'stroke-dasharray="3 3"'} vector-effect="non-scaling-stroke"/>`;
  });
  const n = ISS.now;
  h += `<circle cx="${X(n.lon)}" cy="${Y(n.lat)}" r="${big ? 9 : 6}" fill="none" stroke="${css("--accent")}" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="${X(n.lon)}" cy="${Y(n.lat)}" r="3.5" fill="${css("--accent")}"/>`;
  return h;
}
const ll = (v, p, q) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? p : q}`;
function passText(p) {
  const t = new Date(p.start);
  return { when: `${fmtDay(t)} ${fmtT(t)}`, how: `${Math.round(p.duration_s / 60)} min, max ${p.max_alt}°, ${p.from} → ${p.to}` };
}
// Website: the build ships the orbital elements (TLE) and the passes; the position
// and ground track are computed here with satellite.js (SGP4), so they move live.
let ISS_SNAP = null, ISS_SNAP_AT = 0, SATREC = null;
function tleEpoch(line1) {
  const yy = +line1.slice(18, 20), day = parseFloat(line1.slice(20, 32));
  return Date.UTC(yy < 57 ? 2000 + yy : 1900 + yy, 0, 1) + (day - 1) * 86400000;
}
function sunDir(d) { // low-precision Sun direction (Astronomical Almanac), good to ~0.01°
  const n = jd(d) - 2451545, g = (357.528 + 0.9856003 * n) * rad;
  const lam = (280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, eps = (23.439 - 4e-7 * n) * rad;
  return [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
}
function greatCircle(a1, o1, a2, o2) {
  const p1 = a1 * rad, p2 = a2 * rad, c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos((o2 - o1) * rad);
  return 6371 * Math.acos(Math.max(-1, Math.min(1, c)));
}
function issAt(d) {
  const S = window.satellite, pv = S.propagate(SATREC, d);
  if (!pv || !pv.position) return null;
  const gmst = S.gstime(d), gd = S.eciToGeodetic(pv.position, gmst);
  return { lat: S.degreesLat(gd.latitude), lon: S.degreesLong(gd.longitude), h: gd.height, p: pv.position, v: pv.velocity, gmst };
}
function issNowLocal(when = new Date()) {
  const S = window.satellite, c = issAt(when);
  if (!c) return null;
  const home = CFG.location, p = [c.p.x, c.p.y, c.p.z], s = sunDir(when);
  const along = p[0] * s[0] + p[1] * s[1] + p[2] * s[2];
  const perp = Math.hypot(p[0] - along * s[0], p[1] - along * s[1], p[2] - along * s[2]);
  const look = S.ecfToLookAngles({ latitude: home.lat * rad, longitude: home.lon * rad, height: (home.elevation_m || 0) / 1000 }, S.eciToEcf(c.p, c.gmst));
  const track = [];
  for (let m = -93; m <= 93; m++) {
    const q = issAt(new Date(when.getTime() + m * 60000));
    if (q) track.push([+q.lat.toFixed(2), +q.lon.toFixed(2), m]);
  }
  return {
    t: when.toISOString().slice(0, 19) + "Z",
    lat: c.lat, lon: c.lon, alt_km: c.h,
    speed_kmh: Math.round(Math.hypot(c.v.x, c.v.y, c.v.z) * 3600),
    sunlit: along > 0 || perp > 6371,
    home_alt_deg: +(look.elevation / rad).toFixed(1),
    home_range_km: Math.round(look.rangeSat),
    ground_km_to_home: Math.round(greatCircle(c.lat, c.lon, home.lat, home.lon)),
    tle_age_h: (when - tleEpoch(ISS_SNAP.tle.line1)) / 3600000,
    track,
  };
}
async function issData() {
  if (!STATIC) return api("/api/iss");
  if (!ISS_SNAP || Date.now() - ISS_SNAP_AT > 30 * 60000) { // passes and elements change slowly
    const d = await api("/api/iss");
    if (d) { ISS_SNAP = d; ISS_SNAP_AT = Date.now(); SATREC = null; }
  }
  if (!ISS_SNAP) return null;
  let now = null;
  if (ISS_SNAP.tle && window.satellite) {
    try { SATREC = SATREC || satellite.twoline2satrec(ISS_SNAP.tle.line1, ISS_SNAP.tle.line2); now = issNowLocal(); } catch (e) { now = null; }
  }
  now = now || ISS_SNAP.now; // satellite.js missing: show the position from build time
  return now ? { now, passes: ISS_SNAP.passes, tle_fetched_at: ISS_SNAP.tle_fetched_at } : null;
}
async function loadISS() {
  const d = await issData();
  if (!d) return;
  ISS = d;
  const n = d.now;
  $("#issMini").innerHTML = trackSVG(360, 180, false);
  $("#issMiniTxt").textContent = `${ll(n.lat, "N", "S")}, ${ll(n.lon, "E", "W")}`;
  const vis = (d.passes || []).find((p) => p.visible);
  $("#issMiniPass").textContent = vis ? `visible pass ${passText(vis).when}` : "";
  if (current === "iss") renderISS();
}
function renderISS() {
  if (!ISS) return;
  const n = ISS.now;
  $("#issMap").innerHTML = trackSVG(720, 360, true);
  $("#issLat").textContent = ll(n.lat, "N", "S");
  $("#issLon").textContent = ll(n.lon, "E", "W");
  $("#issAlt").textContent = `${Math.round(n.alt_km)} km`;
  $("#issSpeed").textContent = `${n.speed_kmh.toLocaleString("en-GB")} km/h`;
  $("#issSun").textContent = n.sunlit ? "yes" : "in shadow";
  $("#issHome").textContent = n.home_alt_deg > 0 ? `overhead now, ${n.home_alt_deg}° up` : `${n.ground_km_to_home.toLocaleString("en-GB")} km`;
  const tle = $("#tleAge"); tle.textContent = `orbit data ${Math.round(n.tle_age_h)} h old`; tle.classList.toggle("stale", n.tle_age_h > 72);
  const ps = (ISS.passes || []).filter((p) => Date.parse(p.start) > Date.now() - 600000).slice(0, 3);
  $("#passes").innerHTML = ps.map((p) => {
    const t = passText(p);
    return `<div class="pass${p.visible ? " vis" : ""}"><span class="when">${t.when}</span><span class="src${p.visible ? " live" : ""}">${p.visible ? "visible" : "daylight"}</span><span class="how">${t.how}</span></div>`;
  }).join("") || '<div class="muted small">No passes in the next 3 days.</div>';
}

let liveOn = false;
function openLive() {
  $("#live").hidden = false; liveOn = true;
  const url = CFG.iss_stream_url, fr = $("#liveFrame");
  fr.hidden = !url; $("#earthCv").hidden = !!url; $("#liveNote").hidden = !!url;
  if (url && fr.getAttribute("src") !== url) fr.src = url;
  if (!url) drawEarth(performance.now());
}
function closeLive() {
  $("#live").hidden = true; liveOn = false;
  const fr = $("#liveFrame"); if (fr.getAttribute("src")) fr.removeAttribute("src"); // stop the stream
}
$("#liveBtn").addEventListener("click", openLive);
$("#liveClose").addEventListener("click", closeLive);
const clouds = []; for (let i = 0; i < 60; i++) clouds.push({ x: Math.random() * 1400, y: Math.random(), w: 40 + Math.random() * 160, o: 0.25 + Math.random() * 0.5 });
function drawEarth(t) {
  const c = $("#earthCv"), x = c.getContext("2d"), W = 1000, H = 498, cy = H * 2.35, R = H * 2.05;
  x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
  const g = x.createRadialGradient(W / 2, cy, R * 0.9, W / 2, cy, R); g.addColorStop(0, "#0E3B66"); g.addColorStop(1, "#1E6FAF");
  x.fillStyle = g; x.beginPath(); x.arc(W / 2, cy, R, 0, 7); x.fill();
  x.save(); x.beginPath(); x.arc(W / 2, cy, R, 0, 7); x.clip();
  clouds.forEach((cl) => { const px = ((((cl.x - t * 0.02) % 1400) + 1400) % 1400) - 200, py = cy - R + 40 + cl.y * (H * 0.8); x.fillStyle = `rgba(235,242,250,${cl.o})`; x.beginPath(); x.ellipse(px, py, cl.w, cl.w * 0.28, 0, 0, 7); x.fill(); });
  x.restore();
  const a = x.createRadialGradient(W / 2, cy, R, W / 2, cy, R * 1.03); a.addColorStop(0, "rgba(120,190,255,.9)"); a.addColorStop(1, "rgba(120,190,255,0)");
  x.fillStyle = a; x.beginPath(); x.arc(W / 2, cy, R * 1.03, 0, 7); x.fill();
}

/* ------------------------------------------------------------ worlds */
const worlds = [
  { id: "Venus", p: "Venus", t: "464 °C", pr: "92 bar", txt: "Hotter than Mercury, under sulfuric acid clouds that circle the planet at about 360 km/h." },
  { id: "Mars", p: "Mars", t: "−75 to −5 °C", pr: "≈ 7.5 mbar", txt: "Gale crater, where Curiosity has been working since 2012. Typical early-autumn values.", sol: true },
  { id: "Jupiter", p: "Jupiter", t: "−110 °C", pr: "cloud tops", txt: "The Great Red Spot is wider than Earth, with winds near 430 km/h at its edge." },
  { id: "Titan", p: "Saturn", t: "−179 °C", pr: "1.5 bar", txt: "Thicker air than Earth, methane rain and lakes of liquid hydrocarbons." },
];
let sel = "Mars", MARS = null, MARS_AT = null;
const shortDate = (s) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(s + "T12:00:00Z"));
async function loadMars() {
  const d = await api("/api/mars");
  if (!d || !d.data || !d.data.length) return;
  MARS = d.data; MARS_AT = d.fetched_at;
  const m = MARS[0];
  $("#hMars").textContent = `${fix(m.max_temp, 0)} / ${fix(m.min_temp, 0)} °C`;
  $("#hMarsLbl").textContent = `Mars · sol ${m.sol}`;
  if (current === "worlds") buildWorlds();
}
// Last 7 reported sols as min-max range bars, newest on the right.
function marsChart(sols) {
  const W = 230, H = 64, T = 12, B = 12, n = sols.length, bw = W / n;
  const lo = Math.min(...sols.map((s) => s.min_temp ?? 0)) - 4, hi = Math.max(...sols.map((s) => s.max_temp ?? 0)) + 4;
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let h = "";
  sols.forEach((s, i) => {
    const x = i * bw + bw / 2, last = i === n - 1, col = last ? css("--accent") : css("--muted");
    if (s.min_temp == null || s.max_temp == null) return;
    h += `<line x1="${x}" x2="${x}" y1="${y(s.max_temp)}" y2="${y(s.min_temp)}" stroke="${col}" stroke-width="${last ? 7 : 5}" stroke-linecap="round"/>`;
    h += `<text x="${x}" y="${H - 1}" text-anchor="middle">${s.sol % 1000}</text>`;
    if (last) h += `<text x="${x}" y="${y(s.max_temp) - 4}" text-anchor="middle" style="fill:${css("--text")}">${Math.round(s.max_temp)}°</text>`;
  });
  return `<svg class="chart mars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Air temperature range for the last ${n} sols">${h}</svg>`;
}
function marsCard(f) {
  const m = MARS[0], seven = MARS.slice(0, 7).reverse();
  const age = Math.round((Date.now() - Date.parse(m.date + "T12:00:00Z")) / 86400000);
  return `<div class="lbl">Gale crater <span class="src${age > 60 ? " stale" : ""}">sol ${m.sol} · ${shortDate(m.date)}</span></div>
    <h3>Mars</h3>${marsChart(seven)}
    <dl class="kv"><dt>Air, last sol</dt><dd>${fix(m.min_temp, 0)} to ${fix(m.max_temp, 0)} °C</dd>
    <dt>Pressure · sky</dt><dd>${m.pressure != null ? Math.round(m.pressure) + " Pa" : "–"}${m.sky ? " · " + esc(m.sky.toLowerCase()) : ""}</dd>
    <dt>Light from here</dt><dd style="color:var(--accent2)">${fmtLT(f.min)}</dd></dl>`;
}
function buildWorlds() {
  const box = $("#wcards"), d = new Date(); box.innerHTML = "";
  worlds.forEach((w) => {
    const f = fromEarth(w.p, d), el = document.createElement("div");
    el.className = "tile wcard"; el.setAttribute("role", "button"); el.setAttribute("aria-pressed", sel === w.id ? "true" : "false");
    if (w.id === "Mars" && MARS && MARS.length) el.innerHTML = marsCard(f);
    else el.innerHTML = `<div class="lbl">${w.id === "Titan" ? "Moon of Saturn" : "Planet"} <span class="src">${w.sol ? "Sol " + sol(d) : "reference"}</span></div><h3>${w.id}</h3><p>${w.txt}</p>
      <dl class="kv"><dt>Surface</dt><dd>${w.t}</dd><dt>Pressure</dt><dd>${w.pr}</dd><dt>Light from here</dt><dd style="color:var(--accent2)">${fmtLT(f.min)}</dd></dl>`;
    el.addEventListener("click", () => { sel = w.id; buildWorlds(); drawOrrery(); });
    box.appendChild(el);
  });
}
function drawOrrery() {
  const c = $("#orrery"), x = c.getContext("2d"), S = 410, cx = S / 2, cy = S / 2, k = (S / 2 - 14) / Math.sqrt(30.1), d = new Date();
  x.setTransform(2, 0, 0, 2, 0, 0); x.clearRect(0, 0, S, S); x.font = "11px 'IBM Plex Mono', monospace";
  const pos = {}; Object.keys(EL).forEach((p) => (pos[p] = helio(p, d)));
  Object.keys(EL).forEach((p) => { x.strokeStyle = css("--line"); x.lineWidth = 1; x.beginPath(); x.arc(cx, cy, Math.sqrt(pos[p].a) * k, 0, 7); x.stroke(); });
  x.fillStyle = css("--accent"); x.beginPath(); x.arc(cx, cy, 7, 0, 7); x.fill();
  const P = (p) => { const q = pos[p], r = Math.hypot(q.x, q.y), s = (Math.sqrt(r) * k) / r; return [cx + q.x * s, cy - q.y * s]; };
  const selP = worlds.find((w) => w.id === sel).p, [ex, ey] = P("Earth"), [sx, sy] = P(selP);
  x.strokeStyle = css("--accent2"); x.setLineDash([4, 4]); x.beginPath(); x.moveTo(ex, ey); x.lineTo(sx, sy); x.stroke(); x.setLineDash([]);
  Object.keys(EL).forEach((p) => {
    const [px, py] = P(p), hl = p === selP || p === "Earth";
    x.fillStyle = p === "Earth" ? css("--accent2") : hl ? css("--accent") : css("--muted");
    x.beginPath(); x.arc(px, py, hl ? 5.5 : 4, 0, 7); x.fill();
    x.fillStyle = hl ? css("--text") : css("--muted"); x.fillText(p, px + 8, py + 4);
  });
  x.fillStyle = css("--muted"); x.fillText("Radial scale: √distance. Angles are real for " + localDate(d), 10, S - 8);
}

/* ------------------------------------------------------------ DSN */
const fmtRate = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(b >= 1e7 ? 0 : 1)} Mb/s` : b >= 1e3 ? `${Math.round(b / 1e3)} kb/s` : `${Math.round(b)} b/s`);
const fmtRTLT = (s) => (s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)} s` : s < 3600 ? `${(s / 60).toFixed(1)} min` : `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, "0")} m`);
async function loadDSN() {
  const d = await api("/api/dsn");
  const box = $("#dsn");
  if (!d || !d.data) {
    box.innerHTML = d && d.error && STATIC
      ? `<div class="tile" style="grid-column:1/-1;justify-content:center;align-items:flex-start;padding:40px 48px"><h3>Deep Space Network</h3><p class="muted" style="max-width:620px;line-height:1.5">This page couldn't load NASA's live DSN feed. It may not let other websites read it, or you may be offline. Watch it on NASA's own site, or run Orbit Desk on a Raspberry Pi, where the server reads it every 10 seconds.</p><p><a class="btn solid" style="display:inline-block;text-decoration:none" href="https://eyes.nasa.gov/apps/dsn-now/" target="_blank" rel="noopener">Open DSN Now</a></p></div>`
      : '<div class="tile"><div class="muted">Waiting for the Deep Space Network feed.</div></div>';
    return;
  }
  const now = new Date();
  box.innerHTML = d.data.sites.map((s) => {
    const dishes = s.dishes.map((di) => {
      if (!di.links.length) {
        const act = di.activity && !/telemetry|tracking/i.test(di.activity) ? di.activity : "Idle";
        return `<div class="dish"><div class="id">${esc(di.name)}<br>${esc(di.size)}</div><div class="idle">${esc(act)}</div></div>`;
      }
      const lines = di.links.map((L) => {
        const w = (up) => `<span class="wave${up ? " up" : ""}"><i></i><i></i><i></i></span>`;
        const dir = L.up && L.down ? "up + down" : L.up ? "uplink" : "downlink";
        const meta = [`${dir}${L.down && L.down_rate ? " " + fmtRate(L.down_rate) : ""}${L.band ? " · " + L.band : ""}`];
        if (L.rtlt_s) meta.push("RTLT " + fmtRTLT(L.rtlt_s));
        return `<div class="ln"><span class="tg">${esc(L.name)}${L.down ? w(false) : ""}${L.up ? w(true) : ""}</span><div class="meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div></div>`;
      }).join("");
      return `<div class="dish"><div class="id">${esc(di.name)}<br>${esc(di.size)}</div><div>${lines}</div></div>`;
    }).join("");
    return `<div class="tile site"><div class="lbl">${esc(s.place)} <span class="src">${esc(ago(d.fetched_at))}</span></div>
      <div class="row" style="margin:4px 0 8px"><h3>${esc(s.name)}</h3><span class="mid" data-tz="${esc(s.tz)}">${fmtT(now, s.tz)}</span></div>
      <div class="dishes">${dishes}</div></div>`;
  }).join("");
}

/* ------------------------------------------------------------ gallery */
let showApod = false;
// Website: api/gallery.json is the whole pool of Webb pictures, and this page
// picks one at random, rotates it, and loads it straight from NASA's image server.
let POOL = [], galPick = null, galPickedAt = 0;
function pickWebb() {
  if (!POOL.length) return null;
  const recent = local.get("recentWebb", []);
  const fresh = POOL.filter((p) => !recent.includes(p.id));
  galPick = (fresh.length ? fresh : POOL)[Math.floor(Math.random() * (fresh.length || POOL.length))];
  galPickedAt = Date.now();
  local.set("recentWebb", [...recent, galPick.id].slice(-Math.max(1, Math.min(30, POOL.length - 1))));
  return galPick;
}
async function galleryData() {
  if (!STATIC || showApod) return api(showApod ? "/api/apod" : "/api/gallery");
  if (!POOL.length) { const d = await api("/api/gallery"); POOL = (d && d.data) || []; }
  const every = (CFG.gallery_rotate_minutes || 15) * 60000;
  if (!galPick || Date.now() - galPickedAt > every) pickWebb();
  return galPick ? { data: galPick } : null;
}
$("#sunImg").addEventListener("error", (e) => { // SDO down: try NOAA's SUVI picture
  const img = e.target, alt = img.dataset.fallback;
  if (alt && img.getAttribute("src") !== alt) img.src = alt;
});
$("#galImg").addEventListener("error", (e) => { // a picture can vanish from the server: try the smaller copy
  const img = e.target, alt = img.dataset.fallback;
  if (alt && img.getAttribute("src") !== alt) img.src = alt;
});
async function loadGallery() {
  const d = await galleryData();
  $("#galKind").textContent = showApod ? "Picture of the day" : "Webb · random pick";
  if (!d || !d.data) { $("#galTitle").textContent = "Waiting for an image"; return; }
  const g = d.data, img = $("#galImg");
  const src = g.file ? mediaUrl(g.file, g.saved_at) : g.image;
  if (src) { if (img.getAttribute("src") !== src) { img.dataset.fallback = g.preview || ""; img.src = src; } img.hidden = false; }
  else { img.hidden = true; img.removeAttribute("src"); }
  $("#galImg").alt = g.title || "";
  $("#galTitle").textContent = g.title || "";
  $("#galText").textContent = (!g.file && g.media_type === "video" ? "Today's picture is a video, so it can't show here. " : "") + (g.text || "");
  $("#galCredit").textContent = g.credit ? `Credit: ${g.credit}` : "";
  $("#galDate").textContent = g.date || "";
  $("#apodBtn").textContent = showApod ? "Back to Webb" : "Picture of the day";
}
$("#nextImg").addEventListener("click", async () => {
  showApod = false; $("#galTitle").textContent = "Loading…";
  if (STATIC) pickWebb(); else await api("/api/gallery/next", { method: "POST" });
  loadGallery();
});
$("#apodBtn").addEventListener("click", () => { showApod = !showApod; loadGallery(); });

/* ------------------------------------------------------------ radio */
// Audio keeps playing when you switch screens. "Mute" drops the stream and
// "Unmute" reconnects, so you always hear the station live, not a buffer.
let RADIO = [], radioSel = null, radioOn = false, hls = null, npTimer = null;
const audio = new Audio();
audio.preload = "none";
const curStation = () => RADIO.find((s) => s.id === radioSel) || RADIO[0];
async function loadRadio() {
  const d = await api("/api/radio");
  if (!d || !d.data) return;
  RADIO = d.data;
  if (!radioSel) radioSel = PREFS.radio || (RADIO[0] && RADIO[0].id);
  stamp($("#radioAge"), d.fetched_at, 3 * 86400, "streams ");
  if (current === "radio") renderRadio();
}
function renderRadioTimes(d = new Date()) {
  document.querySelectorAll("#radioList time").forEach((t) => (t.textContent = fmtT(d, t.dataset.tz)));
  const st = curStation(); if (!st) return;
  $("#rTime").textContent = fmtT(d, st.tz);
  $("#rDay").textContent = new Intl.DateTimeFormat("en-GB", { timeZone: st.tz, weekday: "long", day: "numeric", month: "long" }).format(d);
}
function renderRadio() {
  const box = $("#radioList"), st = curStation();
  if (!RADIO.length) { box.innerHTML = '<div class="muted small">Looking up stations…</div>'; return; }
  box.innerHTML = "";
  RADIO.forEach((s) => {
    const b = document.createElement("button");
    b.className = "rrow"; b.setAttribute("aria-pressed", s.id === st.id ? "true" : "false");
    b.innerHTML = `<b>${esc(s.country)}</b><time data-tz="${esc(s.tz)}"></time><span>${esc(s.name)}</span>`;
    b.addEventListener("click", () => selectStation(s.id));
    box.appendChild(b);
  });
  $("#rCountry").textContent = st.country;
  $("#rStation").textContent = st.name;
  $("#rStream").textContent = !st.url ? "no stream found" : [st.codec, st.bitrate ? st.bitrate + " kbps" : "", st.hls ? "HLS" : ""].filter(Boolean).join(" · ") || "stream";
  $("#rStream").classList.toggle("stale", !st.url);
  $("#rToggle").textContent = radioOn ? "Mute" : "Unmute";
  $("#rToggle").className = "btn" + (radioOn ? "" : " solid");
  renderRadioTimes();
}
function stopAudio() {
  if (hls) { hls.destroy(); hls = null; }
  audio.pause(); audio.removeAttribute("src"); audio.load();
}
async function startAudio() {
  const st = curStation();
  stopAudio();
  if (!st || !st.url) { setRadioState("No stream found for this station"); return false; }
  setRadioState("Connecting…");
  // An https page may not play http audio. Most stations answer on https too, so try that.
  const upgraded = location.protocol === "https:" && /^http:/i.test(st.url);
  const url = upgraded ? st.url.replace(/^http:/i, "https:") : st.url;
  try {
    if (st.hls && window.Hls && Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: false });
      hls.loadSource(url); hls.attachMedia(audio);
    } else {
      audio.src = url;
    }
    await audio.play();
    setRadioState("Live");
    return true;
  } catch (e) {
    setRadioState(upgraded ? "This station only streams over plain http, which browsers block on https pages."
      : "The stream didn't start. Tap Unmute to retry.");
    return false;
  }
}
function setRadioState(t) { $("#rState").textContent = t; }
async function toggleRadio() {
  if (radioOn) { radioOn = false; stopAudio(); setRadioState("Muted"); }
  else { radioOn = await startAudio(); }
  renderRadio(); renderOnAir(); pollNowPlaying();
}
async function selectStation(id) {
  radioSel = id; PREFS.radio = id; savePrefs();
  $("#rArtist").innerHTML = "&nbsp;"; $("#rTitle").innerHTML = "&nbsp;";
  renderRadio();
  if (radioOn) { radioOn = await startAudio(); renderRadio(); }
  renderOnAir(); pollNowPlaying();
}
function renderOnAir() {
  const st = curStation();
  $("#onAir").hidden = !radioOn;
  if (st) $("#onAirName").textContent = st.name;
}
// Song titles are read from the stream's ICY metadata, which only the Pi server can do
// (browsers can't see it). The website shows the station's own page there instead.
function renderStationInfo() {
  const st = curStation(); if (!st) return;
  $("#rSongLbl").textContent = "Station";
  $("#rArtist").textContent = [st.codec, st.bitrate ? st.bitrate + " kbps" : ""].filter(Boolean).join(" · ") || "\u00a0";
  let host = ""; try { host = st.homepage ? new URL(st.homepage).host.replace(/^www\./, "") : ""; } catch (e) { host = ""; }
  $("#rTitle").innerHTML = host ? `<a href="${esc(st.homepage)}" target="_blank" rel="noopener">${esc(host)}</a>` : esc(st.name);
}
async function pollNowPlaying() {
  clearTimeout(npTimer);
  if (STATIC) { renderStationInfo(); return; }
  const st = curStation();
  if (st && (radioOn || current === "radio")) {
    const d = await api(`/api/radio/nowplaying?id=${encodeURIComponent(st.id)}`);
    if (st === curStation()) {
      if (d && d.title) { $("#rArtist").textContent = d.artist || ""; $("#rTitle").textContent = d.title; }
      else { $("#rArtist").innerHTML = "&nbsp;"; $("#rTitle").textContent = d && !d.supported ? "This stream doesn't send song titles" : "No song title right now"; }
    }
  }
  npTimer = setTimeout(pollNowPlaying, 20000);
}
audio.addEventListener("error", () => { if (radioOn && !hls) setRadioState("Stream dropped. Tap Mute, then Unmute to reconnect."); });
$("#rToggle").addEventListener("click", toggleRadio);
$("#onAir").addEventListener("click", () => go("radio"));

/* ------------------------------------------------------------ settings + status */
let PREFS = { skin: "night", hidden: [], cycle: 0 };
// On the Pi the server keeps the settings; on the website each browser keeps its own.
const savePrefs = () => STATIC ? local.set("prefs", PREFS)
  : api("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(PREFS) });
// Themes come from config.toml ([[themes]]); each becomes a set of CSS colour variables.
let skins = [];
const THEME_VARS = ["bg", "panel", "line", "text", "muted", "accent", "accent2", "warn", "crit", "good", "land"];
function installThemes(themes) {
  skins = (themes || []).map((t) => [t.id, t.name || t.id, [t.bg, t.accent, t.accent2]]);
  let css = "";
  (themes || []).forEach((t) => {
    const sel = `.stage[data-skin="${String(t.id).replace(/[^\w-]/g, "")}"]`;
    css += `${sel}{${THEME_VARS.filter((k) => t[k]).map((k) => `--${k}:${t[k]}`).join(";")};color-scheme:${t.light ? "light" : "dark"}}\n`;
    if (t.image_filter) css += `${sel} img{filter:${t.image_filter}}\n`;
  });
  let el = document.getElementById("themeCss");
  if (!el) { el = document.createElement("style"); el.id = "themeCss"; document.head.appendChild(el); }
  el.textContent = css;
}
const tileDefs = [["t-iss", "ISS track"], ["t-apollo", "Apollo 11"], ["t-kp", "Geomagnetic"], ["t-wind", "Solar wind"], ["t-clock", "Clock"], ["t-moon", "Moon"], ["t-worlds", "Other worlds"]];
function applyPrefs() {
  const ids = skins.map((s) => s[0]);
  stage.dataset.skin = ids.includes(PREFS.skin) ? PREFS.skin : (ids[0] || "solar");
  tileDefs.forEach(([id]) => { $("#" + id).hidden = (PREFS.hidden || []).includes(id); });
}
function opt(label, on, extra, fn) {
  const o = document.createElement("button");
  o.className = "opt"; o.setAttribute("aria-pressed", on ? "true" : "false");
  o.innerHTML = `${label}${extra ?? `<span class="sw">${on ? "✓" : ""}</span>`}`;
  o.addEventListener("click", fn); return o;
}
function buildSettings() {
  const sk = $("#skins"); sk.innerHTML = "";
  skins.forEach(([id, n, c]) => sk.appendChild(opt(n, stage.dataset.skin === id, `<span class="swatch">${c.map((x) => `<i style="background:${x}"></i>`).join("")}</span>`,
    () => { PREFS.skin = id; applyPrefs(); savePrefs(); renderScreen(); renderSWHome(); drawMoon(); loadISS(); })));
  const tl = $("#tiles"); tl.innerHTML = "";
  tileDefs.forEach(([id, n]) => { const on = !(PREFS.hidden || []).includes(id);
    tl.appendChild(opt(n, on, null, () => { PREFS.hidden = on ? [...(PREFS.hidden || []), id] : PREFS.hidden.filter((x) => x !== id); applyPrefs(); savePrefs(); buildSettings(); })); });
  const cy = $("#cycle"); cy.innerHTML = "";
  [[0, "Off, stay on Overview"], [30, "Every 30 seconds"], [120, "Every 2 minutes"]].forEach(([s, n]) =>
    cy.appendChild(opt(n, (PREFS.cycle || 0) === s, null, () => { PREFS.cycle = s; savePrefs(); buildSettings(); })));
  loadStatus();
}
const FEED_NAMES = { swpc: "NOAA space weather", alerts: "NOAA alerts", dsn: "Deep Space Network", tle: "ISS orbit data", sun_image: "Sun image", donki: "NASA DONKI", gallery_current: "Webb gallery", apod: "Picture of the day", mars: "Curiosity weather", radio: "Radio stations" };
async function loadStatus() {
  const d = await api("/api/status");
  const h = $("#health");
  if (!d) { h.className = "health warn"; h.title = "Server not reachable"; return; }
  const now = Date.now() / 1000;
  Object.values(d.feeds).forEach((f) => { if (f.fetched_at && f.limit_s) { f.stale = now - f.fetched_at > f.limit_s; f.age_s = now - f.fetched_at; } });
  const bad = Object.entries(d.feeds).filter(([, f]) => f.stale);
  h.className = "health" + (bad.length ? " warn" : "");
  h.title = bad.length ? `Stale: ${bad.map(([k]) => FEED_NAMES[k] || k).join(", ")}` : "All feeds fresh";
  if (current === "settings") {
    $("#feedList").innerHTML = (d.demo ? '<span>Demo mode</span><span>sample data</span>' : "") + Object.entries(d.feeds).map(([k, f]) =>
      `<span class="${f.stale ? "bad" : ""}" title="${esc(f.error || "")}">${esc(FEED_NAMES[k] || k)}</span><span class="${f.stale ? "bad" : ""}">${f.age_s == null ? "no data" : ago(Date.now() / 1000 - f.age_s)}</span>`).join("");
  }
}

/* ------------------------------------------------------------ render + polling */
function renderScreen() {
  if (current === "sun") { renderSWScreen(); loadDonki(); }
  if (current === "worlds") { buildWorlds(); drawOrrery(); }
  if (current === "iss") renderISS();
  if (current === "dsn") loadDSN();
  if (current === "gallery") loadGallery();
  if (current === "settings") buildSettings();
  if (current === "radio") { renderRadio(); pollNowPlaying(); }
}
setInterval(() => {
  const s = PREFS.cycle || 0;
  if (!s || liveOn || Date.now() - lastTouch < s * 1000) return;
  const order = ["home", "sun", "worlds", "iss", "dsn", "gallery"];
  go(order[(order.indexOf(current) + 1) % order.length]);
  lastTouch = Date.now();
}, 1000);

let lastApollo = 0;
function loop(t) {
  if (liveOn && !CFG.iss_stream_url) drawEarth(t);
  if (current === "home" && window.Apollo && t - lastApollo > 33) { Apollo.frame(t); lastApollo = t; } // about 30 fps
  if (!reduce) requestAnimationFrame(loop);
}

(async function start() {
  // No point asking GitHub Pages for a server (it would only log a 404).
  const noServer = new URLSearchParams(location.search).has("web") || /\.github\.io$/.test(location.hostname);
  const c = noServer ? null : await api("/api/config");
  if (c) CFG = c;
  else { STATIC = true; CFG = window.OrbitWeb.config(); }
  TZ = CFG.location.timezone;
  $("#minBtn").hidden = STATIC || !document.body.classList.contains("kiosk");
  installThemes(CFG.themes);
  $("#locName").textContent = CFG.location.name;
  if (STATIC) {
    const repo = CFG.site && CFG.site.repo_url;
    if (repo && !document.body.classList.contains("kiosk")) { $("#brand").href = repo; $("#brand").target = "_blank"; $("#brand").rel = "noopener"; $("#brand").title = "Source on GitHub"; }
    $("#lookNote").textContent = "Themes are set in docs/config.js. Your choices here are saved in this browser only.";
  }
  $("#cLocalLbl").textContent = CFG.location.short || (CFG.location.name || "LOC").slice(0, 3).toUpperCase();
  const p = STATIC ? local.get("prefs", null) : await api("/api/prefs"); if (p && Object.keys(p).length) PREFS = { ...PREFS, ...p };
  applyPrefs(); tick(); drawMoon(); go("home");
  if (window.Apollo) Apollo.init();
  if (reduce && window.Apollo) setInterval(() => { if (current === "home") Apollo.frame(performance.now()); }, 1000);
  await Promise.all([loadSW(), loadISS(), loadStatus(), loadMars(), loadRadio()]);
  setInterval(loadRadio, 3600000);
  setInterval(loadMars, 3600000);
  setInterval(loadSW, 60000);
  setInterval(loadISS, 5000);
  setInterval(loadStatus, 30000);
  setInterval(() => { if (current === "dsn") loadDSN(); }, 10000);
  setInterval(() => { if (current === "gallery") loadGallery(); }, 60000);
  setInterval(() => { if (current === "sun") loadDonki(); if (current === "worlds") drawOrrery(); }, 300000);
  setInterval(drawMoon, 600000);
  // Reload once a day so the page picks up updates and never drifts.
  setTimeout(() => location.reload(), 24 * 3600 * 1000);
  requestAnimationFrame(loop);
})();
})();
