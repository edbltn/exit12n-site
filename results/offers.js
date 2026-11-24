// What the proposals would offer each kind of park user: the rows the results interactive lists. No DOM here, so
// `node offers.test.mjs` can check it. The personas, their kinds and their "uses" come from personas.json (the personas
// worker's file); the drawings and their votes from the live data, read and grouped by ./charts/model.js.

/** Everyday words for what each kind of proposal is, so it can be matched to the words a persona's "uses" are in.
 *  A kind's own label is matched too; these add what the label does not say (a comfort station is a bathroom). */
export const KIND_WORDS = {
  "fix-dangerous-intersection": "crossing crosswalk signal corner safe slow",
  "add-pedestrian-signal": "signal crossing crosswalk safe",
  "fix-signal-timing": "signal crossing turn ramp",
  "daylight-this-corner": "corner clear crossing crosswalk safe",
  "add-curb-extension": "corner crossing sidewalk curb ramp",
  "add-raised-crosswalk": "crosswalk crossing slow step-free level ramp",
  "add-pedestrian-refuge-island": "crossing crosswalk island",
  "ban-turn-on-red": "turn signal crossing safe",
  "add-intersection-lighting": "lighting lit light lights night",
  "add-protected-bike-lane": "bike lane protected direct apart car-free path",
  "add-traffic-calming": "slow street safe crossing car-free",
  "add-crosswalk": "crosswalk crossing",
  "widen-sidewalk": "sidewalk wide path step-free",
  "lower-speed-limit": "slow street safe",
  "add-tree": "tree shade",
  "add-bus-lane": "bus lane",
  "add-pedestrian-plaza": "plaza open ground car-free",
  "street-redesign": "street signal lane turn ramp crossing",
  "add-bike-lane": "bike lane greenway",
  "add-bike-parking": "bike rack parking",
  "add-citibike-station": "citi bike dock",
  "improve-sidewalk": "sidewalk smooth pavement level path",
  "add-pedestrian-bridge": "path bridge crossing greenway link uninterrupted",
  "improve-accessibility": "step-free ramp accessible level",
  "fix-curb-cut": "curb ramp step-free",
  "add-bench": "bench seat sit",
  "add-bus-shelter": "bus shelter wait seat bench rain",
  "add-tree-lined-street": "tree shade",
  "add-planter-boxes": "planter garden tree bed",
  "add-curb-cut": "curb ramp step-free",
  "add-tactile-paving": "tactile paving",
  "add-audible-pedestrian-signal": "audible signal",
  "extend-crossing-time": "crossing time signal long",
  "add-subway-elevator": "elevator station step-free level",
  "fix-broken-elevator": "elevator station step-free level",
  "add-accessible-parking-space": "accessible parking",
  "clear-sidewalk-obstruction": "clear sidewalk path step-free",
  "fix-broken-sidewalk": "sidewalk smooth pavement level path",
  "food-truck": "food truck cheap vending",
  "add-seating": "seating seat chair table sit",
  "ping-pong-table": "ping-pong table game",
  "skate-park": "skate park",
  "add-a-path": "path loop uninterrupted",
  "create-your-own": "",
  "public-art": "art mural sculpture",
  "rain-garden": "rain garden drain meadow",
  "playground": "playground play climb",
  "market-stalls": "market stall vending",
  "tennis-court": "tennis court",
  "basketball-court": "basketball court",
  "pickleball-court": "pickleball court game",
  "sand-volleyball-court": "sand volleyball court",
  "handball-court": "handball wall court",
  "bocce-court": "bocce game",
  "ring-trek": "ring bar climb",
  "fitness-station": "bar fitness ring loop",
  "swings": "swing playground",
  "climbing-boulder": "boulder climb climbing",
  "chess-tables": "chess game table",
  "spray-shower": "spray shower cool",
  "mini-pitch": "pitch turf field goal",
  "jogging-loop": "loop path uninterrupted",
  "picnic-area": "picnic table",
  "pergola": "shade structure pavilion",
  "shade-sail": "shade structure",
  "scenic-overlook": "overlook view railing",
  "performance-stage": "stage",
  "amphitheater": "stage step steps sit",
  "community-garden": "garden plot",
  "lawn": "lawn open ground",
  "pollinator-meadow": "meadow garden",
  "kayak-launch": "launch dock boat",
  "barbecue-area": "grill",
  "cafe-kiosk": "kiosk coffee food",
  "bike-repair-stand": "repair stand",
  "wayfinding-sign": "sign map",
  "add-stairs": "stair stairs repeat",
  "boardwalk": "boardwalk promenade path pier railing",
  "comfort-station": "bathroom",
  "drinking-fountain": "fountain water",
  "litter-and-recycling-bins": "bin",
  "dog-run": "dog run",
  "granite-blocks": "car-free closed street plaza",
  "clay-tennis-court": "tennis court",
  "remove-tree": "tree",
  "move-tree": "tree",
  "remove-court": "court wall",
  "move-court": "court wall",
  "remove-playground": "playground",
  "move-playground": "playground",
  "remove-plaza": "plaza",
  "move-plaza": "plaza",
  "remove-path": "path loop",
  "move-path": "path loop",
  "remove-road": "car-free street closed",
  "remove-building": "tool shed",
  "ponding-after-rain": "drain",
  "tree-wanted": "tree",
  "tree-not-doing-well": "tree",
  "bathroom-wanted": "bathroom",
  "bathroom-problem": "bathroom",
};

