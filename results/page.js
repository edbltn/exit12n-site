// Draw the three charts from the live submissions and keep them fresh.
// Every name, colour and number drawn comes from the live data or from park.json (the app's own files).
import { build, where } from "./model.js";

const REFRESH_S = 15;
const API = "https://exit12n-api-katze52zaq-uc.a.run.app/api/submissions";
// The API answers browsers on exit12n.org. On a local test server it does not, so serve.py forwards it at api/.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const SOURCES = LOCAL ? ["api/submissions", API] : [API];

const INK = "#1b1813";
const SOFT = "#4f4a40";
const FAINT = "#7a7366";
const SIENNA = "#a86b3c";
const PAPER = "#faf3e5";
const UNCLASSED = "#e6dfcf";

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const textW = (t, size = 13) => t.length * size * 0.47 + 4;
const people = (n) => `${n} ${n === 1 ? "person" : "people"}`;
const m2 = (a) => `${Math.round(a).toLocaleString("en-US")} m²`;

// ---------- 1. the line ----------

/** A texture per land-cover class, drawn over the app's own colour for it. */
function patterns() {
  const p = (id, w, h, body) => `<pattern id="tx-${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse">${body}</pattern>`;
  const s = `stroke="${INK}" fill="none"`;
  return [
    p("asphalt", 6, 6, `<circle cx="1.5" cy="1.5" r="0.7" fill="${INK}" fill-opacity="0.38"/><circle cx="4.5" cy="4.5" r="0.7" fill="${INK}" fill-opacity="0.38"/>`),
    p("concrete", 9, 9, `<path d="M0 0.5H9M0.5 0V9" ${s} stroke-opacity="0.22" stroke-width="0.8"/>`),
    p("grass", 7, 8, `<path d="M1.5 1v3M5 5v3" ${s} stroke-opacity="0.4" stroke-width="0.9"/>`),
    p("leaf-litter", 12, 12, `<circle cx="3.5" cy="3.5" r="2.4" ${s} stroke-opacity="0.3" stroke-width="0.8"/><circle cx="9.5" cy="9.5" r="2.4" ${s} stroke-opacity="0.3" stroke-width="0.8"/>`),
    p("water", 12, 6, `<path d="M0 3q3 -3 6 0t6 0" ${s} stroke-opacity="0.35" stroke-width="0.8"/>`),
    p("none", 7, 7, `<path d="M-1 8L8 -1" ${s} stroke-opacity="0.28" stroke-width="0.8"/>`),
  ].join("");
}

/** Circles packed around their middle, the largest first, kept within `half` either side so stretches do not run together. */
function pack(radii, half) {
  const at = [];
  const order = radii.map((r, i) => i).sort((a, b) => radii[b] - radii[a]);
  const free = (x, y, r) => at.every((c) => Math.hypot(c.x - x, c.y - y) >= c.r + r + 1.5 - 1e-6);
  for (const i of order) {
    const r = radii[i];
    let best = null;
    const tryAt = (x, y) => {
      if (!free(x, y, r)) return;
      const over = Math.max(0, Math.abs(x) + r - half);
      const cost = x * x + y * y + over * over * 400;
      if (!best || cost < best.cost) best = { x, y, cost };
    };
    if (!at.length) tryAt(0, 0);
    for (const a of at) {
      const d = a.r + r + 1.5;
      for (let k = 0; k < 24; k++) tryAt(a.x + d * Math.cos((k * Math.PI) / 12), a.y + d * Math.sin((k * Math.PI) / 12));
    }
    for (let p = 0; p < at.length; p++) {
      for (let q = p + 1; q < at.length; q++) {
        const a = at[p];
        const b = at[q];
        const da = a.r + r + 1.5;
        const db = b.r + r + 1.5;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        if (dist > da + db || dist < 1e-6) continue;
        const t = (da * da - db * db + dist * dist) / (2 * dist);
        const hgt = Math.sqrt(Math.max(0, da * da - t * t));
        const ux = (b.x - a.x) / dist;
        const uy = (b.y - a.y) / dist;
        tryAt(a.x + ux * t - uy * hgt, a.y + uy * t + ux * hgt);
        tryAt(a.x + ux * t + uy * hgt, a.y + uy * t - ux * hgt);
      }
    }
    at.push({ i, x: best.x, y: best.y, r });
  }
  const top = Math.min(0, ...at.map((c) => c.y - c.r));
  const bottom = Math.max(0, ...at.map((c) => c.y + c.r));
  return { at, top, bottom };
}

