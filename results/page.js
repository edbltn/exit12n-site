// The results page (round 11, Eric 2026-11-24 17:20): two filters (who: Walker, Gardener and nature, Kids and play, Other;
// where: the ramp's sections and off the ramp), then the rankings (proposals by votes; where the changes went, by type and
// every drawing as a square shaded by its votes), the bubbles along the ramp (area, votes, the voted paths, a zoom window)
// and what each group gets. Everything starts on; the address keeps what is switched off (#for=...&in=...).
// Live: the drawings and votes come from the Exit 12N API every 15 seconds, read and grouped as the charts read them.
import { bubbleOpacity, build, rank, themes, where } from "./charts/model.js";
import { offers, voteWords } from "./offers.js";
import { formatHash, parseHash, sectionOf } from "./filters.js";
import { alongRamp, byType, clampWindow, keep, labelled, lanes, radius, voteStep } from "./views.js";

const REFRESH_S = 15;
const API = "https://exit12n-api-katze52zaq-uc.a.run.app/api/submissions";
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const SOURCES = LOCAL ? ["api/submissions", API] : [API];
const FIRST = 10; // rows shown before "Show all", in each list

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let data = null; // personas.json: the four groups, their aliases, the sections, the kinds' labels, featured proposals
let park = null; // charts/park.json
let who = [];
let at = [];
let lastText = "";
let lastSubs = null;
let model = null;
let lastGood = null;
const open = { top: false, types: false, offers: false }; // "Show all" per list
let win = null; // the zoom window [a, b] in meters along the ramp

/** A group's color: the file's color on the light paper; a lighter one of the same hue on the dark paper. */
const dark = () => document.documentElement.dataset.theme === "dark";
const colour = (p) => (dark() ? p.colourDark : p.colour);
const P = (id) => data.personas.find((p) => p.id === id);
const narrow = () => innerWidth < 640;
const m2 = (a) => (a >= 100 ? Math.round(a / 10) * 10 : Math.round(a)).toLocaleString("en-US");

function drawPicker() {
  if (!$("who").querySelector(".chip")) {
    $("who").innerHTML = data.personas.map((p) => `<button type="button" class="chip" data-who="${esc(p.id)}" aria-pressed="false"><span class="dot" aria-hidden="true"></span>${esc(p.name)}<span class="n"></span></button>`).join("");
    $("where").innerHTML = data.sections.map((s) => `<button type="button" class="chip place" data-at="${esc(s.id)}" aria-pressed="false" title="${esc(s.long)}">${esc(s.name)}<span class="n"></span></button>`).join("");
    $("members").innerHTML = data.personas.map((p) => `<p><b>${esc(p.name)}</b>: ${esc(p.members.join(", "))}.</p>`).join("");
  }
  for (const b of $("who").querySelectorAll(".chip")) {
    b.style.setProperty("--c", colour(P(b.dataset.who)));
    b.setAttribute("aria-pressed", String(who.includes(b.dataset.who)));
  }
  for (const b of $("where").querySelectorAll(".chip")) {
    b.style.setProperty("--c", "var(--ink)");
    b.setAttribute("aria-pressed", String(at.includes(b.dataset.at)));
  }
  if (model) { // proposals for that group in the places on; proposals in that place for the groups on
    for (const b of $("who").querySelectorAll(".chip")) b.querySelector(".n").textContent = keep(model.groups, data, [b.dataset.who], at).length;
    for (const b of $("where").querySelectorAll(".chip")) b.querySelector(".n").textContent = keep(model.groups, data, who, [b.dataset.at]).length;
  }
  $("tools").hidden = who.length === data.personas.length && at.length === data.sections.length;
}

const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
const plural = { walker: "walkers", gardener: "gardeners and nature lovers", "kids-and-play": "kids and players", other: "everyone else" };
const more = (key, n, total) => {
  $(`${key}-more`).hidden = total <= n && !open[key];
  $(`${key}-all`).textContent = open[key] ? `Show the first ${FIRST}` : `Show all ${total}`;
};