const SKIP = new Set(["the", "and", "for", "with", "add", "fix", "improve", "new", "own", "your", "create", "this", "its", "out", "off", "from", "apart", "station", "open", "street"]); // station, open, street: too generic to match on (a fitness station is no station elevator)
const stem = (w) => w.replace(/ies$/, "y").replace(/(ch|sh|x)es$/, "$1").replace(/([^s])s$/, "$1");
/** The words of a phrase, plain and singular: "Citi Bike docks" is citi, bike, dock. */
export function words(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z\- ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !SKIP.has(w)).map(stem);
}

/** Which of a persona's uses a kind serves: the use that shares the most words with the kind (its label and its
 *  everyday words), the first such in the persona's own order; null when none does. */
export function useFor(persona, kindId, kindLabel) {
  const mine = new Set([...words(kindLabel), ...words(kindId.replace(/-/g, " ")), ...words(KIND_WORDS[kindId])]);
  let best = null;
  for (const use of persona.uses ?? []) {
    const n = words(use).filter((w) => mine.has(w)).length;
    if (n > 0 && (!best || n > best.n)) best = { use, n };
  }
  return best ? best.use : null;
}

/** Kinds a group's personas have a stake in rather than a use for: closing a road to cars gives a cyclist a car-free way and
 *  takes a route from the cab and car drivers merged into the same group (Other). Said plainly rather than as a use. */
export const STAKE = { "remove-road": { other: "A street closed to cars: a car-free way to ride, and one road fewer for cabs and cars" } };

/** One plain line on how a proposal serves a persona. */
export function serveLine(persona, kindId, kindLabel) {
  if (STAKE[kindId]?.[persona.id]) return STAKE[kindId][persona.id];
  if (kindId === "create-your-own") return "A new idea someone drew on the map"; // the catch-all kind: no use to name
  const use = useFor(persona, kindId, kindLabel);
  return use ? cap(use) : `They look for ${(persona.uses ?? []).slice(0, 3).join(", ")}`;
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** The rows for the personas on: every proposal (a group of same-named drawings, as the charts count them) whose kind
 *  serves at least one of them, or that is featured for one of them; each with the personas on that it serves and a line
 *  for each. A featured proposal (`featured`: persona id -> drawing ids) comes first while its persona is on; then the
 *  most net votes, then the most votes for, then the name. */
export function offers(groups, personas, enabled, kinds, featured = {}) {
  const on = personas.filter((p) => enabled.includes(p.id));
  const rows = [];
  for (const g of groups) {
    const ids = new Set((g.members ?? [g]).map((x) => x.id));
    const star = on.filter((p) => (featured[p.id] ?? []).some((id) => ids.has(id)));
    const serves = on.filter((p) => p.kinds.includes(g.typeId) || star.includes(p));
    if (!serves.length) continue;
    const label = kinds[g.typeId]?.label ?? g.typeId;
    rows.push({
      group: g, featured: star.map((p) => p.id),
      // the persona it is featured for first, then the personas' own order
      serves: [...serves].sort((a, b) => star.includes(b) - star.includes(a)).map((p) => ({ id: p.id, name: p.name, line: star.includes(p) && !p.kinds.includes(g.typeId) ? featuredLine(g) : serveLine(p, g.typeId, label) })),
    });
  }
  return rows.sort((a, b) => (b.featured.length > 0) - (a.featured.length > 0) || b.group.net - a.group.net || b.group.for - a.group.for || a.group.name.localeCompare(b.group.name));
}
/** A featured proposal's line: its own note's first sentence, which says what it is for. */
function featuredLine(g) {
  const note = (g.members?.[0]?.note ?? g.note ?? "").split(/(?<=\.)\s/)[0];
  return note || "Proposed for them";
}

/** Votes in words, as the charts write them: "4 for, 2 against"; "no votes yet" when there are none. */
export function voteWords(f, a) {
  return [f ? `${f} for` : "", a ? `${a} against` : ""].filter(Boolean).join(", ") || "no votes yet";
}