function drawLine(model, park, width) {
  const st = model.streams;
  const ob = model.objects;
  const m = model.m;
  const W = Math.max(760, width);
  const X0 = 74;
  const X1 = W - 14;
  const x = (s) => X0 + (s / m.length) * (X1 - X0);
  const xb = (b) => x(Math.min(m.length, (b + 0.5) * park.binM));
  const PXM = 170 / st.widthMax; // pixels per metre across, the same for bands and bubbles
  const R = (a) => Math.max(3, PXM * Math.sqrt(a / Math.PI));
  const blocks = park.config.blockCount;
  const blockW = (X1 - X0) / blocks;
  const parts = [];

  // stop names, on as many rows as they need
  const rows = [];
  const stops = park.stops.map((p) => {
    const w = textW(p.name, 13);
    const cx = Math.max(X0 + w / 2 - 20, Math.min(X1 - w / 2 + 6, x(p.s)));
    let row = rows.findIndex((ends) => ends < cx - w / 2 - 8);
    if (row < 0) row = rows.push(0) - 1;
    rows[row] = cx + w / 2;
    return { ...p, cx, row };
  });
  const STOP_ROW = 17;
  const top = rows.length * STOP_ROW + 10;

  // bubbles, packed per stretch of the ramp
  const packs = (list) => Array.from({ length: blocks }, (_, b) => {
    const mine = list.filter((o) => o.block === b);
    return { mine, ...pack(mine.map((o) => R(o.areaM2)), blockW / 2 - 4) };
  });
  const there = packs(ob.there);
  const proposed = packs(ob.proposed);
  const thereH = Math.max(0, ...there.map((p) => p.bottom - p.top));
  const proposedH = Math.max(0, ...proposed.map((p) => p.bottom - p.top));

  const half = st.widthMax * PXM;
  const GAP = 8;
  const Y0 = top + thereH + (thereH ? 14 : 0) + half + GAP;

  const band = (s, base, dir) => {
    const near = base.map((y, b) => `${xb(b).toFixed(1)},${y.toFixed(1)}`);
    const far = base.map((y, b) => `${xb(b).toFixed(1)},${(y + dir * s.width[b] * PXM).toFixed(1)}`).reverse();
    const d = `M${near.join("L")}L${far.join("L")}Z`;
    const tip = s.kind === "cover"
      ? `${s.label}|${m2(s.areaM2)} of the park along the exit`
      : `${s.label}|${people(s.people)} for it${s.drawings > 1 ? `, drawn ${s.drawings} times` : ""}|${m2(s.areaM2)} of the park`;
    const fill = s.color ?? UNCLASSED;
    return `<path d="${d}" fill="${fill}" stroke="${PAPER}" stroke-width="0.8" data-tip="${esc(tip)}"/>` +
      (s.kind === "cover" ? `<path d="${d}" fill="url(#tx-${s.key})" pointer-events="none"/>` : "");
  };
  const stack = (bands, dir) => {
    let base = Array.from({ length: m.bins }, () => Y0 + dir * GAP);
    for (const s of bands) {
      parts.push(band(s, base, dir));
      base = base.map((y, b) => y + dir * s.width[b] * PXM);
    }
  };
  stack(st.today, -1);
  stack(st.after, 1);

  const bubble = (o, cx, cy, r, opacity, tip) =>
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${o.color}" fill-opacity="${opacity.toFixed(2)}" stroke="${o.color}" stroke-width="1.2"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(r, 11).toFixed(1)}" fill="transparent" data-tip="${esc(tip)}"/>`;
  there.forEach((p, b) => {
    const cx = X0 + (b + 0.5) * blockW;
    const cy0 = top + thereH - p.bottom;
    for (const c of p.at) {
      const o = p.mine[c.i];
      parts.push(bubble(o, cx + c.x, cy0 + c.y, c.r, 0.85, `${o.name}, here today|${m2(o.areaM2)}`));
    }
  });
  const proposedTop = Y0 + GAP + half + 16;
  proposed.forEach((p, b) => {
    const cx = X0 + (b + 0.5) * blockW;
    const cy0 = proposedTop - p.top;
    for (const c of p.at) {
      const o = p.mine[c.i];
      const votes = `${people(o.for)} for${o.against ? `, ${o.against} against` : ""}`;
      parts.push(bubble(o, cx + c.x, cy0 + c.y, c.r, o.net >= 1 ? 0.25 + 0.75 * (o.net / ob.mostNet) : 0.04, `${o.name}|${votes}|${m2(o.areaM2)}`));
    }
  });
  const H = Math.ceil(proposedTop + proposedH + 12);

  // the line, its stops, and the ends of the stretches the bubbles are gathered by
  const ticks = Array.from({ length: blocks + 1 }, (_, b) => `<line x1="${(X0 + b * blockW).toFixed(1)}" y1="${Y0 - 9}" x2="${(X0 + b * blockW).toFixed(1)}" y2="${Y0 + 9}" stroke="${INK}" stroke-width="1.5"/>`).join("");
  const stopMarks = stops.map((p) => {
    const ly = 13 + p.row * STOP_ROW;
    return `<line x1="${x(p.s).toFixed(1)}" y1="${ly + 5}" x2="${x(p.s).toFixed(1)}" y2="${Y0}" stroke="${INK}" stroke-opacity="0.3" stroke-width="1"/>` +
      `<text x="${p.cx.toFixed(1)}" y="${ly}" text-anchor="middle" font-size="13" fill="${INK}" stroke="${PAPER}" stroke-width="3" paint-order="stroke">${esc(p.name)}</text>` +
      `<circle cx="${x(p.s).toFixed(1)}" cy="${Y0}" r="6" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>`;
  }).join("");
  const side = (y, t) => `<text x="0" y="${y}" font-size="14" fill="${INK}" class="caps">${t}</text>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="The exit as a line with its stops. Above it, the park's width today by land cover; below it, the same width once the proposed paths are laid over it; proposed things as bubbles.">
    <defs>${patterns()}</defs>${parts.join("")}
    <line x1="${X0}" y1="${Y0}" x2="${X1}" y2="${Y0}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    ${ticks}${stopMarks}${side(Y0 - GAP - 8, "Today")}${side(Y0 + GAP + 16, "Proposed")}</svg>`;
}

