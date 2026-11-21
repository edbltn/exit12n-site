// Where everything in the line chart sits, for a chart `width` pixels wide. No DOM here, so
// `node model.test.mjs` can check that no two bubbles overlap and that each stays near its place.

/** The gap kept between any two bubbles, in pixels. */
export const BUBBLE_PAD = 1.5;
/** How far a bubble may be moved sideways from its own distance along the exit to make room, in pixels: not at
 *  all. Only one that would hang off either end of the page is brought just inside it. */
export const BUBBLE_NUDGE = 0;

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
  return {
    W, narrow, X0, X1, PXM, GAP, x, xb, today, after,
    there: settle(ob.there, today.edge, -1),
    proposed: settle(ob.proposed, after.edge, 1),
    metresPerPixel: m.length / (X1 - X0),
  };
}
