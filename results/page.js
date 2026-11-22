// Draw the three charts from the live submissions and keep them fresh.
// Every name, colour and number drawn comes from the live data or from park.json (the app's own files).
import { build, bubbleOpacity, pageOf, voteText, where } from "./model.js";
import { layoutLine, station } from "./layout.js";

const REFRESH_S = 15;
const API = "https://exit12n-api-katze52zaq-uc.a.run.app/api/submissions";
// The API answers browsers on exit12n.org. On a local test server it does not, so serve.py forwards it at api/.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const SOURCES = LOCAL ? ["api/submissions", API] : [API];
// The final map's own selection: the function /final/ runs, or the snapshot it writes when published.
const FINAL = "https://exit12n.org/final/";
const FINAL_RETRY_S = 300; // while the final map is not there, look again this often

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

const votes = voteText;
const tipOf = (...lines) => lines.filter(Boolean).join("|");
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function drawLine(model, park, width) {
  const ob = model.objects;
  const L = layoutLine(model, park, width);
  const { W, narrow, X0, X1, GAP, x, xb } = L;
  const parts = []; // drawn with the line at y = 0: today above (negative), proposed below

  for (const { band: s, near, far } of [...L.today.drawn, ...L.after.drawn]) {
    const d = `M${near.map((y, b) => `${xb(b).toFixed(1)},${y.toFixed(1)}`).join("L")}L${far.map((y, b) => `${xb(b).toFixed(1)},${y.toFixed(1)}`).reverse().join("L")}Z`;
    // a stream of several same-name proposals reads like a merged bubble: "3 proposals, Boardwalk", then the votes added
    const named = s.count > 1 ? `${s.count} proposals, ${s.label}` : s.label;
    const tip = s.kind === "cover" ? cap(s.label) : s.kind === "removal" ? tipOf(`${named}: this ground turns to grass`, votes(s.for, s.against)) : tipOf(named, votes(s.for, s.against));
    parts.push(`<path d="${d}" fill="${s.color ?? UNCLASSED}" stroke="${PAPER}" stroke-width="0.8" data-tip="${esc(tip)}"/>` +
      (s.kind === "cover" ? `<path d="${d}" fill="url(#tx-${s.key})" pointer-events="none"/>` : ""));
  }

  // a removal is no band and no bubble: the ground it covered is grass now. Over that stretch of the grass band a
  // hover or tap names the removal and its votes.
  const grass = L.after.drawn.find((d) => d.band.key === "grass");
  if (grass && model.streams.removals.length) {
    const named = (b) => model.streams.removals.filter((r) => r.bins.has(b)).map((r) => [r.label, votes(r.for, r.against)].filter(Boolean).join(": "));
    const bins = grass.near.length;
    for (let a = 0; a < bins; ) {
      const names = named(a).join("; ");
      let b = a;
      while (b + 1 < bins && named(b + 1).join("; ") === names) b++;
      if (names) {
        // the stretch runs from half way to the section before to half way to the one after
        const xs = [];
        for (let k = a; k <= b; k++) xs.push(k);
        const edge = (ys) => xs.map((k) => `${xb(k).toFixed(1)},${ys[k].toFixed(1)}`);
        const left = xb(a) - (a > 0 ? (xb(a) - xb(a - 1)) / 2 : 0);
        const right = xb(b) + (b + 1 < bins ? (xb(b + 1) - xb(b)) / 2 : 0);
        const d = `M${left.toFixed(1)},${grass.near[a].toFixed(1)}L${edge(grass.near).join("L")}L${right.toFixed(1)},${grass.near[b].toFixed(1)}L${right.toFixed(1)},${grass.far[b].toFixed(1)}L${edge(grass.far).reverse().join("L")}L${left.toFixed(1)},${grass.far[a].toFixed(1)}Z`;
        // a wide unseen edge as well, so a strip of grass a pixel or two thick can still be hovered or tapped
        parts.push(`<path class="removal" d="${d}" fill="transparent" stroke="transparent" stroke-width="12" pointer-events="all" data-tip="${esc(`${cap(grass.band.label)}; ${names}`)}"/>`);
      }
      a = b + 1;
    }
  }

  // every bubble near its own distance along the exit, resting on the bands, none overlapping (layout.js)
  const bubble = (c, opacity, tip, kind) =>
    `<circle class="bubble" data-kind="${kind}" data-members="${c.o.members?.length ?? 1}" cx="${c.cx.toFixed(2)}" cy="${c.cy.toFixed(2)}" r="${c.r.toFixed(2)}" fill="${c.o.color}" fill-opacity="${opacity.toFixed(2)}" stroke="${c.o.color}" stroke-width="1.2" data-net="${c.o.net ?? ""}" data-home="${c.home.toFixed(2)}"/>` +
    // a merged bubble wears its count at its upper right, as the editor's pins do
    (c.o.members?.length > 1 ? `<text class="count" x="${(c.cx + c.r * 0.72 + 1).toFixed(1)}" y="${(c.cy - c.r * 0.72 + 3).toFixed(1)}" font-size="11.5" fill="${INK}" stroke="${PAPER}" stroke-width="3" paint-order="stroke" pointer-events="none">${c.o.members.length}</text>` : "") +
    `<circle cx="${c.cx.toFixed(1)}" cy="${c.cy.toFixed(1)}" r="${Math.max(c.r, 9).toFixed(1)}" fill="transparent" data-tip="${esc(tip)}"/>`;
  for (const c of L.there) parts.push(bubble(c, 0.85, cap(c.o.name), "there"));
  // a proposed thing, or a few merged, is more opaque the more net votes it has
  for (const c of L.proposed) parts.push(bubble(c, bubbleOpacity(c.o.net, L.mostNet), tipOf(c.o.name, votes(c.o.for, c.o.against)), "proposed"));

  // stop names, on as many rows as they need
  const rows = [];
  const stops = park.stops.map((p) => {
    const at = station(p.s); // each stop's station, small and grey after its name
    const w = (textW(p.name, 13) + textW(` ${at}`, 11.5)) * 1.1; // a little spare, so a name at either end is never cut
    const cx = Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, x(p.s)));
    let row = rows.findIndex((ends) => ends < cx - w / 2 - 8);
    if (row < 0) row = rows.push(0) - 1;
    rows[row] = cx + w / 2;
    return { ...p, cx, row, at };
  });
  const STOP_ROW = 17;
  const top = rows.length * STOP_ROW + 10;
  const highest = Math.min(...L.today.edge, ...L.there.map((c) => c.cy - c.r));
  const lowest = Math.max(...L.after.edge, ...L.proposed.map((c) => c.cy + c.r));
  const Y0 = Math.ceil(top - highest + 6);
  // the X axis, in metres along the exit, runs under everything, clear of the stop names at the top
  const AXIS_Y = Math.ceil(Y0 + lowest + 16);
  const H = AXIS_Y + 30;
  const tick = (cls, x1, y1, x2, y2) => `<line class="${cls}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${FAINT}" stroke-width="1"/>`;
  const xAxis = tick("axis", X0, AXIS_Y, X1, AXIS_Y) + L.axes.x.map((k, i) =>
    tick("axis", k.x, AXIS_Y, k.x, AXIS_Y + 5) +
    `<text class="xtick" data-m="${k.s}" x="${k.x.toFixed(1)}" y="${AXIS_Y + 19}" text-anchor="${i === 0 ? "start" : i === L.axes.x.length - 1 ? "end" : "middle"}" font-size="12" fill="${FAINT}">${k.label}</text>`).join("");
  // the Y axis, in metres across the park out from the line, spans the bands only (the bubbles are stacked, not measured)
  const YX = X0 - 7;
  const yAxis = L.axes.y.length
    ? tick("axis", YX, Y0 - GAP - L.half, YX, Y0 - GAP) + tick("axis", YX, Y0 + GAP, YX, Y0 + GAP + L.half) + L.axes.y.map((k) =>
      tick("axis", YX - 4, Y0 + k.y, YX, Y0 + k.y) +
      `<text class="ytick" data-m="${k.m}" x="${YX - 7}" y="${(Y0 + k.y + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="${FAINT}">${k.label}</text>`).join("")
    : "";

  const stopMarks = stops.map((p) => {
    const ly = 13 + p.row * STOP_ROW;
    return `<line x1="${x(p.s).toFixed(1)}" y1="${ly + 5}" x2="${x(p.s).toFixed(1)}" y2="${Y0}" stroke="${INK}" stroke-opacity="0.3" stroke-width="1"/>` +
      `<text x="${p.cx.toFixed(1)}" y="${ly}" text-anchor="middle" font-size="13" fill="${INK}" stroke="${PAPER}" stroke-width="3" paint-order="stroke">${esc(p.name)}<tspan class="at" font-size="11.5" fill="${FAINT}" dx="5">${p.at}</tspan></text>` +
      `<circle cx="${x(p.s).toFixed(1)}" cy="${Y0}" r="6" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>`;
  }).join("");
  const side = (y, t) => `<text x="${narrow ? X0 + 4 : 0}" y="${y}" font-size="14" fill="${INK}" class="caps" stroke="${PAPER}" stroke-width="3" paint-order="stroke">${t}</text>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="The exit as a line with its stops. Above it, the park's width today by land cover; below it, only the shown proposals, on a wider scale; each proposed thing is a bubble near its distance along the exit.">
    <defs>${patterns()}</defs><g transform="translate(0 ${Y0})">${parts.join("")}</g>
    <line x1="${X0}" y1="${Y0}" x2="${X1}" y2="${Y0}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    ${xAxis}${yAxis}${stopMarks}${side(Y0 - GAP - 8, "Today")}${side(Y0 + GAP + 16, "Proposed")}</svg>`;
}