// ---------- the rankings ----------
function drawTop(groups) {
  const ranked = rank(groups);
  const shown = open.top ? ranked : ranked.slice(0, FIRST);
  const most = Math.max(1, ...ranked.map((g) => Math.max(g.for, g.against)));
  const bar = (n) => `<i style="width:${((n / most) * 100).toFixed(1)}%"></i>`;
  $("top").tBodies[0].innerHTML = shown.map((g, i) => {
    const sec = data.sections.find((s) => s.id === sectionOf(g, data.sections));
    const times = g.members.length > 1 ? ` <span class="times">×${g.members.length}</span>` : "";
    return `<tr><td class="rank">${i + 1}</td><td><a href="/map/?p=${encodeURIComponent(g.id)}">${esc(g.name)}</a>${times}<span class="at">${esc(sec.off ? sec.name : `${sec.name}: ${where(g, park)}`)}</span></td>` +
      `<td class="votes" aria-label="${esc(voteWords(g.for, g.against))}"><div class="bars"><span class="against">${g.against ? `<b>${g.against}</b>${bar(g.against)}` : ""}</span><span class="for">${g.for ? `${bar(g.for)}<b>${g.for}</b>` : ""}</span></div></td></tr>`;
  }).join("") || `<tr><td></td><td>Nothing here yet.</td><td></td></tr>`;
  more("top", FIRST, ranked.length);
}

function drawTypes(items) {
  const rows = byType(items, data.kinds);
  const shown = open.types ? rows : rows.slice(0, FIRST);
  const most = Math.max(1, ...rows.map((r) => r.for));
  $("types").innerHTML = shown.map((r) => `<li><span>${esc(r.label)} <span class="n">${r.drawings} ${r.drawings === 1 ? "drawing" : "drawings"}</span></span>` +
    `<span class="bar" title="${esc(voteWords(r.for, r.against))}"><i style="width:${((r.for / most) * 4.5).toFixed(2)}rem"></i>${r.for}</span></li>`).join("");
  more("types", FIRST, rows.length);
}

function drawSquares(items) {
  const rows = themes(items, park);
  const tip = (it) => `${it.name}: ${voteWords(it.for, it.against)}`;
  $("squares").innerHTML = rows.map((r) => `<div class="fam"><span>${esc(r.label)}</span><div class="boxes">` +
    r.items.map((it) => `<a class="v${voteStep(it.for)}" href="/map/?p=${encodeURIComponent(it.id)}" title="${esc(tip(it))}" aria-label="${esc(tip(it))}"></a>`).join("") + `</div></div>`).join("");
  $("shade-key").innerHTML = ["no one for it yet", "1 person for it", "2", "3", "4 or more"].map((t, i) => `<span><a class="v${i}" aria-hidden="true"></a>${t}</span>`).join("");
  $("shade-key").classList.add("squares");
}

