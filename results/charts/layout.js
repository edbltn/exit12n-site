// Where everything in the line chart sits, for a chart `width` pixels wide. No DOM here, so
// `node model.test.mjs` can check that no two bubbles overlap and that each stays near its place.

/** How far below the Proposed bands the bubbles may reach, in pixels: the room the chart gives them. The circles are drawn
 *  as large as this allows (Eric via coding-shepherd, 2026-11-23: "as large as the layout allows at phone width without
 *  overlap"), all enlarged by the same factor so their areas stay in proportion to their footprints. */
export const BUBBLE_ZONE = (narrow) => (narrow ? 170 : 220);
/** The factors tried, largest first, and the smallest circle drawn, in pixels. */
export const K_STEPS = [8, 6, 5, 4, 3, 2.5, 2, 1.5, 1];
export const MIN_R = (narrow) => (narrow ? 8 : 10);

/** The gap kept between any two bubbles, in pixels. */
export const BUBBLE_PAD = 1.5;
/** How far a bubble may be moved sideways from its own distance along the exit to make room, in pixels: not at
 *  all. Only one that would hang off either end of the page is brought just inside it. */
export const BUBBLE_NUDGE = 0;

/** How close two proposals of the same name must stand along the exit to merge, in metres: the app's own reach
 *  for a point (park.config.reachM, 40 m), the distance its shortlist already uses for same-named points. */
export const MERGE_M = (park) => park.config.reachM;
/** The colour of a merged bubble whose members are of different types: the app's grey for a type with no family. */
export const MIXED_COLOR = "#9e9e9e";

const nameKey = (o) => String(o.name ?? "").trim().toLowerCase();

/** Light merging of bubbles (Eric, 2026-11-22, ts 1795361234.573059): only proposals with the same name merge, never
 *  two with different names, even of one type or colour. Within each name, things are taken in order along the exit,
 *  and one nearer than `mergeM` metres to the last one joins its bubble, so a chain of near neighbours is one bubble.
 *  The same on every screen width. A merged bubble's area is the sum of its members' footprints, its place their
 *  footprint-weighted mean distance along the exit, its votes the sums of theirs; its colour is theirs if they are
 *  all of one type, else grey. Members are listed most wanted first (net votes), then by id. A bubble of one is that
 *  thing unchanged. Nothing is random, and the order given does not matter. */
export function mergeBubbles(things, mergeM) {
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byName = new Map();
  for (const o of things) byName.set(nameKey(o), [...(byName.get(nameKey(o)) ?? []), o]);
  const stacks = [];
  for (const key of [...byName.keys()].sort()) {
    const along = [...byName.get(key)].sort((a, b) => a.s - b.s || byId(a, b));
    let cur = [];
    for (const o of along) {
      if (cur.length && o.s - cur[cur.length - 1].s >= mergeM) {
        stacks.push(cur);
        cur = [];
      }
      cur.push(o);
    }
    if (cur.length) stacks.push(cur);
  }
  const merged = stacks.map((stack) => {
    const members = [...stack].sort((a, b) => b.net - a.net || byId(a, b));
    if (members.length === 1) return { ...members[0], members };
    const areaM2 = members.reduce((t, o) => t + o.areaM2, 0);
    const votesFor = members.reduce((t, o) => t + o.for, 0);
    const votesAgainst = members.reduce((t, o) => t + o.against, 0);
    const oneType = members.every((o) => o.typeId === members[0].typeId && o.color === members[0].color);
    return {
      id: members.map((o) => o.id).join("+"), members, areaM2,
      s: areaM2 > 0 ? members.reduce((t, o) => t + o.s * o.areaM2, 0) / areaM2 : members.reduce((t, o) => t + o.s, 0) / members.length,
      for: votesFor, against: votesAgainst, net: votesFor - votesAgainst,
      color: oneType ? members[0].color : MIXED_COLOR,
      name: `${members.length} proposals, ${String(members[0].name ?? "").trim()}`,
      inPark: members.every((o) => o.inPark),
    };
  });
  return merged.sort((a, b) => a.s - b.s || byId(a, b));
}

/** A beeswarm constrained on x: each circle keeps its own x, and y is free. Circles are set largest first. Each
 *  starts just clear of the bands at its x (`rest(x, r)`), and where that spot is taken it moves outward (`dir`
 *  1 down, -1 up), never back toward the line, to the nearest free spot. No two circles end closer than their
 *  radii plus BUBBLE_PAD. The same circles always give the same layout: nothing is random. */