function lineKey(model) {
  const st = model.streams;
  const swatch = (s) => s.kind === "cover"
    ? `<svg class="key" viewBox="0 0 16 16"><rect width="16" height="16" fill="${s.color ?? UNCLASSED}"/><rect width="16" height="16" fill="url(#tx-${s.key})"/></svg>`
    : `<span class="key" style="background:${s.color}"></span>`;
  const cover = st.today.map((s) => `<span class="item">${swatch(s)}${esc(s.label)}</span>`).join("");
  const proposed = st.proposed.map((s) => `<span class="item">${swatch(s)}${esc(s.label)}${s.drawings > 1 ? ` ×${s.drawings}` : ""}</span>`).join("");
  return `<span class="caps">Today</span> ${cover}` + (proposed ? `<br><span class="caps">Proposed paths</span> ${proposed}` : "");
}

// ---------- 2. the shortlist ----------

function drawShortlist(model, park, W) {
  const narrow = W < 720;
  const top = model.ranked.slice(0, 10);
  const contested = model.ranked.filter((g) => g.against > 0 && !top.includes(g)).sort((a, b) => b.against - a.against || b.for - a.for).slice(0, 8);
  const all = [...top, ...contested];
  const AXIS = narrow ? Math.round(W * 0.3) : Math.min(700, Math.round(W * 0.6));
  const mostFor = Math.max(2, ...all.map((g) => g.for));
  const mostAgainst = Math.max(1, ...all.map((g) => g.against));
  const UNIT = Math.min(64, (W - AXIS - 34) / mostFor, (narrow ? AXIS - 30 : 130) / mostAgainst);
  const ROW = narrow ? 70 : 34;
  const BAR = narrow ? 46 : 5;
  const parts = [
    `<text x="${AXIS - 8}" y="14" text-anchor="end" font-size="14" fill="${SOFT}" class="caps">against</text>`,
    `<text x="${AXIS + 8}" y="14" font-size="14" fill="${SOFT}" class="caps">for</text>`,
  ];
  let y = 26;
  const row = (g, n) => {
    const backed = g.net >= park.config.winSupport;
    const times = g.members.length > 1 ? `<tspan fill="${FAINT}" font-size="13"> ×${g.members.length}</tspan>` : "";
    const tip = `${g.name}|${where(g, park)}|${people(g.for)} for${g.against ? `, ${g.against} against` : ""}${g.members.length > 1 ? `, drawn ${g.members.length} times` : ""}`;
    parts.push(`<text x="18" y="${y + 18}" text-anchor="end" font-size="14" fill="${FAINT}">${n}</text>`);
    if (narrow) {
      parts.push(`<text x="28" y="${y + 18}" font-size="16" fill="${INK}">${esc(g.name)}${times}</text>`);
      const place = where(g, park);
      const fits = Math.floor((W - 30) / 6.3);
      parts.push(`<text x="28" y="${y + 37}" font-size="13" fill="${FAINT}">${esc(place.length > fits ? `${place.slice(0, fits - 1)}…` : place)}</text>`);
    } else {
      parts.push(`<text x="30" y="${y + 18}" font-size="17" fill="${INK}">${esc(g.name)}${times}<tspan fill="${FAINT}" font-size="13.5" dx="10">${esc(where(g, park))}</tspan></text>`);
    }
    if (g.for) parts.push(`<rect x="${AXIS + 1}" y="${y + BAR}" width="${(g.for * UNIT - 1).toFixed(1)}" height="16" rx="2" fill="${SIENNA}" fill-opacity="${backed ? 1 : 0.45}" data-tip="${esc(tip)}"/>`);
    if (g.against) parts.push(`<rect x="${(AXIS - g.against * UNIT).toFixed(1)}" y="${y + BAR}" width="${(g.against * UNIT - 1).toFixed(1)}" height="16" rx="2" fill="${FAINT}" fill-opacity="0.75" data-tip="${esc(tip)}"/>`);
    parts.push(`<text x="${(AXIS + g.for * UNIT + 8).toFixed(1)}" y="${y + BAR + 13}" font-size="14" fill="${INK}">${g.for}</text>`);
    if (g.against) parts.push(`<text x="${(AXIS - g.against * UNIT - 8).toFixed(1)}" y="${y + BAR + 13}" text-anchor="end" font-size="14" fill="${INK}">${g.against}</text>`);
    y += ROW;
  };
  top.forEach((g, i) => row(g, i + 1));
  const listTop = narrow ? 68 : 22;
  if (contested.length) {
    y += 8;
    parts.push(`<text x="28" y="${y + 16}" font-size="15" fill="${SOFT}" class="caps">Further down, with someone against</text>`);
    y += 28;
    contested.forEach((g) => row(g, model.ranked.indexOf(g) + 1));
  }
  const H = y + 6;
  if (!narrow) parts.push(`<line x1="${AXIS}" y1="${listTop}" x2="${AXIS}" y2="${H - 4}" stroke="${INK}" stroke-opacity="0.5" stroke-width="1"/>`);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="The ten proposals with the most people behind them, and those with someone against, with the people for and against each">${parts.join("")}</svg>`;
}

// ---------- 3. the themes ----------

function drawThemes(model, park, W) {
  const narrow = W < 720;
  const SQ = 14;
  const STEP = SQ + 3;
  const LABEL = narrow ? 0 : 250;
  const perLine = Math.max(6, Math.floor((W - LABEL - (narrow ? 0 : 170)) / STEP));
  const parts = [];
  let y = 6;
  for (const t of model.themes) {
    const n = t.items.length;
    const summary = `${n} ${n === 1 ? "drawing" : "drawings"}, ${people(t.people)}`;
    if (narrow) {
      parts.push(`<text x="0" y="${y + 15}" font-size="16" fill="${INK}">${esc(t.label)}<tspan fill="${SOFT}" font-size="13.5" dx="8">${summary}</tspan></text>`);
      y += 24;
    } else {
      parts.push(`<text x="${LABEL - 14}" y="${y + 15}" text-anchor="end" font-size="16" fill="${INK}">${esc(t.label)}</text>`);
    }
    t.items.forEach((it, k) => {
      const sx = LABEL + (k % perLine) * STEP;
      const sy = y + Math.floor(k / perLine) * STEP;
      const style = it.net >= park.config.winSupport ? `fill="${SIENNA}"` : it.net === 1 ? `fill="${SIENNA}" fill-opacity="0.45"` : `fill="none" stroke="${FAINT}" stroke-width="1.2"`;
      const votes = `${people(it.votesFor.size)} for${it.votesAgainst.size ? `, ${it.votesAgainst.size} against` : ""}`;
      const place = it.at ? `${Math.round(it.at.s / 10) * 10} m along the ramp` : "off the ramp";
      parts.push(`<rect x="${sx + 0.6}" y="${sy + 3.6}" width="${SQ - 1.2}" height="${SQ - 1.2}" rx="2" ${style} data-tip="${esc(`${it.name}|${place}|${votes}`)}"/>`);
    });
    const lines = Math.ceil(n / perLine);
    if (!narrow) parts.push(`<text x="${LABEL + Math.min(n, perLine) * STEP + 10}" y="${y + 15}" font-size="14" fill="${SOFT}">${summary}</text>`);
    y += lines * STEP + (narrow ? 14 : 11);
  }
  const H = y + 4;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Every drawing on the map as a square, in rows by kind of idea">${parts.join("")}</svg>`;
}