// ---------- the bubbles along the ramp ----------
let along = null; // what the chart draws, kept between zoom drags
let fullH = 0; // the chart's height for the whole ramp, for the filters on
function drawAlong() {
  const box = $("along");
  const W = Math.max(300, box.clientWidth || 600);
  const N = narrow();
  const L = model.m.length;
  win = win ? clampWindow(win[0], win[1], L) : [0, L];
  const [a, b] = win;
  const X0 = 6, X1 = W - 6;
  const x = (s) => X0 + ((s - a) / (b - a)) * (X1 - X0);
  const { bubbles, streams, off } = along;
  const rMax = N ? 30 : 46;
  const maxArea = Math.max(1, ...bubbles.map((q) => q.areaM2));
  const mostB = Math.max(1, ...bubbles.map((q) => q.net));
  const mostS = Math.max(1, ...streams.map((q) => q.net));
  // streams above the line, one lane each, most votes nearest the line
  const lane = lanes(streams);
  const LANE = N ? 9 : 11;
  const nLanes = Math.max(0, ...lane.values()) + (streams.length ? 1 : 0);
  const lineY = 34 + nLanes * LANE + 8;
  const parts = [];
  // the line and its sections
  const along0 = data.sections.filter((s) => !s.off);
  for (const sec of along0) {
    if (sec.s1 < a || sec.s0 > b) continue;
    const x0 = Math.max(X0, x(sec.s0)), x1 = Math.min(X1, x(sec.s1));
    parts.push(`<line x1="${x0.toFixed(1)}" y1="${lineY}" x2="${x1.toFixed(1)}" y2="${lineY}" stroke="${at.includes(sec.id) ? "var(--ink)" : "var(--hairline)"}" stroke-width="2"${at.includes(sec.id) ? "" : ' stroke-dasharray="3 3"'}/>`);
    if (sec.s0 > a) parts.push(`<line x1="${x(sec.s0).toFixed(1)}" y1="${lineY - 5}" x2="${x(sec.s0).toFixed(1)}" y2="${lineY + 5}" stroke="var(--ink-faint)"/>`);
    const w = x1 - x0, name = N || w < 160 ? sec.name : sec.long.split(":")[0];
    if (w > name.length * 6.2) parts.push(`<text x="${((x0 + x1) / 2).toFixed(1)}" y="${lineY + 17}" font-size="${N ? 11 : 12}" fill="var(--ink-faint)" text-anchor="middle">${esc(name)}</text>`);
  }
  parts.push(`<text x="${X0}" y="12" font-size="11" fill="var(--ink-faint)">${Math.round(a)} m${a < 1 ? ", Henry Hudson Parkway" : ""}</text><text x="${X1}" y="12" font-size="11" fill="var(--ink-faint)" text-anchor="end">${Math.round(b)} m${b > L - 1 ? ", Saint Clair Place" : ""}</text>`);
  // streams
  for (const st of [...streams].sort((p, q) => lane.get(q.id) - lane.get(p.id))) {
    if (st.s1 < a || st.s > b) continue;
    const y = lineY - 10 - lane.get(st.id) * LANE;
    const x0 = Math.max(X0, x(st.s)), x1 = Math.max(x0 + 3, Math.min(X1, x(st.s1)));
    const th = Math.max(2.5, Math.min(LANE - 3, st.widthM * 0.9));
    parts.push(`<line class="st" data-id="${esc(st.id)}" x1="${x0.toFixed(1)}" y1="${y}" x2="${x1.toFixed(1)}" y2="${y}" stroke="${colour(st)}" stroke-opacity="${bubbleOpacity(st.net, mostS).toFixed(2)}" stroke-width="${th.toFixed(1)}" stroke-linecap="round"/>`);
  }
  // bubbles below the line: biggest placed first, each at its own place along, dropped until it touches nothing
  const shown = bubbles.filter((q) => q.mid >= a - 1 && q.mid <= b + 1).map((q) => ({ ...q, r: radius(q.areaM2, maxArea, rMax), cx: x(q.mid) }));
  const placed = [];
  const top0 = lineY + 26;
  for (const q of [...shown].sort((p, r) => r.r - p.r)) {
    let y = top0 + q.r;
    for (let guard = 0; guard < 400; guard++) {
      const hit = placed.find((o) => Math.hypot(o.cx - q.cx, o.cy - y) < o.r + q.r + 1.5);
      if (!hit) break;
      y = hit.cy + Math.sqrt(Math.max(0, (hit.r + q.r + 1.6) ** 2 - (hit.cx - q.cx) ** 2)) + 0.5;
    }
    q.cy = y;
    placed.push(q);
  }
  const named = labelled(shown, a, b, N ? 4 : 8);
  for (const q of placed) parts.push(`<circle class="b" data-id="${esc(q.id)}" cx="${q.cx.toFixed(1)}" cy="${q.cy.toFixed(1)}" r="${q.r.toFixed(1)}" fill="${colour(q)}" fill-opacity="${bubbleOpacity(q.net, mostB).toFixed(2)}" stroke="${colour(q)}" stroke-width="1"/>`);
  const boxes = []; // labels already written: a label that would overlap one is left to hover and tap
  for (const q of placed.filter((p) => named.has(p.id)).sort((p, r) => r.r - p.r)) {
    const tw = q.name.length * 6.4 + 6;
    const fits = q.r * 2 > tw;
    const y = fits ? q.cy + 4 : q.cy + q.r + 13;
    const bx = { x0: q.cx - tw / 2, x1: q.cx + tw / 2, y0: y - 12, y1: y + 3 };
    if (bx.x0 < 0 || bx.x1 > W || boxes.some((o) => bx.x0 < o.x1 && o.x0 < bx.x1 && bx.y0 < o.y1 && o.y0 < bx.y1)) continue;
    boxes.push(bx);
    parts.push(`<text x="${q.cx.toFixed(1)}" y="${y.toFixed(1)}" font-size="12" text-anchor="middle" fill="var(--ink)" stroke="var(--paper)" stroke-width="3" paint-order="stroke" pointer-events="none">${esc(q.name)}</text>`);
  }
  let H = Math.max(top0 + 40, ...placed.map((q) => q.cy + q.r + (named.has(q.id) ? 20 : 6)));
  // while zoomed the chart keeps the height it has for the whole ramp, so the zoom window under it stays under the finger
  if (a <= 0.5 && b >= L - 0.5) fullH = H; else H = Math.max(H, fullH);
  const tip = $("tip");
  box.innerHTML = "";
  box.insertAdjacentHTML("beforeend", `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" width="${W}" height="${H.toFixed(0)}" role="img" aria-label="${esc(`${placed.length} proposed things and ${streams.length} voted paths along the ramp, from ${Math.round(a)} to ${Math.round(b)} meters`)}">${parts.join("")}</svg>`);
  box.appendChild(tip);
  const offLine = off ? `${off} ${off === 1 ? "proposal stands" : "proposals stand"} off the ramp: in the rankings, not drawn here.` : "";
  $("zoom-tools").innerHTML = `${a > 0.5 || b < L - 0.5 ? `Showing ${Math.round(a)} to ${Math.round(b)} m.<button type="button" id="zoom-all">Whole ramp</button>` : "Showing the whole ramp."} ${offLine}`;
  drawZoom();
}