export function beeswarm(circles, rest, dir, lo, hi) {
  const placed = [];
  const order = circles.map((c, i) => i).sort((a, b) => circles[b].r - circles[a].r || circles[a].x - circles[b].x || a - b);
  for (const i of order) {
    const { r } = circles[i];
    const home = Math.max(lo + r + 1, Math.min(hi - r - 1, circles[i].x));
    let best = null;
    for (let step = 0; step <= BUBBLE_NUDGE; step += 1) {
      for (const dx of step === 0 ? [0] : [-step, step]) {
        const x = home + dx;
        if (x - r < lo || x + r > hi) continue;
        const y0 = rest(x, r);
        let y = y0;
        for (let moved = true; moved; ) {
          moved = false;
          for (const q of placed) {
            const reach = r + q.r + BUBBLE_PAD;
            const ax = Math.abs(x - q.x);
            if (ax >= reach) continue;
            const h = Math.sqrt(reach * reach - ax * ax);
            if (Math.abs(y - q.y) < h - 1e-9) {
              y = q.y + dir * h; // just clear of it, on the outward side
              moved = true;
            }
          }
        }
        const cost = Math.abs(y - y0) + 1.5 * Math.abs(dx);
        if (!best || cost < best.cost - 1e-9) best = { x, y, cost };
      }
    }
    placed.push({ i, x: best.x, y: best.y, r, home });
  }
  return placed.sort((a, b) => a.i - b.i);
}

/** A distance along the exit as a station, the way a road's centreline is measured: kilometres + metres from its
 *  start, the metres in three figures. 0 m is 0+000, 463 m is 0+463, 1,234 m is 1+234. */
export function station(metres) {
  const whole = Math.max(0, Math.round(metres));
  return `${Math.floor(whole / 1000)}+${String(whole % 1000).padStart(3, "0")}`;
}

/** The ticks of the two axes, in metres, on the scales the chart already uses.
 *  X: distance along the exit, from 0 at its start to its full length at the far end, a tick every `step` metres
 *  (100 on a wide chart, 200 on a narrow one) and one at the end; a round tick too close to the end to be read
 *  beside it is left out. Y: metres across the park, out from the line both ways, a tick every 50 m as far as the
 *  park is wide; only on a wide chart, where there is a margin to hold it. */
/** The ranges the Proposed side's scale can take, in metres out from the line: the smallest that holds every proposal. */
export const BELOW_RANGES = [10, 20, 25, 50, 75, 100, 150, 200];

export function axisTicks(length, widthMax, x, PXM, GAP, narrow, rangeBelow = widthMax, PXMB = PXM) {
  const step = narrow ? 200 : 100;
  const end = Math.round(length);
  const minGap = 46; // pixels a label needs
  const xs = [];
  // along the exit the labels are stations (0+000 at the start); across it, plain metres of offset from the line
  for (let s = 0; s < length; s += step) if (x(length) - x(s) >= minGap) xs.push({ s, x: x(s), label: station(s) });
  xs.push({ s: length, x: x(length), label: station(end) });
  const ys = [];
  if (!narrow) {
    // Today: every 50 m across the park; Proposed, on its own scale, at a step that fits its range
    for (let w = 50; w <= widthMax; w += 50) ys.push({ m: w, dir: -1, y: -(GAP + w * PXM), label: `${w} m` });
    const step = rangeBelow <= 20 ? 5 : rangeBelow <= 50 ? 10 : rangeBelow <= 100 ? 25 : 50;
    for (let w = step; w <= rangeBelow + 1e-9; w += step) ys.push({ m: w, dir: 1, y: GAP + w * PXMB, label: `${w} m` });
  }
  return { x: xs, y: ys, step };
}