function lineKey(model) {
  const st = model.streams;
  const swatch = (s) => s.kind === "cover"
    ? `<svg class="key" viewBox="0 0 16 16"><rect width="16" height="16" fill="${s.color ?? UNCLASSED}"/><rect width="16" height="16" fill="url(#tx-${s.key})"/></svg>`
    : `<span class="key" style="background:${s.color}"></span>`;
  const item = (s) => `<span class="item">${swatch(s)}${esc(s.label)}</span>`;
  const seen = new Set();
  const paths = st.proposed.filter((s) => s.shape === "line" && !seen.has(`${s.label}|${s.color}`) && seen.add(`${s.label}|${s.color}`));
  const rm = (st.below ?? []).find((s) => s.kind === "removal");
  return `<span class="caps">Today</span> ${st.today.map(item).join("")}` + (paths.length ? `<br><span class="caps">Proposed paths</span> ${paths.map(item).join("")}` : "") +
    (rm ? `<br><span class="caps">Removals</span> <span class="item"><span class="key" style="background:${rm.color}"></span>ground that turns to grass</span>` : "");
}

// ---------- 2. the shortlist ----------

function drawShortlist(model, park, W, page) {
  const narrow = W < 720;
  const AXIS = narrow ? Math.round(W * 0.3) : Math.min(700, Math.round(W * 0.6));
  // one scale for every page, so a bar means the same on page 1 and on page 7
  const mostFor = Math.max(2, ...model.ranked.map((g) => g.for));
  const mostAgainst = Math.max(1, ...model.ranked.map((g) => g.against));
  const UNIT = Math.min(64, (W - AXIS - 34) / mostFor, (narrow ? AXIS - 30 : 130) / mostAgainst);
  const ROW = narrow ? 70 : 34;
  const BAR = narrow ? 46 : 5;
  const parts = [
    `<text x="${AXIS - 8}" y="14" text-anchor="end" font-size="14" fill="${SOFT}" class="caps">against</text>`,
    `<text x="${AXIS + 8}" y="14" font-size="14" fill="${SOFT}" class="caps">for</text>`,
  ];
  let y = 26;
  for (const { item: g, rank: n } of page.rows) {
    const backed = g.net >= park.config.winSupport;
    const times = g.members.length > 1 ? `<tspan fill="${FAINT}" font-size="13"> ×${g.members.length}</tspan>` : "";
    const tip = tipOf(g.name, where(g, park), votes(g.for, g.against));
    parts.push(`<text x="18" y="${y + 18}" text-anchor="end" font-size="14" fill="${FAINT}">${n}</text>`);
    if (narrow) {
      const place = where(g, park);
      const fits = Math.floor((W - 30) / 6.3);
      parts.push(`<text x="28" y="${y + 18}" font-size="16" fill="${INK}">${esc(g.name)}${times}</text>`);
      parts.push(`<text x="28" y="${y + 37}" font-size="13" fill="${FAINT}">${esc(place.length > fits ? `${place.slice(0, fits - 1)}…` : place)}</text>`);
    } else {
      parts.push(`<text x="30" y="${y + 18}" font-size="17" fill="${INK}">${esc(g.name)}${times}<tspan fill="${FAINT}" font-size="13.5" dx="10">${esc(where(g, park))}</tspan></text>`);
    }
    if (g.for) parts.push(`<rect x="${AXIS + 1}" y="${y + BAR}" width="${(g.for * UNIT - 1).toFixed(1)}" height="16" rx="2" fill="${SIENNA}" fill-opacity="${backed ? 1 : 0.45}" data-tip="${esc(tip)}"/>`);
    if (g.against) parts.push(`<rect x="${(AXIS - g.against * UNIT).toFixed(1)}" y="${y + BAR}" width="${(g.against * UNIT - 1).toFixed(1)}" height="16" rx="2" fill="${FAINT}" fill-opacity="0.75" data-tip="${esc(tip)}"/>`);
    parts.push(`<text x="${(AXIS + g.for * UNIT + 8).toFixed(1)}" y="${y + BAR + 13}" font-size="14" fill="${INK}">${g.for}</text>`);
    if (g.against) parts.push(`<text x="${(AXIS - g.against * UNIT - 8).toFixed(1)}" y="${y + BAR + 13}" text-anchor="end" font-size="14" fill="${INK}">${g.against}</text>`);
    y += ROW;
  }
  const H = y + 6;
  if (!narrow) parts.push(`<line x1="${AXIS}" y1="22" x2="${AXIS}" y2="${H - 4}" stroke="${INK}" stroke-opacity="0.5" stroke-width="1"/>`);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Proposals ${page.from} to ${page.to} of ${page.total} by the people behind them, with the people for and against each">${parts.join("")}</svg>`;
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
      const place = it.at ? `${Math.round(it.at.s / 10) * 10} m along the ramp` : "off the ramp";
      parts.push(`<rect x="${sx + 0.6}" y="${sy + 3.6}" width="${SQ - 1.2}" height="${SQ - 1.2}" rx="2" ${style} data-tip="${esc(tipOf(it.name, place, votes(it.votesFor.size, it.votesAgainst.size)))}"/>`);
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
let finalMap = null; // the final map's module, once it has loaded
let selection = null; // its answer: { rows, via, at }, or null while the stand-in shows
let finalTried = 0;
let shortPage = 0; // the page of the shortlist the reader is on; kept through every refresh

/** Ask the final map which proposals it shows: its own function first, its snapshot second, else nothing. */
async function askFinalMap() {
  try {
    finalMap ??= await import(`${FINAL}top-proposals.js?t=${Date.now()}`);
    const r = await finalMap.topProposals();
    const rows = Array.isArray(r) ? r : r?.rows;
    if (Array.isArray(rows)) return { rows, via: "module", at: null };
  } catch {
    // not live yet, or its own read of the API was refused here (a local test server): try the snapshot
  }
  try {
    const r = await fetch(`${FINAL}top-proposals.json`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j?.rows)) return { rows: j.rows, via: "snapshot", at: j.at ?? null };
    }
  } catch {
    // no snapshot either
  }
  return null;
}

