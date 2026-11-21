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
    id: sub.id, typeId: sub.typeId, kind: sub.kind, name: road ? `${base} (${road})` : base, color: sub.color,
    at, centre, coords: sub.coords, widthM: sub.widthM, areaM2: areaOf(sub), votesFor, votesAgainst,
    net: votesFor.size - votesAgainst.size, createdAt: sub.createdAt,
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

export function rank(groups) {
  return [...groups].sort((a, b) => b.net - a.net || b.for - a.for || b.members.length - a.members.length || a.name.localeCompare(b.name));
}

function smooth(arr) {
  return arr.map((v, i) => ((arr[i - 1] ?? v) + 2 * v + (arr[i + 1] ?? v)) / 4);
}

/** The park's width at every section along the ramp, by what covers it: today, and once the proposed paths
 *  with more people for than against are laid over it. A path takes the cells it is drawn on, from whatever
 *  is there; where two overlap the one with more people for it keeps the cell. Both stacks add up to the
 *  park's full width at every section. */
export function streams(items, park, m) {
  const K = park.rows[0].length;
  const nc = park.classes.length;
  const today = Array.from({ length: nc }, () => new Array(m.bins).fill(0));
  park.rows.forEach((row, b) => {
    for (const ch of row) if (ch !== ".") today[Number(ch)][b] += park.cellM;
  });

  const lines = items.filter((i) => i.kind === "line" && i.net >= 1).sort((a, b) => a.net - b.net || b.createdAt - a.createdAt);
  const keys = [];
  const claim = new Map(); // cell -> index into keys
  for (const it of lines) {
    const key = `${it.name}|${it.color}`;
    let k = keys.findIndex((x) => x.key === key);
    if (k < 0) k = keys.push({ key, label: it.name, color: it.color, members: [] }) - 1;
    let touched = false;
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
        for (let c = Math.max(0, lo); c <= Math.min(K - 1, hi); c++) {
          if (park.rows[b][c] === ".") continue;
          claim.set(b * K + c, k);
          touched = true;
        }
      }
    }
    if (touched) keys[k].members.push(it);
  }

  const after = today.map((w) => [...w]);
  const taken = keys.map(() => new Array(m.bins).fill(0));
  const from = Array.from({ length: nc }, () => 0); // m² each class gives up
  for (const [id, k] of claim) {
    const b = Math.floor(id / K);
    const cls = Number(park.rows[b][id % K]);
    after[cls][b] -= park.cellM;
    taken[k][b] += park.cellM;
    from[cls] += park.cellM * park.binM;
  }
  const area = (w) => w.reduce((a, v) => a + v, 0) * park.binM;
  const order = park.classes.map((c, i) => i).sort((a, b) => (park.classes[a].id === "none") - (park.classes[b].id === "none") || a - b);
  const cover = (widths) => order.filter((i) => area(today[i]) > 0).map((i) => ({
    key: park.classes[i].id, kind: "cover", label: park.classes[i].id === "none" ? "other" : park.classes[i].id.replace(/-/g, " "), color: park.classes[i].color,
    width: smooth(widths[i]), areaM2: area(widths[i]), givesM2: from[i],
  }));
  const proposed = keys
    .map((x, k) => {
      const people = new Set(x.members.flatMap((i) => [...i.votesFor]));
      return { key: x.key, kind: "proposed", label: x.label, color: x.color, width: smooth(taken[k]), areaM2: area(taken[k]), people: people.size, drawings: x.members.length };
    })
    .filter((p) => p.areaM2 > 0)
    .sort((a, b) => b.people - a.people || b.areaM2 - a.areaM2);
  const total = today.reduce((a, w) => a + area(w), 0);
  const widths = park.rows.map((row) => [...row].filter((ch) => ch !== ".").length * park.cellM);
  return {
    today: cover(today),
    after: [...proposed, ...cover(after)],
    proposed,
    parkAreaM2: total,
    takenM2: proposed.reduce((a, p) => a + p.areaM2, 0),
    widthMin: Math.min(...widths), widthMax: Math.max(...widths),
  };
}

/** The proposed things that stand in the park, each with the stretch of ramp (one of the app's blocks) it belongs to. */
export function objects(items, park, m) {
  const block = (s) => Math.min(park.config.blockCount - 1, Math.floor((s / m.length) * park.config.blockCount));
  const proposed = [];
  let outside = 0;
  for (const it of items) {
    if (it.kind !== "point" || !it.centre) continue;
    const a = m.along(it.centre[0], it.centre[1]);
    if (m.cell(a.s, a.d) < 0) {
      outside++;
      continue;
    }
    proposed.push({ ...it, s: a.s, block: block(a.s), for: it.votesFor.size, against: it.votesAgainst.size });
  }
  const there = park.courts.map((c) => ({ name: c.label, color: c.color, areaM2: c.areaM2, s: c.s, block: block(c.s) }));
  return { proposed, there, outside, mostNet: Math.max(1, ...proposed.map((p) => p.net)) };
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

export function build(subs, park) {
  const m = measure(park);
  const items = subs.map((s) => read(s, park, m));
  const groups = group(items, park);
  const voters = new Set(subs.flatMap((s) => s.votes.map((v) => v.voterId)));
  const people = new Set([...voters, ...subs.map((s) => s.authorId)]);
  return {
    m, items, groups,
    ranked: rank(groups),
    streams: streams(items, park, m),
    objects: objects(items, park, m),
    themes: themes(items, park),
    counts: {
      drawings: subs.length,
      votes: subs.reduce((a, s) => a + s.votes.length, 0),
      people: people.size,
      proposals: groups.length,
    },
  };
}
