// Round 11's two views as pure functions (no DOM; `node views.test.mjs` checks them): the rankings (proposals by votes,
// the same merged by type, every drawing as a square shaded by its votes) and the bubbles along the ramp (sized by the
// area each asks for, opacity by votes, the voted paths as streams, a zoom window). Both read what the filters keep.
import { sectionOf } from "./filters.js";

/** Where a drawing or a proposal is, in the terms sectionOf reads: a drawing keeps it in `at`, a proposal on itself. */
const loc = (x) => ("at" in x ? { on: !!x.at, s: x.at?.s, s1: x.at?.s1 } : x);
const ids = (x) => (x.members ? x.members.map((m) => m.id) : [x.id]);

/** The first group on that a drawing or proposal serves (its kinds, or a proposal featured for it); null when none. */
export function groupOf(x, data, who) {
  const on = data.personas.filter((p) => who.includes(p.id));
  const star = on.find((p) => (data.featured?.[p.id] ?? []).some((id) => ids(x).includes(id)));
  return (star ?? on.find((p) => p.kinds.includes(x.typeId)))?.id ?? null;
}

/** What the filters keep: drawings or proposals some group on serves, in a section (or off the ramp) that is on. */
export function keep(list, data, who, at) {
  return list.filter((x) => groupOf(x, data, who) && at.includes(sectionOf(loc(x), data.sections)));
}

/** The drawings merged by type, ranked by votes: the distinct people for (and against) across all of a type's drawings. */
export function byType(items, kinds) {
  const rows = new Map();
  for (const it of items) {
    const r = rows.get(it.typeId) ?? { typeId: it.typeId, label: kinds[it.typeId]?.label ?? it.typeId.replace(/-/g, " "), drawings: 0, pros: new Set(), cons: new Set() };
    r.drawings++;
    for (const v of it.votesFor) r.pros.add(v);
    for (const v of it.votesAgainst) r.cons.add(v);
    rows.set(it.typeId, r);
  }
  return [...rows.values()]
    .map(({ pros, cons, ...r }) => ({ ...r, for: pros.size, against: cons.size, net: pros.size - cons.size }))
    .sort((a, b) => b.for - a.for || b.net - a.net || b.drawings - a.drawings || a.label.localeCompare(b.label));
}

/** The shade step for a number of people for: 0 none, 1, 2, 3, 4 for four or more. */
export const voteStep = (n) => Math.max(0, Math.min(4, n | 0));

/** A bubble's radius: area-true (by the square root of the area), the biggest area at rMax, never below rMin. */
export function radius(area, maxArea, rMax, rMin = 3) {
  return Math.max(rMin, rMax * Math.sqrt(Math.max(0, area) / Math.max(1e-9, maxArea)));
}

/** The zoom window [a, b] along a ramp of length L: inside it, at least minW wide (kept centred when it grows). */
export function clampWindow(a, b, L, minW = 100) {
  if (b < a) [a, b] = [b, a];
  if (b - a >= L) return [0, L];
  if (b - a < minW) { const c = (a + b) / 2; a = c - minW / 2; b = c + minW / 2; }
  const w = b - a;
  if (a < 0) return [0, w];
  if (b > L) return [L - w, L];
  return [a, b];
}

/** What the chart along the ramp draws, from the proposals the filters keep: point proposals on the ramp (not removals)
 *  as bubbles, line proposals on the ramp that someone voted for as streams; each in the colour of the first group on it
 *  serves. `off`: how many kept proposals stand off the ramp (not drawn: they have no place along it). */
export function alongRamp(groups, data, who, at) {
  const kept = keep(groups, data, who, at);
  const dress = (g) => {
    const groupId = groupOf(g, data, who);
    const p = data.personas.find((q) => q.id === groupId);
    const areaM2 = Math.max(...g.members.map((m) => m.areaM2 ?? 0));
    const widthM = Math.max(...g.members.map((m) => m.widthM ?? 0));
    return { ...g, groupId, colour: p.colour, colourDark: p.colourDark, areaM2, widthM, mid: (g.s + g.s1) / 2 };
  };
  return {
    bubbles: kept.filter((g) => g.on && g.kind === "point" && !/^remove-/.test(g.typeId)).map(dress).filter((b) => b.areaM2 > 0),
    streams: kept.filter((g) => g.on && g.kind === "line" && g.for > 0).map(dress),
    off: kept.filter((g) => !g.on).length,
  };
}

/** The ids of the `n` biggest bubbles inside the window [a, b]: these carry their name; the rest name themselves on hover. */
export function labelled(bubbles, a, b, n) {
  return new Set(bubbles.filter((x) => x.mid >= a && x.mid <= b).sort((x, y) => y.areaM2 - x.areaM2 || y.for - x.for).slice(0, n).map((x) => x.id));
}

/** A lane for each stream (0 nearest the line), so streams that overlap along the ramp never share one; most votes first. */
export function lanes(streams) {
  const ends = []; // per lane, where its last stream ends
  const out = new Map();
  for (const s of [...streams].sort((a, b) => b.net - a.net || a.s - b.s)) {
    let k = 0;
    const free = (lane) => !(lane ?? []).some(([x, y]) => !(s.s1 < x || y < s.s));
    while (!free(ends[k])) k++;
    (ends[k] ??= []).push([s.s, s.s1]);
    out.set(s.id, k);
  }
  return out;
}