/** The tip for a bubble or a stream, at the pointer. */
function showTip(el, e) {
  const id = el.dataset.id;
  const q = [...along.bubbles, ...along.streams].find((x) => x.id === id);
  if (!q) return;
  const tip = $("tip");
  const sec = data.sections.find((s) => s.id === sectionOf(q, data.sections));
  tip.innerHTML = `<b>${esc(q.name)}${q.members.length > 1 ? ` ×${q.members.length}` : ""}</b><span>${esc(P(q.groupId).name)} · ${esc(sec.name)}: ${esc(where(q, park))}<br>` +
    `${q.kind === "point" ? `about ${m2(q.areaM2)} m², ` : q.widthM ? `${m2(q.widthM)} m wide, ` : ""}${esc(voteWords(q.for, q.against))}</span>`;
  tip.hidden = false;
  const box = $("along").getBoundingClientRect();
  const px = e.clientX - box.left, py = e.clientY - box.top;
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(0, Math.min(box.width - w, px - w / 2))}px`;
  tip.style.top = `${py + 14}px`;
}

// the zoom window: an overview of the whole ramp under the chart, its window dragged (pan) or its handles (resize)
function drawZoom() {
  const W = Math.max(300, $("zoom").clientWidth || 600);
  const L = model.m.length;
  const X0 = 6, X1 = W - 6, H = 34;
  const x = (s) => X0 + (s / L) * (X1 - X0);
  const [a, b] = win;
  const ticks = [...along.streams.map((q) => `<line x1="${x(q.s).toFixed(1)}" y1="11" x2="${Math.max(x(q.s) + 1, x(q.s1)).toFixed(1)}" y2="11" stroke="var(--ink-faint)" stroke-width="2"/>`),
    ...along.bubbles.map((q) => `<circle cx="${x(q.mid).toFixed(1)}" cy="22" r="2" fill="var(--ink-faint)"/>`)].join("");
  $("zoom").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect class="track" x="${X0}" y="2" width="${X1 - X0}" height="${H - 4}" fill="var(--paper-deep)"/>${ticks}` +
    `<g class="win" tabindex="0" role="slider" aria-label="Zoom window along the ramp, in meters; arrow keys move it, plus and minus zoom" aria-valuemin="0" aria-valuemax="${Math.round(L)}" aria-valuenow="${Math.round(a)}" aria-valuetext="${Math.round(a)} to ${Math.round(b)} meters">` +
    `<rect class="frame" x="${x(a).toFixed(1)}" y="1" width="${(x(b) - x(a)).toFixed(1)}" height="${H - 2}" fill="var(--rule)" fill-opacity="0.1" stroke="var(--rule)" stroke-width="2"/></g>` +
    `<rect class="handle" data-end="a" x="${(x(a) - 6).toFixed(1)}" y="0" width="12" height="${H}" fill="transparent"/><rect x="${(x(a) - 2).toFixed(1)}" y="6" width="4" height="${H - 12}" rx="1" fill="var(--rule)" pointer-events="none"/>` +
    `<rect class="handle" data-end="b" x="${(x(b) - 6).toFixed(1)}" y="0" width="12" height="${H}" fill="transparent"/><rect x="${(x(b) - 2).toFixed(1)}" y="6" width="4" height="${H - 12}" rx="1" fill="var(--rule)" pointer-events="none"/></svg>`;
}

