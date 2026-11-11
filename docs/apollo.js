/* Apollo 11, 16-24 July 1969, replayed in about one hour.
 *
 * Mission times are the real ones (ground elapsed time from launch, Apollo 11
 * Flight Journal / NASA mission report). Each phase gets a share of the hour,
 * so quiet stretches (the coast to the Moon) run fast and the landing runs
 * slowly enough to watch. The drawing is schematic: not to scale, and the Moon
 * doesn't move.
 */
(function () {
"use strict";
const LAUNCH = Date.UTC(1969, 6, 16, 13, 32, 0);
const h = (H, M, S) => H + M / 60 + S / 3600;

// [start, end] in mission hours, share of the hour in minutes
const PHASES = [
  { name: "Launch and Earth orbit", t0: 0, t1: h(2, 44, 16), real: 5 },
  { name: "Coast to the Moon", t0: h(2, 44, 16), t1: h(75, 49, 50), real: 13 },
  { name: "Lunar orbit", t0: h(75, 49, 50), t1: h(102, 33, 5), real: 7 },
  { name: "Descent and landing", t0: h(102, 33, 5), t1: h(102, 45, 40), real: 4 },
  { name: "On the Moon", t0: h(102, 45, 40), t1: h(124, 22, 0), real: 9 },
  { name: "Liftoff and docking", t0: h(124, 22, 0), t1: h(128, 3, 0), real: 4 },
  { name: "Leaving lunar orbit", t0: h(128, 3, 0), t1: h(135, 23, 42), real: 3 },
  { name: "Coast home", t0: h(135, 23, 42), t1: h(195, 3, 6), real: 11 },
  { name: "Re-entry, splashdown", t0: h(195, 3, 6), t1: h(195, 18, 35), real: 4 },
];
const EVENTS = [
  [h(0, 0, 0), "Liftoff"],
  [h(0, 11, 49), "Earth orbit"],
  [h(2, 44, 16), "Burn for the Moon"],
  [h(75, 49, 50), "Lunar orbit insertion"],
  [h(100, 12, 0), "Eagle undocks"],
  [h(102, 33, 5), "Powered descent"],
  [h(102, 45, 40), "The Eagle has landed"],
  [h(109, 24, 15), "First step on the Moon"],
  [h(124, 22, 0), "Liftoff from the Moon"],
  [h(128, 3, 0), "Docking with Columbia"],
  [h(135, 23, 42), "Burn for home"],
  [h(195, 3, 6), "Entry interface"],
  [h(195, 18, 35), "Splashdown"],
];
const TOTAL_MS = PHASES.reduce((s, p) => s + p.real, 0) * 60000;
const HOLD_MS = 20000; // pause at splashdown before replaying

let el = {}, W = 300, H = 150, ctx = null, t0Real = performance.now(), pausedAt = null, lastText = 0, geo = null;

/* ---------------------------------------------------------- time mapping */
function phaseAtReal(ms) {
  let acc = 0;
  for (let i = 0; i < PHASES.length; i++) {
    const d = PHASES[i].real * 60000;
    if (ms < acc + d) return { i, frac: (ms - acc) / d };
    acc += d;
  }
  return { i: PHASES.length - 1, frac: 1 };
}
const phaseStartReal = (i) => PHASES.slice(0, i).reduce((s, p) => s + p.real, 0) * 60000;
function missionTime(ms) {
  const { i, frac } = phaseAtReal(Math.min(ms, TOTAL_MS));
  const p = PHASES[i];
  return { i, frac, t: p.t0 + (p.t1 - p.t0) * frac };
}
function phaseOfT(t) {
  const k = PHASES.findIndex((p) => t >= p.t0 && t < p.t1);
  return k === -1 ? (t < 0 ? 0 : PHASES.length - 1) : k;
}

/* ---------------------------------------------------------- geometry */
function layout() {
  const E = { x: W * 0.17, y: H * 0.55, r: Math.min(H * 0.17, 24) };
  const M = { x: W * 0.84, y: H * 0.45, r: Math.max(5, E.r * 0.36) };
  const ro = E.r + 6, lr = M.r + 8, D = M.x - E.x;
  const clampY = (y) => Math.max(6, Math.min(H - 6, y));
  const P = (x, y) => ({ x, y: clampY(y) });
  const pol = (c, r, deg) => ({ x: c.x + r * Math.cos(deg * Math.PI / 180), y: c.y + r * Math.sin(deg * Math.PI / 180) });
  // Outbound passes below, homebound above: the free-return figure eight.
  const out = [pol(E, ro, 60), P(E.x + 0.35 * D, E.y + 0.42 * H), P(M.x - 0.15 * D, M.y + 0.45 * H), pol(M, lr, 45)];
  const home = { c1: P(M.x - 0.05 * D, M.y - 0.45 * H), c2: P(E.x + 0.32 * D, E.y - 0.5 * H), p3: pol(E, E.r + 2, -35) };
  geo = { E, M, ro, lr, D, pol, out, home };
}
const bez = (a, b, c, d, u) => {
  const v = 1 - u;
  return { x: v * v * v * a.x + 3 * v * v * u * b.x + 3 * v * u * u * c.x + u * u * u * d.x,
           y: v * v * v * a.y + 3 * v * v * u * b.y + 3 * v * u * u * c.y + u * u * u * d.y };
};
const lerp = (a, b, u) => a + (b - a) * u;
const ease = (u) => u * u * (3 - 2 * u);
// Columbia's angle around the Moon: one orbit about every 2 hours, counter-clockwise on screen.
const csmAngle = (t) => 45 - ((t - PHASES[2].t0) / 2.0) * 360;
const LANDING = 180; // the near side, facing Earth
function nearestBelow(a, target) { // largest angle <= a that equals target mod 360
  let x = target + 360 * Math.floor((a - target) / 360);
  return x;
}

// Where Columbia (and Eagle, when apart) are at mission time t.
function positions(t) {
  const g = geo, { E, M, ro, lr, pol } = g;
  const i = phaseOfT(t), p = PHASES[i], u = Math.min(1, Math.max(0, (t - p.t0) / (p.t1 - p.t0)));
  if (i === 0) {
    if (u < 0.08) return { csm: pol(E, lerp(E.r, ro, u / 0.08), lerp(-90, -120, u / 0.08)) };
    return { csm: pol(E, ro, -120 - ((u - 0.08) / 0.92) * 540) };
  }
  if (i === 1) return { csm: bez(g.out[0], g.out[1], g.out[2], g.out[3], ease(u) * 0.85 + u * 0.15) };
  if (i >= 2 && i <= 6) {
    const csm = pol(M, lr, csmAngle(t));
    const undock = EVENTS[4][0];
    if (i === 2) {
      if (t < undock) return { csm };
      return { csm, lm: pol(M, lr - 3, csmAngle(t) + 4) };
    }
    if (i === 3) {
      const a0 = csmAngle(p.t0) + 4, a1 = nearestBelow(a0, LANDING);
      return { csm, lm: pol(M, lerp(lr - 3, M.r + 1.5, ease(u)), lerp(a0, a1, ease(u))) };
    }
    if (i === 4) return { csm, lm: pol(M, M.r + 1.5, LANDING), onMoon: true, eva: t >= EVENTS[7][0] };
    if (i === 5) {
      const a1 = csmAngle(p.t1);
      const a0 = nearestBelow(a1 + 360, LANDING) ; // start from the landing site, catch up with Columbia
      const r = lerp(M.r + 1.5, lr, Math.min(1, u / 0.25));
      return { csm, lm: u < 0.999 ? pol(M, r, lerp(a0, a1, ease(u))) : null };
    }
    return { csm };
  }
  if (i === 7) {
    const start = pol(M, lr, csmAngle(p.t0));
    return { csm: bez(start, g.home.c1, g.home.c2, g.home.p3, ease(u) * 0.8 + u * 0.2) };
  }
  // re-entry: glide down to the Pacific, then splashdown
  const a = pol(E, E.r + 2, -35), b = pol(E, E.r, -8);
  return { csm: { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) }, entry: u < 0.55, chutes: u >= 0.55 && u < 0.98, splash: u >= 0.98 };
}

/* ---------------------------------------------------------- drawing */
const col = (n) => getComputedStyle(el.stage).getPropertyValue(n).trim();
function draw(t) {
  if (!ctx || !geo) return;
  const g = geo, { E, M, ro, lr } = g;
  const ink = col("--text"), muted = col("--muted"), line = col("--line"), accent = col("--accent"), accent2 = col("--accent2");
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, W, H);
  // paths, faint
  ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.arc(E.x, E.y, ro, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.arc(M.x, M.y, lr, 0, 7); ctx.stroke();
  const o = g.out; ctx.beginPath(); ctx.moveTo(o[0].x, o[0].y); ctx.bezierCurveTo(o[1].x, o[1].y, o[2].x, o[2].y, o[3].x, o[3].y); ctx.stroke();
  const s = g.pol(M, lr, csmAngle(PHASES[7].t0));
  ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.bezierCurveTo(g.home.c1.x, g.home.c1.y, g.home.c2.x, g.home.c2.y, g.home.p3.x, g.home.p3.y); ctx.stroke();
  ctx.setLineDash([]);
  // Earth and Moon
  ctx.fillStyle = accent2; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(E.x, E.y, E.r, 0, 7); ctx.fill();
  ctx.globalAlpha = 1; ctx.fillStyle = muted; ctx.beginPath(); ctx.arc(M.x, M.y, M.r, 0, 7); ctx.fill();
  ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.fillStyle = muted;
  ctx.fillText("Earth", E.x - 14, Math.min(H - 3, E.y + E.r + 12));
  ctx.fillText("Moon", M.x - 12, Math.min(H - 3, M.y + lr + 12));
  if (el.lastEvent) { ctx.fillStyle = ink; ctx.font = "11px 'IBM Plex Sans', system-ui, sans-serif"; ctx.fillText(el.lastEvent, 2, 12); }
  // trail: where Columbia was over the last stretch of this phase
  const i = phaseOfT(t), p = PHASES[i], step = (p.t1 - p.t0) / 120;
  ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let k = 24; k >= 0; k--) {
    const tk = Math.max(p.t0, t - k * step), q = positions(tk).csm;
    k === 24 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
  }
  ctx.globalAlpha = 0.6; ctx.stroke(); ctx.globalAlpha = 1;
  const pos = positions(t);
  if (pos.entry) { ctx.fillStyle = "#FF7A2F"; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(pos.csm.x, pos.csm.y, 6, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  if (pos.splash) { ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(pos.csm.x, pos.csm.y, 5 + (t * 40) % 4, 0, 7); ctx.stroke(); }
  if (pos.chutes) { ctx.fillStyle = ink; [-3, 0, 3].forEach((dx) => { ctx.beginPath(); ctx.arc(pos.csm.x + dx, pos.csm.y - 5, 1.3, 0, 7); ctx.fill(); }); }
  // Columbia (circle) and Eagle (triangle)
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(pos.csm.x, pos.csm.y, 3, 0, 7); ctx.fill();
  if (pos.lm) {
    const { x, y } = pos.lm;
    ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(x, y - 3.2); ctx.lineTo(x + 3, y + 2.4); ctx.lineTo(x - 3, y + 2.4); ctx.closePath(); ctx.fill();
    if (pos.eva) { ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x - 6, y - 7); ctx.stroke(); } // the flag
  }
}

/* ---------------------------------------------------------- text + controls */
const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, "0");
const fmtGET = (t) => `T+ ${pad(t, 3)}:${pad((t * 60) % 60)}:${pad((t * 3600) % 60)}`;
const fmtDur = (hrs) => `${pad(hrs)}:${pad((hrs * 60) % 60)}:${pad((hrs * 3600) % 60)}`;
function text(t, i) {
  const d = new Date(LAUNCH + t * 3600000);
  el.phase.textContent = PHASES[i].name;
  el.step.textContent = `${i + 1} / ${PHASES.length}`;
  el.get.textContent = fmtGET(t);
  el.utc.textContent = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) + " UTC";
  const nx = EVENTS.find((e) => e[0] > t + 1e-6);
  const last = [...EVENTS].reverse().find((e) => e[0] <= t + 1e-6);
  el.next.textContent = nx ? `Next: ${nx[1]} in ${fmtDur(nx[0] - t)}` : "Mission complete. Replaying soon";
  el.lastEvent = last ? last[1] : "";
  const p = PHASES[i], speed = ((p.t1 - p.t0) * 3600) / (p.real * 60);
  el.speed.textContent = `×${speed >= 10 ? Math.round(speed) : speed.toFixed(1)}`;
  el.play.textContent = pausedAt === null ? "Pause" : "Play";
}

