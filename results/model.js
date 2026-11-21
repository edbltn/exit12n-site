// Turn the live Exit 12N submissions into what the three charts draw. No DOM here, so
// `node model.test.mjs` can check it against a saved copy of the data.
//
// Everything that is not a submission comes from park.json, which make_park.py reads out of
// the Exit 12N app's own files: the ramp's centreline, the park's land cover in cross-sections,
// the stops, the type labels and families, and the app's counting rules. "Along the ramp" is the
// app's own measure (57-flatten-the-route): s metres from the parkway end, d metres off it.

/** Distance along the ramp and off it, for the ramp polyline in park.json. */
export function measure(park) {
  const ramp = park.ramp;
  const cum = [0];
  for (let i = 1; i < ramp.length; i++) cum.push(cum[i - 1] + Math.hypot(ramp[i][0] - ramp[i - 1][0], ramp[i][1] - ramp[i - 1][1]));
  const length = cum[cum.length - 1];
  const along = (x, y) => {
    let best = { s: 0, d: 0, dist: Infinity };
    for (let i = 0; i < ramp.length - 1; i++) {
      const [ax, ay] = ramp[i];
      const [bx, by] = ramp[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const dist = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (dist < best.dist) best = { s: cum[i] + t * Math.sqrt(len2), d: Math.sign(dx * (y - ay) - dy * (x - ax)) * dist, dist };
    }
    return { s: best.s, d: best.d };
  };
  const bins = park.rows.length;
  /** The land-cover class of the park cell at (s, d), or -1 outside the park or past the ramp's ends. */
  const cell = (s, d) => {
    if (s <= 0 || s >= length) return -1;
    const row = park.rows[Math.min(bins - 1, Math.floor(s / park.binM))];
    const ch = row[Math.round((d - park.dMin) / park.cellM)];
    return ch === undefined || ch === "." ? -1 : Number(ch);
  };
  return { length, along, cell, bins };
}

function spanAlong(path, m, corridor) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const q = path[i + 1];
    const steps = q ? Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 5)) : 1;
    for (let k = 0; k < steps; k++) {
      const a = m.along(q ? p[0] + ((q[0] - p[0]) * k) / steps : p[0], q ? p[1] + ((q[1] - p[1]) * k) / steps : p[1]);
      if (Math.abs(a.d) <= corridor) {
        lo = Math.min(lo, a.s);
        hi = Math.max(hi, a.s);
      }
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/** What a change proposal's type says, as the app reads it (40-vote-on-proposals/20-describe-a-submission.ts,
 *  changeOf): "remove" or "move" for a type named remove-<kind> or move-<kind> where <kind> is a thing the app
 *  lets people pick (a road is only ever removed, that is, closed to cars); null for every other type. */
export function changeOf(typeId, park) {
  const found = /^(remove|move)-([a-z]+)$/.exec(typeId ?? "");
  if (!found || !park.config.existingKinds.includes(found[2])) return null;
  if (found[1] === "move" && found[2] === "road") return null;
  return found[1];
}

function areaOf(sub) {
  if (sub.kind === "line") return 0;
  return sub.shape === "circle" ? Math.PI * (sub.widthM / 2) ** 2 : sub.widthM * (sub.lengthM ?? sub.widthM);
}

/** One drawing as the charts read it: its name and colour as the app gives them, its place, its votes. */
export function read(sub, park, m) {
  const votesFor = new Set(sub.votes.filter((v) => v.dir > 0).map((v) => v.voterId));
  const votesAgainst = new Set(sub.votes.filter((v) => v.dir < 0).map((v) => v.voterId));
  let at = null;
  let centre = sub.coords[0];
  if (sub.kind === "line") {
    const span = spanAlong(sub.coords, m, park.config.corridorM);
    if (span) at = { s: span[0], s1: span[1] };
    centre = sub.coords[Math.floor(sub.coords.length / 2)];
  } else if (centre) {
    const a = m.along(centre[0], centre[1]);
    if (Math.abs(a.d) <= park.config.corridorM) at = { s: a.s, s1: a.s };
  }
  // a change to a road that is there is named with the road it is about, as the app's data names it
  const road = sub.existing?.kind === "road" ? park.roads[sub.existing.id.split(":").slice(0, 2).join(":")] : null;
  const base = sub.label?.trim() || park.types[sub.typeId] || sub.typeId.replace(/-/g, " ");
  return {
    id: sub.id, typeId: sub.typeId, kind: sub.kind, change: changeOf(sub.typeId, park), name: road ? `${base} (${road})` : base, color: sub.color,
    at, centre, coords: sub.coords, widthM: sub.widthM, areaM2: areaOf(sub), votesFor, votesAgainst,
    for: votesFor.size, against: votesAgainst.size, net: votesFor.size - votesAgainst.size, createdAt: sub.createdAt,
  };
}

/** Same-named drawings whose stretches overlap are one proposal (a point "means here" for reachM either way);
 *  off the route, those within twice that of each other. */
export function group(items, park) {
  const reach = park.config.reachM;
  const byName = new Map();
  for (const it of items) {
    const key = `${it.name.toLowerCase()}|${it.kind}|${it.at ? "on" : "off"}`;
    byName.set(key, [...(byName.get(key) ?? []), it]);
  }
  const out = [];
  const stretch = (it) => (it.kind === "line" ? [it.at.s, it.at.s1] : [it.at.s - reach, it.at.s + reach]);
  const close = (members) => {
    const votesFor = new Set(members.flatMap((x) => [...x.votesFor]));
    const votesAgainst = new Set(members.flatMap((x) => [...x.votesAgainst]));
    const on = members[0].at !== null;
    out.push({
      id: members[0].id, name: members[0].name, kind: members[0].kind, typeId: members[0].typeId, color: members[0].color, members, on,
      s: on ? Math.min(...members.map((x) => x.at.s)) : null,
      s1: on ? Math.max(...members.map((x) => x.at.s1)) : null,
      for: votesFor.size, against: votesAgainst.size, net: votesFor.size - votesAgainst.size,
    });
  };
  for (const [key, list] of byName) {
    if (key.endsWith("|on")) {
      const sorted = [...list].sort((a, b) => stretch(a)[0] - stretch(b)[0]);
      let cur = [];
      let hi = -Infinity;
      for (const it of sorted) {
        const [lo, h] = stretch(it);
        if (cur.length && lo > hi) {
          close(cur);
          cur = [];
          hi = -Infinity;
        }
        cur.push(it);
        hi = Math.max(hi, h);
      }
      if (cur.length) close(cur);
    } else {
      const left = [...list];
      while (left.length) {
        const cur = [left.shift()];
        for (let i = 0; i < cur.length; i++) {
          for (let j = left.length - 1; j >= 0; j--) {
            if (Math.hypot(left[j].centre[0] - cur[i].centre[0], left[j].centre[1] - cur[i].centre[1]) <= 2 * reach) cur.push(...left.splice(j, 1));
          }
        }
        close(cur);
      }
    }
  }
  return out;
}

/** The votes on a thing in words: "4 for, 2 against", leaving out a part that is zero, and nothing when both are.
 *  These are the direct + and - votes the API holds for a drawing: every vote on the server is a direct one
 *  (57-flatten-the-route/README.md: links and conditional votes live in the voter's browser, not in the API). */
export function voteText(votesFor, votesAgainst) {
  return [votesFor ? `${votesFor} for` : "", votesAgainst ? `${votesAgainst} against` : ""].filter(Boolean).join(", ");
}

/** How opaque a proposed thing's bubble is: by its net votes (for minus against, the counts its hover shows).
 *  The highest net among the bubbles shown is fully opaque; a net of 1 or less is the minimum, which still shows
 *  clearly on the bands; in between it rises in a straight line. When nothing shown has a net above 1, every
 *  bubble is at the minimum. */
export const BUBBLE_MIN_OPACITY = 0.3;
export function bubbleOpacity(net, mostNet) {
  if (!(mostNet > 1) || net <= 1) return BUBBLE_MIN_OPACITY;
  return BUBBLE_MIN_OPACITY + (1 - BUBBLE_MIN_OPACITY) * ((Math.min(net, mostNet) - 1) / (mostNet - 1));
}

/** One page of a ranked list: its rows with their ranks, and where it stands. A page past the end is the last. */
export const PAGE_SIZE = 10;
export function pageOf(list, page, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const at = Math.max(0, Math.min(pages - 1, Math.floor(page) || 0));
  const rows = list.slice(at * size, at * size + size).map((item, i) => ({ item, rank: at * size + i + 1 }));
  return { rows, page: at, pages, from: rows.length ? at * size + 1 : 0, to: at * size + rows.length, total: list.length };
}

export function rank(groups) {
  return [...groups].sort((a, b) => b.net - a.net || b.for - a.for || b.members.length - a.members.length || a.name.localeCompare(b.name));
}

function smooth(arr) {
  return arr.map((v, i) => ((arr[i - 1] ?? v) + 2 * v + (arr[i + 1] ?? v)) / 4);
}

/** Which proposals the line chart shows, in the order they claim ground.
 *
 *  `selection` is the final map's own answer (exit12n.org/final/top-proposals.js or its .json snapshot):
 *  `{ rows }`, the rows in placement order. Each row is one drawing as the final map counts it: id, title,
 *  typeId, kind, widthM, coords, areaM2, alongRamp { way, alongM }, votesFor, votesAgainst, score. The chart then
 *  shows exactly those rows in that order, with the row's own title and votes, so a hover reads the same as the
 *  final map. Only the colour is not in a row: it comes from the live drawing of the same id, else from another
 *  drawing of its type, else the app's grey for a type with no family.
 *
 *  With no selection (`null`: the final map is not live, or did not load) the chart shows a stand-in, every
 *  drawing with more people for it than against, most people first, and the page says so. The selection is
 *  never computed here. */
export function select(items, selection, m = null) {
  if (selection && Array.isArray(selection.rows)) {
    const byId = new Map(items.map((i) => [i.id, i]));
    const byType = new Map(items.map((i) => [i.typeId, i.color]));
    const shown = selection.rows.map((row) => {
      const live = byId.get(row.id);
      const coords = Array.isArray(row.coords) && row.coords.length ? row.coords : live?.coords ?? [];
      const kind = row.kind ?? live?.kind;
      const typeId = row.typeId ?? live?.typeId;
      const votesFor = row.votesFor ?? live?.for ?? 0;
      const votesAgainst = row.votesAgainst ?? live?.against ?? 0;
      // the final map measures along two ways; way 1 is the off-ramp, the line drawn here
      const onLine = row.alongRamp && row.alongRamp.way === 1 && Number.isFinite(row.alongRamp.alongM);
      return {
        id: row.id, typeId, kind, change: row.change !== undefined ? row.change : live?.change ?? null, name: row.title ?? live?.name ?? typeId,
        color: live?.color ?? byType.get(typeId) ?? "#9e9e9e",
        coords, centre: kind === "line" ? coords[Math.floor(coords.length / 2)] : coords[0],
        widthM: row.widthM ?? live?.widthM ?? 0, areaM2: row.areaM2 ?? live?.areaM2 ?? 0,
        for: votesFor, against: votesAgainst, net: row.score ?? votesFor - votesAgainst,
        alongM: onLine ? row.alongRamp.alongM : null, way: row.alongRamp?.way ?? null,
        createdAt: row.createdAt ?? live?.createdAt ?? 0,
      };
    });
    return { shown, standIn: false, via: selection.via ?? null, at: selection.at ?? null };
  }
  const shown = items.filter((i) => i.net >= 1).sort((a, b) => b.net - a.net || b.for - a.for || a.createdAt - b.createdAt);
  return { shown, standIn: true, via: null, at: null };
}

/** What the park's own surface classes are called on the page: the app's names, but for two of Eric's words. */
const COVER_NAMES = { none: "other", "leaf-litter": "woods" };

/** The park's width at every section along the ramp, by what covers it: today, and with the shown proposals.
 *
 *  Only paths are bands: a proposal the app draws as a line (kind "line"; the final map's row.kind "line").
 *  Everything the app places as a point (kind "point"), a bench or a rain garden alike, is a bubble and touches
 *  no band. Each path is clipped to the park first: it takes only the park cells it is drawn on, and what is
 *  drawn outside takes nothing. Each takes only what is still free, in the order shown.
 *
 *  A removal (a proposal to take away something that is there: remove-road, remove-tree, ...) is neither a band
 *  nor a bubble. The ground it covers, clipped to the park, turns to grass in the proposed stack, unless a shown
 *  path occupies that ground, in which case the path keeps it. A move is not a removal: it is drawn at its new
 *  spot like any other proposal.
 *
 *  No ground is counted twice, so both stacks add up to the park's full width at every section. */
export function streams(shown, park, m) {
  const K = park.rows[0].length;
  const nc = park.classes.length;
  const cellM2 = park.cellM * park.binM;
  const grass = park.classes.findIndex((c) => c.id === "grass");
  const today = Array.from({ length: nc }, () => new Array(m.bins).fill(0));
  park.rows.forEach((row, b) => {
    for (const ch of row) if (ch !== ".") today[Number(ch)][b] += park.cellM;
  });
  const after = today.map((w) => [...w]);
  const from = Array.from({ length: nc }, () => 0); // m² each class gives up to paths
  const toGrass = Array.from({ length: nc }, () => 0); // m² of each class a removal turns to grass
  const used = new Map(); // cell -> the share of it already spoken for
  const bands = [];
  const taken = new Map(); // drawing id -> m² it took or turned

  /** The park cells a drawing covers, clipped to the park: a path's own cells, or the cells under a thing's
   *  footprint (a disc of its area), nearest first, each with the share of it the drawing covers. */
  const cellsOf = (it) => {
    const out = [];
    if (it.kind === "line") {
      const cells = new Set();
      for (let i = 0; i < it.coords.length - 1; i++) {
        const p = it.coords[i];
        const q = it.coords[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1])));
        for (let j = 0; j <= steps; j++) {
          const a = m.along(p[0] + ((q[0] - p[0]) * j) / steps, p[1] + ((q[1] - p[1]) * j) / steps);
          if (a.s <= 0 || a.s >= m.length) continue;
          const b = Math.min(m.bins - 1, Math.floor(a.s / park.binM));
          const lo = Math.round((a.d - it.widthM / 2 - park.dMin) / park.cellM);
          const hi = Math.max(lo, Math.round((a.d + it.widthM / 2 - park.dMin) / park.cellM) - 1);
          for (let c = Math.max(0, lo); c <= Math.min(K - 1, hi); c++) if (park.rows[b][c] !== ".") cells.add(b * K + c);
        }
      }
      for (const cell of cells) out.push([Math.floor(cell / K), cell % K, 1]);
      return out;
    }
    if (!it.centre) return out;
    const a = m.along(it.centre[0], it.centre[1]);
    const R = Math.sqrt(it.areaM2 / Math.PI);
    let inside = 0;
    let all = 0;
    for (let ds = -Math.ceil(R); ds <= Math.ceil(R); ds++) {
      for (let dd = -Math.ceil(R); dd <= Math.ceil(R); dd++) {
        if (ds * ds + dd * dd > R * R && (ds || dd)) continue;
        all++;
        if (m.cell(a.s + ds, a.d + dd) >= 0) inside++;
      }
    }
    if (!inside) return out; // all of it is outside the park
    const b0 = Math.max(0, Math.min(m.bins - 1, Math.floor(a.s / park.binM)));
    const c0 = Math.round((a.d - park.dMin) / park.cellM);
    const near = [];
    for (let b = Math.max(0, b0 - Math.ceil(R / park.binM) - 2); b <= Math.min(m.bins - 1, b0 + Math.ceil(R / park.binM) + 2); b++) {
      for (let c = Math.max(0, c0 - Math.ceil(R / park.cellM) - 3); c <= Math.min(K - 1, c0 + Math.ceil(R / park.cellM) + 3); c++) {
        if (park.rows[b][c] !== ".") near.push([b === b0 && c === c0 ? 0 : Math.hypot((b + 0.5) * park.binM - a.s, park.dMin + c * park.cellM - a.d), b, c]);
      }
    }
    near.sort((p, q) => p[0] - q[0]);
    let left = (it.areaM2 * inside) / all / cellM2; // the clipped footprint, in cells
    for (const [, b, c] of near) {
      if (left <= 1e-9) break;
      out.push([b, c, Math.min(1, left)]);
      left -= Math.min(1, left);
    }
    return out;
  };
  const free = (b, c, share) => Math.min(1 - (used.get(b * K + c) ?? 0), share);

  // paths first, in the order shown: each takes the free ground it is drawn on
  for (const it of shown) {
    if (it.kind !== "line" || it.change === "remove") continue; // a thing is a bubble only; a removal is handled below
    // one band per path, so a hover shows that path's own votes, as the final map counts them
    const band = { key: it.id, kind: "proposed", shape: it.kind, label: it.name, color: it.color, for: it.for, against: it.against, width: new Array(m.bins).fill(0) };
    bands.push(band);
    for (const [b, c, share] of cellsOf(it)) {
      const got = free(b, c, share);
      if (got <= 0) continue;
      used.set(b * K + c, (used.get(b * K + c) ?? 0) + got);
      const cls = Number(park.rows[b][c]);
      after[cls][b] -= got * park.cellM;
      band.width[b] += got * park.cellM;
      from[cls] += got * cellM2;
      taken.set(it.id, (taken.get(it.id) ?? 0) + got * cellM2);
    }
  }
  // then removals: the ground each covers that no shown path has taken turns to grass
  const removals = [];
  for (const it of shown) {
    if (it.change !== "remove") continue;
    const r = { id: it.id, label: it.name, for: it.for, against: it.against, areaM2: 0, turnedM2: 0, bins: new Set() };
    for (const [b, c, share] of cellsOf(it)) {
      const got = free(b, c, share);
      if (got <= 0) continue;
      used.set(b * K + c, (used.get(b * K + c) ?? 0) + got);
      const cls = Number(park.rows[b][c]);
      r.areaM2 += got * cellM2;
      r.bins.add(b);
      if (cls === grass) continue; // grass it was, grass it stays
      after[cls][b] -= got * park.cellM;
      after[grass][b] += got * park.cellM;
      toGrass[cls] += got * cellM2;
      r.turnedM2 += got * cellM2;
    }
    taken.set(it.id, r.areaM2);
    if (r.areaM2 > 0) removals.push(r);
  }

  const area = (w) => w.reduce((a, v) => a + v, 0) * park.binM;
  const order = park.classes.map((c, i) => i).sort((a, b) => (park.classes[a].id === "none") - (park.classes[b].id === "none") || a - b);
  const cover = (widths) => order.filter((i) => area(today[i]) > 0 || area(widths[i]) > 0).map((i) => ({
    key: park.classes[i].id, kind: "cover", label: COVER_NAMES[park.classes[i].id] ?? park.classes[i].id.replace(/-/g, " "), color: park.classes[i].color,
    width: smooth(widths[i]), areaM2: area(widths[i]), givesM2: from[i], turnedToGrassM2: toGrass[i],
  }));
  const proposed = bands.map((x) => ({ ...x, width: smooth(x.width), areaM2: area(x.width) })).filter((x) => x.areaM2 > 0);
  const total = today.reduce((a, w) => a + area(w), 0);
  const widths = park.rows.map((row) => [...row].filter((ch) => ch !== ".").length * park.cellM);
  return {
    today: cover(today),
    after: [...proposed, ...cover(after)],
    proposed, taken, removals,
    parkAreaM2: total,
    takenM2: proposed.reduce((a, x) => a + x.areaM2, 0),
    turnedToGrassM2: toGrass.reduce((a, v) => a + v, 0),
    widthMin: Math.min(...widths), widthMax: Math.max(...widths),
  };
}