function zoomEvents() {
  const z = $("zoom");
  let drag = null;
  const toS = (e) => {
    const r = z.getBoundingClientRect();
    return ((e.clientX - r.left - 6) / (r.width - 12)) * model.m.length;
  };
  let pending = false;
  const redraw = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; drawAlong(); }); } };
  z.addEventListener("pointerdown", (e) => {
    if (!model) return;
    const s = toS(e);
    const end = e.target.closest(".handle")?.dataset.end;
    const inside = s >= win[0] && s <= win[1];
    drag = { end, from: s, win: [...win] };
    if (!end && !inside) { const w = win[1] - win[0]; win = clampWindow(s - w / 2, s + w / 2, model.m.length); drag.win = [...win]; redraw(); }
    z.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  z.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const d = toS(e) - drag.from, L = model.m.length, [a, b] = drag.win;
    if (drag.end === "a") win = clampWindow(Math.min(a + d, b - 100), b, L);
    else if (drag.end === "b") win = clampWindow(a, Math.max(b + d, a + 100), L);
    else { const w = b - a; const a1 = Math.max(0, Math.min(L - w, a + d)); win = [a1, a1 + w]; }
    redraw();
  });
  const stop = () => { drag = null; };
  z.addEventListener("pointerup", stop);
  z.addEventListener("pointercancel", stop);
  z.addEventListener("keydown", (e) => {
    if (!model || !e.target.closest(".win")) return;
    const L = model.m.length, [a, b] = win, w = b - a, step = Math.max(10, w / 10);
    if (e.key === "ArrowLeft") win = clampWindow(a - step, b - step, L);
    else if (e.key === "ArrowRight") win = clampWindow(a + step, b + step, L);
    else if (e.key === "+" || e.key === "=") win = clampWindow(a + w / 4, b - w / 4, L);
    else if (e.key === "-") win = clampWindow(a - w / 2, b + w / 2, L);
    else return;
    e.preventDefault();
    drawAlong();
    z.querySelector(".win")?.focus();
  });
}

// ---------- what each group gets (round 10's list) ----------
function drawOffers(inAt) {
  const rows = offers(inAt, data.personas, who, data.kinds, data.featured);
  const shown = open.offers ? rows : rows.slice(0, FIRST);
  $("offers").innerHTML = shown.map((r) => {
    const g = r.group;
    const star = r.featured.length ? P(r.featured[0]) : null;
    const times = g.members.length > 1 ? ` <span class="times">×${g.members.length}</span>` : "";
    const sec = data.sections.find((s) => s.id === sectionOf(g, data.sections));
    return `<li${star ? ` class="featured" style="--c:${colour(star)};--c-text:${colour(star)}"` : ""}>` +
      (star ? `<span class="new">${esc(data.featuredNote?.[star.id] ?? "New")}</span>` : "") +
      `<h3><a href="/map/?p=${encodeURIComponent(g.id)}">${esc(g.name)}</a>${times}</h3>` +
      `<div class="where">${esc(sec.off ? sec.name : `${sec.name}: ${where(g, park)}`)}</div>` +
      r.serves.map((s) => {
        const p = P(s.id);
        return `<div class="for" style="--c:${colour(p)};--c-text:${colour(p)}"><span class="mark" aria-hidden="true"></span><b>${esc(p.name)}</b>: ${esc(lower(s.line))}</div>`;
      }).join("") +
      `<div class="votes">${voteWords(g.for, g.against)}</div></li>`;
  }).join("");
  $("more").hidden = rows.length <= FIRST;
  $("show-all").textContent = open.offers ? `Show the first ${FIRST}` : `Show all ${rows.length}`;
  return rows.length;
}
const lower = (t) => (/^[A-Z](?:[a-z]| )/.test(t) && !/^(Citi|Metro|Saint|Spherical)/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

function render(subs) {
  if (subs) model = build(subs, park);
  const groups = keep(model.groups, data, who, at);
  const items = keep(model.items, data, who, at);
  drawPicker();
  const whoWords = who.length === data.personas.length ? "walkers, gardeners, kids and everyone else" : and(who.map((id) => plural[id] ?? P(id).name));
  const places = data.sections.filter((s) => at.includes(s.id)).map((s) => (s.off ? "off the ramp" : `at the ${s.name.toLowerCase()}`));
  const atWords = at.length === data.sections.length ? "on and around the ramp" : and(places);
  const n = groups.length;
  $("summary").textContent = !who.length ? "Switch on someone above to see what the map offers them."
    : !at.length ? "Switch on a part of the ramp above."
      : n ? `${n} ${n === 1 ? "proposal serves" : "proposals serve"} ${whoWords} ${atWords}, from ${items.length} ${items.length === 1 ? "drawing" : "drawings"}.`
        : `Nothing on the map serves ${whoWords} ${atWords} yet.`;
  drawTop(groups);
  drawTypes(items);
  drawSquares(items);
  along = alongRamp(model.groups, data, who, at);
  if (win && (win[0] > 0.5 || win[1] < model.m.length - 0.5)) { const keepWin = win; win = null; drawAlong(); win = keepWin; }
  drawAlong();
  drawOffers(model.groups.filter((g) => at.includes(sectionOf(g, data.sections))));
}

let refreshing = false; // one fetch at a time, as the charts do
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    let text = null, error = null;
    for (const src of SOURCES) {
      try {
        const r = await fetch(src, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        text = await r.text();
        break;
      } catch (e) { error = e; }
    }
    if (text === null) throw error;
    const subs = JSON.parse(text);
    if (!Array.isArray(subs)) throw new Error("not a list");
    lastGood = new Date();
    if (text !== lastText) { lastText = text; lastSubs = subs; render(subs); }
    $("status").textContent = `Live. Last checked ${lastGood.toLocaleTimeString("en-US")}; checks every ${REFRESH_S} seconds.`;
    $("status").classList.remove("stale");
  } catch (e) {
    $("status").textContent = lastGood ? `The live data did not answer just now. Showing what it said at ${lastGood.toLocaleTimeString("en-US")}.` : `The live data is not answering (${e.message}). Trying again every ${REFRESH_S} seconds.`;
    $("status").classList.add("stale");
  } finally { refreshing = false; }
}