function elapsed(now) {
  return (pausedAt === null ? now : pausedAt) - t0Real;
}
function jump(i) {
  i = Math.max(0, Math.min(PHASES.length - 1, i));
  const now = performance.now();
  const base = pausedAt === null ? now : pausedAt;
  t0Real = base - phaseStartReal(i) - 1;
  frame(now, true);
}
function frame(now, force) {
  if (!el.canvas || el.canvas.offsetParent === null) return; // hidden: skip the work
  let ms = elapsed(now);
  if (ms > TOTAL_MS + HOLD_MS) { t0Real = now; ms = 0; }
  const { i, t } = missionTime(ms);
  draw(t);
  if (force || now - lastText > 250) { text(t, i); lastText = now; }
}
function resize() {
  const r = el.canvas.getBoundingClientRect(), s = el.stage.getBoundingClientRect().width / 1024 || 1;
  W = Math.max(120, Math.round(r.width / s)); H = Math.max(80, Math.round(r.height / s));
  el.canvas.width = W * 2; el.canvas.height = H * 2;
  layout();
}

window.Apollo = {
  init() {
    const $ = (s) => document.querySelector(s);
    el = { stage: $("#stage"), canvas: $("#apCv"), phase: $("#apPhase"), step: $("#apStep"), get: $("#apGet"), utc: $("#apUtc"),
           next: $("#apNextEv"), speed: $("#apSpeed"), play: $("#apPlay") };
    if (!el.canvas) return;
    ctx = el.canvas.getContext("2d");
    resize();
    new ResizeObserver(resize).observe(el.canvas);
    $("#apBack").addEventListener("click", () => {
      const { i, frac } = missionTime(elapsed(performance.now()));
      jump(frac < 0.05 ? i - 1 : i); // first tap: start of this phase, second: previous phase
    });
    $("#apFwd").addEventListener("click", () => jump(missionTime(elapsed(performance.now())).i + 1));
    el.play.addEventListener("click", () => {
      const now = performance.now();
      if (pausedAt === null) pausedAt = now; else { t0Real += now - pausedAt; pausedAt = null; }
      frame(now, true);
    });
    frame(performance.now(), true);
  },
  frame,
  phases: PHASES,
  events: EVENTS,
};
})();
