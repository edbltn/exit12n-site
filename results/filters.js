// The results page's two filters, with no DOM so `node results.test.mjs` can check them: who (the four groups) and where
// (the ramp's four sections along its line), and the address that keeps both (#for=...&in=...; everything on when absent).

/** The ramp's sections, from the stops park.json names along the centreline (metres from the Henry Hudson Parkway end):
 *  south end, the parkway end up to the rise; mid-ramp, the rise and Pollinator Meadow up to half way to the crest;
 *  crest, from there to half way down to the descent; north end, the descent down to Saint Clair Place. */
export function makeSections(stops) {
  const at = (name) => { const p = stops.find((q) => q.name === name); if (!p) throw new Error(`no stop ${name}`); return p.s; };
  const end = stops.at(-1).s;
  const round = (s) => Math.round(s * 10) / 10;
  const a = at("the rise"), b = round((at("Pollinator Meadow") + at("the crest")) / 2), c = round((at("the crest") + at("the descent")) / 2);
  return [
    { id: "south-end", name: "South end", long: "South end, by the Henry Hudson Parkway", s0: 0, s1: a },
    { id: "mid-ramp", name: "Mid-ramp", long: "Mid-ramp, the rise and Pollinator Meadow", s0: a, s1: b },
    { id: "crest", name: "Crest", long: "Crest, the high point", s0: b, s1: c },
    { id: "north-end", name: "North end", long: "North end, at Saint Clair Place", s0: c, s1: end },
    // drawings the map places off the ramp (the river, Riverside Drive, the parkway) have no place along it: their own toggle
    { id: "off-ramp", name: "Off the ramp", long: "Off the ramp: the river, Riverside Drive, the parkway", off: true },
  ];
}

/** The section a proposal sits in: the one holding the middle of its stretch along the ramp (past either end counts in
 *  the end section); one off the ramp counts as off the ramp. */
export function sectionOf(g, sections) {
  if (g.on === false) return "off-ramp";
  const m = ((g.s ?? 0) + (g.s1 ?? g.s ?? 0)) / 2;
  const along = sections.filter((x) => !x.off);
  return (along.find((x) => m < x.s1) ?? along.at(-1)).id;
}

const part = (hash, key) => { const m = new RegExp(`(?:^#|&)${key}=([^&]*)`).exec(hash ?? ""); return m ? m[1].split(",") : null; };
/** Who and where from the address. Absent or unknown means all on; "none" means none; an old persona id (a link from the
 *  50-persona page) lands on its group. */
export function parseHash(hash, personas, sections, aliases = {}) {
  const pick = (named, list) => {
    if (!named) return list.map((x) => x.id);
    if (named[0] === "none") return [];
    const ids = new Set(named.map((id) => aliases[id] ?? id));
    const got = list.filter((x) => ids.has(x.id)).map((x) => x.id);
    return got.length ? got : list.map((x) => x.id);
  };
  return { who: pick(part(hash, "for"), personas), where: pick(part(hash, "in"), sections) };
}

/** The address for what is on: a part only when not everything in it is on; "" when all is on. */
export function formatHash(who, where, personas, sections) {
  const one = (key, on, list) => (on.length === list.length ? "" : `${key}=${on.length ? list.filter((x) => on.includes(x.id)).map((x) => x.id).join(",") : "none"}`);
  const parts = [one("for", who, personas), one("in", where, sections)].filter(Boolean);
  return parts.length ? `#${parts.join("&")}` : "";
}