/** The shown things, each at its own distance along the exit (one standing off the park's outline is still
 *  placed by that distance), and what is there today. */
export function objects(shown, park, m) {
  const proposed = [];
  for (const it of shown) {
    if (it.kind !== "point" || !it.centre || it.change === "remove") continue; // a removal is no bubble
    const a = m.along(it.centre[0], it.centre[1]);
    // the final map's own distance along the off-ramp when it gives one; a row measured along the on-ramp (way 0)
    // is placed by the nearest point of the line drawn here instead
    const s = Number.isFinite(it.alongM) ? it.alongM : a.s;
    proposed.push({ ...it, s: Math.max(0, Math.min(m.length, s)), inPark: m.cell(a.s, a.d) >= 0 });
  }
  const there = park.courts.map((c) => ({ name: c.label, color: c.color, areaM2: c.areaM2, s: c.s }));
  return { proposed, there, outside: proposed.filter((o) => !o.inPark).length, mostNet: Math.max(1, ...proposed.map((o) => o.net)) };
}

/** One row per family of proposal types: every drawing in it, and the people behind them. */
export function themes(items, park) {
  const familyOf = new Map(park.families.flatMap((f) => f.types.map((t) => [t, f])));
  const rows = new Map();
  for (const it of items) {
    const f = familyOf.get(it.typeId) ?? { id: "other", label: "Other" };
    const row = rows.get(f.id) ?? { id: f.id, label: f.label, items: [], people: new Set() };
    row.items.push(it);
    for (const v of it.votesFor) row.people.add(v);
    rows.set(f.id, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, people: r.people.size, items: r.items.sort((a, b) => b.net - a.net || a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.people - a.people || b.items.length - a.items.length || a.label.localeCompare(b.label));
}

/** A stretch in words: its metres along the ramp and the nearest stops the app's data names. */
export function where(g, park) {
  if (!g.on) return "off the ramp";
  const near = (s) => park.stops.reduce((a, b) => (Math.abs(b.s - s) < Math.abs(a.s - s) ? b : a)).name;
  const a = Math.round(g.s / 10) * 10;
  const b = Math.round(g.s1 / 10) * 10;
  if (b - a < 30) return `${a} m, near ${near((g.s + g.s1) / 2)}`;
  return near(g.s) === near(g.s1) ? `${a} to ${b} m, near ${near(g.s)}` : `${a} to ${b} m, ${near(g.s)} to ${near(g.s1)}`;
}

/** `selection`: the final map's answer `{ rows, via, at }`, or null for the stand-in (see `select`). */
export function build(subs, park, selection = null) {
  const m = measure(park);
  const items = subs.map((s) => read(s, park, m));
  const groups = group(items, park);
  const voters = new Set(subs.flatMap((s) => s.votes.map((v) => v.voterId)));
  const people = new Set([...voters, ...subs.map((s) => s.authorId)]);
  const chosen = select(items, selection, m);
  return {
    m, items, groups, chosen,
    ranked: rank(groups),
    streams: streams(chosen.shown, park, m),
    objects: objects(chosen.shown, park, m),
    themes: themes(items, park),
    counts: {
      drawings: subs.length,
      votes: subs.reduce((a, s) => a + s.votes.length, 0),
      people: people.size,
      proposals: groups.length,
    },
  };
}