// ---------- the page ----------

const $ = (id) => document.getElementById(id);
let park = null;
let lastJson = "";
let lastSubs = null;
let lastGood = null;
let source = 0;

function render(subs) {
  const model = build(subs, park);
  const st = model.streams;
  const c = model.counts;
  const W = $("shortlist").clientWidth || 360;
  $("counts").textContent = `${c.drawings} drawings and ${c.votes} votes from ${people(c.people)}`;

  const gives = [...st.today].filter((s) => s.givesM2 > 0).sort((a, b) => b.givesM2 - a.givesM2);
  $("line-lead").textContent =
    `Along the exit's ${Math.round(model.m.length)} m the park is ${st.widthMin} to ${st.widthMax} m wide, ${m2(st.parkAreaM2)} in all. ` +
    (st.takenM2 > 0
      ? `The ${st.proposed.length} proposed ${st.proposed.length === 1 ? "path" : "paths"} with more people for than against would take ${m2(st.takenM2)} of it: ${gives.map((s) => `${m2(s.givesM2)} of ${s.label}`).join(", ")}.`
      : "No proposed path has more people for it than against yet.");
  $("line").innerHTML = drawLine(model, park, $("line").clientWidth || 360);
  $("line-key").innerHTML = lineKey(model);
  const ob = model.objects;
  $("line-note").textContent =
    `${ob.proposed.length} proposed things stand in the park and are drawn as bubbles` +
    (ob.outside ? `; ${ob.outside} more stand outside the park's outline and are not.` : ".");

  const lead = model.ranked.slice(0, 3).map((g) => g.name);
  const contested = model.ranked.filter((g) => g.against > 0).length;
  $("shortlist-lead").textContent = `Out front: ${lead.join(", ")}. ${contested} of the ${c.proposals} proposals have someone against them.`;
  $("shortlist").innerHTML = drawShortlist(model, park, W);
  const tail = model.ranked[10];
  $("shortlist-rest").textContent = tail ? `The other ${c.proposals - 10} proposals each have ${people(tail.for)} or fewer for them.` : "";

  const first = model.themes[0];
  const most = [...model.themes].sort((a, b) => b.items.length - a.items.length)[0];
  $("themes-lead").textContent = `${first.label} has the most people behind it (${first.people}); ${most.label} has the most drawings (${most.items.length}).`;
  $("themes").innerHTML = drawThemes(model, park, W);
  $("rules").textContent =
    `Drawings of the same thing within ${park.config.reachM} m of each other along the ramp are one proposal, counted by the people for it, not by the drawings. ` +
    `Dark means ${park.config.winSupport} or more people for it than against, the app's own bar; light means one.`;
}