function set(nextWho, nextAt) {
  who = data.personas.filter((p) => nextWho.includes(p.id)).map((p) => p.id);
  at = data.sections.filter((s) => nextAt.includes(s.id)).map((s) => s.id);
  open.top = open.types = open.offers = false;
  history.replaceState(null, "", formatHash(who, at, data.personas, data.sections) || location.pathname + location.search);
  if (model) render();
  else drawPicker();
}
const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
const fromHash = () => ({ who, where: at } = parseHash(location.hash, data.personas, data.sections, data.aliases));

async function start() {
  [data, park] = await Promise.all([fetch("personas.json").then((r) => r.json()), fetch("charts/park.json").then((r) => r.json())]);
  fromHash();
  drawPicker();
  $("pick").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip?.dataset.who) set(toggle(who, chip.dataset.who), at);
    else if (chip?.dataset.at) set(who, toggle(at, chip.dataset.at));
    else if (e.target.id === "everything") set(data.personas.map((p) => p.id), data.sections.map((s) => s.id));
  });
  for (const key of ["top", "types"]) $(`${key}-all`).addEventListener("click", () => { open[key] = !open[key]; render(); });
  $("show-all").addEventListener("click", () => { open.offers = !open.offers; render(); });
  $("zoom-tools").addEventListener("click", (e) => { if (e.target.id === "zoom-all") { win = null; drawAlong(); } });
  // hover (a mouse) or tap (a finger) names a bubble or a stream
  const chart = $("along");
  chart.addEventListener("pointerover", (e) => { const el = e.target.closest(".b, .st"); if (el && e.pointerType === "mouse") showTip(el, e); });
  chart.addEventListener("pointermove", (e) => { const el = e.target.closest(".b, .st"); if (el && e.pointerType === "mouse") showTip(el, e); });
  chart.addEventListener("pointerout", (e) => { if (e.pointerType === "mouse" && e.target.closest(".b, .st")) $("tip").hidden = true; });
  chart.addEventListener("click", (e) => { const el = e.target.closest(".b, .st"); if (el) showTip(el, e); else $("tip").hidden = true; });
  zoomEvents();
  window.addEventListener("hashchange", () => { fromHash(); if (model) render(); });
  // the theme toggle changes the colors (a lighter one of each on the dark paper)
  new MutationObserver(() => model && render()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  let width = innerWidth;
  addEventListener("resize", () => { if (innerWidth !== width && model) { width = innerWidth; render(); } });
  await refresh();
  setInterval(refresh, REFRESH_S * 1000);
}
start();