/** The whole chart's geometry, with the line at y = 0: today above (negative y), proposed below. */
export function layoutLine(model, park, width) {
  const st = model.streams;
  const ob = model.objects;
  const m = model.m;
  const W = Math.max(300, width);
  const narrow = W < 720;
  const X0 = narrow ? 8 : 74;
  const X1 = W - (narrow ? 8 : 14);
  const x = (s) => X0 + (s / m.length) * (X1 - X0);
  const xb = (b) => x(Math.min(m.length, (b + 0.5) * park.binM));
  const HALF = narrow ? 120 : 170; // pixels from the line to the outer edge of each side's scale
  const PXM = HALF / st.widthMax; // Today: pixels per metre across, the park's full width; bubbles keep this scale
  // Proposed shows only the proposals, so it gets its own, wider scale: the smallest round range that holds the
  // tallest stack of them (Eric, 2026-11-22 11:47: "widen the scale in Proposed so everything that was proposed fits")
  const below = st.below ?? [];
  const tallest = Math.max(0, ...Array.from({ length: m.bins }, (_, b) => below.reduce((t, s) => t + s.width[b], 0)));
  const rangeBelow = BELOW_RANGES.find((r) => r >= tallest) ?? Math.ceil(tallest / 50) * 50;
  const PXMB = HALF / rangeBelow;
  const GAP = 8;

  /** Stack bands outward from the line: each band's near and far edge at every section, and the outer edge. */
  const stack = (bands, dir, pxm) => {
    let base = Array.from({ length: m.bins }, () => dir * GAP);
    const drawn = bands.map((s) => {
      const near = base;
      base = base.map((y, b) => y + dir * s.width[b] * pxm);
      return { band: s, near, far: base };
    });
    return { drawn, edge: base };
  };
  const today = stack(st.today, -1, PXM);
  const after = stack(below, 1, PXMB);

  // the outer edge of the bands at a pixel x, read between the sections either side
  const edgeAt = (edge) => (px) => {
    const f = ((px - X0) / (X1 - X0)) * (m.length / park.binM) - 0.5;
    const b = Math.max(0, Math.min(m.bins - 1, Math.floor(f)));
    const t = Math.max(0, Math.min(1, f - b));
    return edge[b] + (edge[Math.min(m.bins - 1, b + 1)] - edge[b]) * t;
  };
  const settle = (list, edge, dir, R = (a) => Math.max(3, PXM * Math.sqrt(a / Math.PI))) => {
    const at = edgeAt(edge);
    // a bubble starts clear of the bands across its whole width, so it never covers them
    const clear = (px, r) => {
      let far = -Infinity;
      for (let k = -r; k <= r; k += 2) far = Math.max(far, dir * at(px + k));
      // and every section's own centre under it: on the Proposed side's wider scale an edge can rise steeply between samples
      for (let b = 0; b < m.bins; b++) if (Math.abs(xb(b) - px) <= r) far = Math.max(far, dir * edge[b]);
      return dir * (Math.max(far, dir * at(px + r)) + r + 3);
    };
    const circles = list.map((o) => ({ x: x(o.s), r: R(o.areaM2) }));
    // on a wide chart the side axis fills the margin left of X0: no circle is set over it
    return beeswarm(circles, clear, dir, narrow ? 0 : X0 - 8, W).map((c) => ({ o: list[c.i], cx: c.x, cy: c.y, r: c.r, home: x(list[c.i].s) }));
  };
  // nearby proposed things of the same name merge before they are laid out
  const merged = mergeBubbles(ob.proposed, MERGE_M(park));
  // the proposed things are drawn as large as the zone below the bands allows: the largest factor that fits
  const edgeMax = Math.max(0, ...after.edge);
  const tryK = (k) => {
    const laid = settle(merged, after.edge, 1, (a) => Math.max(MIN_R(narrow), k * PXM * Math.sqrt(a / Math.PI)));
    return { laid, bottom: Math.max(edgeMax, ...laid.map((c) => c.cy + c.r)) };
  };
  let k = 1;
  let proposed = null;
  for (const step of K_STEPS) {
    const t = tryK(step);
    if (t.bottom - edgeMax <= BUBBLE_ZONE(narrow) || step === 1) {
      k = step;
      proposed = t.laid;
      break;
    }
  }
  return {
    k, kMax: K_STEPS[0], kSteps: K_STEPS, tryK,
    W, narrow, X0, X1, PXM, PXMB, GAP, x, xb, today, after,
    there: settle(ob.there, today.edge, -1),
    proposed,
    mostNet: Math.max(1, ...merged.map((o) => o.net)),
    axes: axisTicks(m.length, st.widthMax, x, PXM, GAP, narrow, rangeBelow, PXMB),
    half: HALF, rangeBelow,
    metresPerPixel: m.length / (X1 - X0),
  };
}