async function refresh() {
  try {
    let text = null;
    let error = null;
    for (let k = 0; k < SOURCES.length && text === null; k++) {
      const i = (source + k) % SOURCES.length;
      try {
        const r = await fetch(SOURCES[i], { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        text = await r.text();
        source = i;
      } catch (e) {
        error = e;
      }
    }
    if (text === null) throw error;
    const subs = JSON.parse(text);
    if (!Array.isArray(subs)) throw new Error("not a list");
    lastGood = new Date();
    if (text !== lastJson) {
      lastJson = text;
      lastSubs = subs;
      render(subs);
    }
    $("status").textContent = `Live. Last checked ${lastGood.toLocaleTimeString()}; checks every ${REFRESH_S} seconds.`;
    $("status").classList.remove("stale");
  } catch (e) {
    $("status").textContent = lastGood
      ? `The live data did not answer just now (${e.message}). Showing what it said at ${lastGood.toLocaleTimeString()}; still trying every ${REFRESH_S} seconds.`
      : `The live data is not answering (${e.message}). Trying again every ${REFRESH_S} seconds.`;
    $("status").classList.add("stale");
  }
}

/** What a mark is, shown on hover with a mouse and on a tap with a finger. */
function labels() {
  const box = $("tip");
  const show = (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
    if (!t) {
      box.hidden = true;
      return;
    }
    const [head, ...rest] = t.getAttribute("data-tip").split("|");
    box.innerHTML = `<strong>${esc(head)}</strong>${rest.map((l) => `<br>${esc(l)}`).join("")}`;
    box.hidden = false;
    const bw = box.offsetWidth;
    box.style.left = `${Math.max(8, Math.min(document.documentElement.clientWidth - bw - 8, e.clientX + 14)) + window.scrollX}px`;
    box.style.top = `${e.clientY + 16 + window.scrollY}px`;
  };
  document.addEventListener("pointermove", (e) => e.pointerType === "mouse" && show(e));
  document.addEventListener("click", show);
}

async function start() {
  park = await (await fetch("park.json")).json();
  labels();
  await refresh();
  setInterval(refresh, REFRESH_S * 1000);
  let width = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth !== width && lastSubs) {
      width = window.innerWidth;
      render(lastSubs);
    }
  });
}

start();