function render(subs) {
  const model = build(subs, park, selection);
  const st = model.streams;
  const c = model.counts;
  const W = $("shortlist").clientWidth || 360;
  $("counts").textContent = `${c.drawings} drawings and ${c.votes} votes from ${people(c.people)}`;

  const gives = [...st.today].filter((s) => s.givesM2 > 0).sort((a, b) => b.givesM2 - a.givesM2);
  const paths = st.proposed.length;
  const ob = model.objects;
  $("line-lead").textContent =
    `Along the exit's ${Math.round(model.m.length)} m the park is ${st.widthMin} to ${st.widthMax} m wide, ${m2(st.parkAreaM2)} in all. ` +
    (st.takenM2 > 0
      ? `The ${paths} proposed ${paths === 1 ? "path" : "paths"} shown would take ${m2(st.takenM2)} of it: ${gives.map((s) => `${m2(s.givesM2)} of ${s.label}`).join(", ")}. The ${ob.proposed.length} proposed things are bubbles and take none.`
      : `No proposed path is shown yet. The ${ob.proposed.length} proposed things are bubbles and take no ground.`) +
    (st.removals.length ? ` The ${st.removals.length} ${st.removals.length === 1 ? "removal" : "removals"} shown would turn ${m2(st.turnedToGrassM2)} to grass.` : "");
  $("line").innerHTML = drawLine(model, park, $("line").clientWidth || 360);
  $("line-key").innerHTML = lineKey(model);
  $("line-note").textContent =
    (model.chosen.standIn
      ? "Shown: every proposal with more people for it than against. "
      : `Shown: the final map's top proposals (exit12n.org/final)${model.chosen.via === "snapshot" && model.chosen.at ? `, as of ${new Date(model.chosen.at).toLocaleString()}` : ""}, with its counts of votes. `) +
    (ob.outside ? `${ob.outside} of the ${ob.proposed.length} things shown stand outside the park's outline: they are on the line by their distance along the exit all the same.` : "");

  const lead = model.ranked.slice(0, 3).map((g) => g.name);
  const contested = model.ranked.filter((g) => g.against > 0).length;
  $("shortlist-lead").textContent = `Out front: ${lead.join(", ")}. ${contested} of the ${c.proposals} proposals have someone against them.`;
  const page = pageOf(model.ranked, shortPage);
  shortPage = page.page; // a list that got shorter leaves the reader on its last page
  $("shortlist").innerHTML = drawShortlist(model, park, W, page);
  $("page-at").textContent = `${page.from} to ${page.to} of ${page.total}`;
  $("page-prev").disabled = page.page === 0;
  $("page-next").disabled = page.page >= page.pages - 1;

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
    const changed = text !== lastJson;
    // the final map's selection follows the same data: ask again when the data changed, or, while it has never
    // answered, every few minutes
    if ((selection && changed) || (!selection && Date.now() - finalTried > FINAL_RETRY_S * 1000)) {
      finalTried = Date.now();
      const next = await askFinalMap();
      const was = JSON.stringify(selection?.rows?.map((r) => [r.id, r.votesFor, r.votesAgainst]));
      const now = JSON.stringify(next?.rows?.map((r) => [r.id, r.votesFor, r.votesAgainst]));
      if (next || !selection) selection = next ?? selection;
      if (was !== now) lastJson = "";
    }
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

/** Previous and Next under the shortlist: real buttons, so a tap, a click and the keyboard all work. */
function pager() {
  const turn = (by) => () => {
    shortPage += by;
    if (lastSubs) render(lastSubs);
  };
  $("page-prev").addEventListener("click", turn(-1));
  $("page-next").addEventListener("click", turn(1));
}

async function start() {
  park = await (await fetch("park.json")).json();
  labels();
  pager();
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
