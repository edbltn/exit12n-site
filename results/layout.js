// Where everything in the line chart sits, for a chart `width` pixels wide. No DOM here, so
// `node model.test.mjs` can check that no two bubbles overlap and that each stays near its place.

/** The gap kept between any two bubbles, in pixels. */
export const BUBBLE_PAD = 1.5;
/** How far a bubble may be moved sideways from its own distance along the exit to make room, in pixels: not at
 *  all. Only one that would hang off either end of the page is brought just inside it. */
export const BUBBLE_NUDGE = 0;

/** How close two bubbles must stand along the exit to merge: their centres nearer than this share of the sum of
 *  their radii. The editor's pins merge when their heads would overlap (a share of 1); here a quarter of that, so
 *  only near neighbours merge and most bubbles stay single. */
export const MERGE_SHARE = 0.25;
/** The colour of a merged bubble whose members are of different types: the app's grey for a type with no family. */
export const MIXED_COLOR = "#9e9e9e";

/** Light merging of nearby bubbles, the way the editor merges its pins. Things are stood in a fixed order, the most
 *  wanted first (net votes), then by id. One that stands close to a bubble already standing (MERGE_SHARE) joins it;
 *  the first it is close to, of any type. `xOf` and `rOf` give a thing's place and radius in pixels, so a narrower
 *  chart merges more, as zooming out does. A merged bubble's area is the sum of its members' footprints, its place
 *  their footprint-weighted mean distance along the exit, its votes the sums of theirs; its colour is theirs if they
 *  are all of one type, else grey. A bubble of one is that thing unchanged. Nothing is random. */
export function mergeBubbles(things, xOf, rOf) {
  const order = [...things].sort((a, b) => b.net - a.net || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const stacks = [];
  for (const o of order) {
    const lead = stacks.find((k) => Math.abs(xOf(k[0]) - xOf(o)) < MERGE_SHARE * (rOf(k[0]) + rOf(o)));
    if (lead) lead.push(o);
    else stacks.push([o]);
  }
  return stacks.map((members) => {
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
      name: `${members.length} proposals: ${members.map((o) => o.name).join(", ")}`,
      inPark: members.every((o) => o.inPark),
    };
  });
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
export function axisTicks(length, widthMax, x, PXM, GAP, narrow) {
  const step = narrow ? 200 : 100;
  const end = Math.round(length);
  const minGap = 46; // pixels a label needs
  const xs = [];
  // along the exit the labels are stations (0+000 at the start); across it, plain metres of offset from the line
  for (let s = 0; s < length; s += step) if (x(length) - x(s) >= minGap) xs.push({ s, x: x(s), label: station(s) });
  xs.push({ s: length, x: x(length), label: station(end) });
  const ys = [];
  if (!narrow) for (let w = 50; w <= widthMax; w += 50) for (const dir of [-1, 1]) ys.push({ m: w, dir, y: dir * (GAP + w * PXM), label: `${w} m` });
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
  const PXM = (narrow ? 120 : 170) / st.widthMax; // pixels per metre across, the same for bands and bubbles
  const R = (a) => Math.max(3, PXM * Math.sqrt(a / Math.PI));
  const GAP = 8;

  /** Stack bands outward from the line: each band's near and far edge at every section, and the outer edge. */
  const stack = (bands, dir) => {
    let base = Array.from({ length: m.bins }, () => dir * GAP);
    const drawn = bands.map((s) => {
      const near = base;
      base = base.map((y, b) => y + dir * s.width[b] * PXM);
      return { band: s, near, far: base };
    });
    return { drawn, edge: base };
  };
  const today = stack(st.today, -1);
  const after = stack(st.after, 1);

  // the outer edge of the bands at a pixel x, read between the sections either side
  const edgeAt = (edge) => (px) => {
    const f = ((px - X0) / (X1 - X0)) * (m.length / park.binM) - 0.5;
    const b = Math.max(0, Math.min(m.bins - 1, Math.floor(f)));
    const t = Math.max(0, Math.min(1, f - b));
    return edge[b] + (edge[Math.min(m.bins - 1, b + 1)] - edge[b]) * t;
  };
  const settle = (list, edge, dir) => {
    const at = edgeAt(edge);
    // a bubble starts clear of the bands across its whole width, so it never covers them
    const clear = (px, r) => {
      let far = -Infinity;
      for (let k = -r; k <= r; k += 2) far = Math.max(far, dir * at(px + k));
      return dir * (Math.max(far, dir * at(px + r)) + r + 3);
    };
    const circles = list.map((o) => ({ x: x(o.s), r: R(o.areaM2) }));
    return beeswarm(circles, clear, dir, 0, W).map((c) => ({ o: list[c.i], cx: c.x, cy: c.y, r: c.r, home: x(list[c.i].s) }));
  };
  // nearby proposed things merge lightly, like the editor's pins, before they are laid out
  const merged = mergeBubbles(ob.proposed, (o) => x(o.s), (o) => R(o.areaM2));
  return {
    W, narrow, X0, X1, PXM, GAP, x, xb, today, after,
    there: settle(ob.there, today.edge, -1),
    proposed: settle(merged, after.edge, 1),
    mostNet: Math.max(1, ...merged.map((o) => o.net)),
    axes: axisTicks(m.length, st.widthMax, x, PXM, GAP, narrow),
    half: st.widthMax * PXM,
    metresPerPixel: m.length / (X1 - X0),
  };
}
