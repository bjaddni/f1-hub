// Dream Grid: a draft game. Pick driver-seasons from random packs, fill five grid slots, get a season record.
// Pure logic (no DOM, no network) so it can be tested and tuned.

/** The five slots on the front of the grid. Better slots count for more, so placement matters. */
export const SLOTS = [
  { label: 'Pole', weight: 1.4 },
  { label: 'P2', weight: 1.2 },
  { label: 'P3', weight: 1.0 },
  { label: 'P4', weight: 0.8 },
  { label: 'P5', weight: 0.6 },
];

export const PACK_SIZE = 4;
export const REROLLS = 2;

// A season that wins 86% of races and takes the title (Verstappen 2023) is the benchmark for a rating of 100.
const TOP_RAW = 0.925;

/**
 * 0-100 rating for one driver's season, judged against their own season so eras compare fairly:
 * 55% how often they won, 45% how close their points were to that year's champion.
 */
export function rateSeason({ wins, races, points }, championPoints) {
  const winRate = races ? wins / races : 0;
  const share = championPoints ? points / championPoints : 0;
  const raw = 0.55 * winRate + 0.45 * share;
  return Math.min(100, Math.round((raw / TOP_RAW) * 100));
}

/** How many of a driver's best seasons in a decade make up that decade's rating. */
export const BEST_SEASONS = 3;
/** A decade card needs at least this many scoring top-10 seasons, so one lucky year doesn't make a card. */
export const MIN_SEASONS = 2;

export const decadeOf = (year) => Math.floor(year / 10) * 10;
/** 2020 -> "'20s", 2000 -> "'00s" */
export const decadeLabel = (decade) => `'${String(decade % 100).padStart(2, '0')}s`;

/** A decade's rating: the average of the driver's best few seasons in it. */
export function rateDecade(seasonRatings) {
  const best = [...seasonRatings].sort((a, b) => b - a).slice(0, BEST_SEASONS);
  return Math.round(best.reduce((a, b) => a + b, 0) / best.length);
}

/**
 * Turn season-result rows ({y, r, id, n, t, c, pos, p, w}) into draftable cards, one per driver per decade.
 * Only scoring top-10 finishes count, and a card needs MIN_SEASONS of them.
 * `currentIds` marks who is on today's grid; everyone else is flagged retired.
 */
export function buildCards(rows, currentIds = new Set()) {
  const champion = new Map();
  for (const row of rows) champion.set(row.y, Math.max(champion.get(row.y) ?? 0, row.p));

  const groups = new Map();
  for (const row of rows) {
    if (row.pos == null || row.pos > 10 || row.p <= 0) continue;
    const key = `${row.id}-${decadeOf(row.y)}`;
    const season = { year: row.y, rating: rateSeason({ wins: row.w, races: row.r, points: row.p }, champion.get(row.y)), team: row.t };
    if (!groups.has(key)) groups.set(key, { key, driverId: row.id, name: row.n, decade: decadeOf(row.y), seasons: [] });
    groups.get(key).seasons.push(season);
  }

  return [...groups.values()]
    .filter((g) => g.seasons.length >= MIN_SEASONS)
    .map((g) => ({
      key: g.key,
      driverId: g.driverId,
      name: g.name,
      decade: g.decade,
      label: decadeLabel(g.decade),
      detail: `${g.seasons.length} seasons`,
      years: g.seasons.length,
      rating: rateDecade(g.seasons.map((s) => s.rating)),
      retired: !currentIds.has(g.driverId),
    }));
}

/**
 * Hard mode deck: one card per driver per *season*, with the car they drove. Same rows, same eligibility
 * (scoring top-10 finish), but no averaging, so a driver's best year and worst year are separate cards.
 */
export function buildSeasonCards(rows, currentIds = new Set()) {
  const champion = new Map();
  for (const row of rows) champion.set(row.y, Math.max(champion.get(row.y) ?? 0, row.p));
  return rows
    .filter((row) => row.pos != null && row.pos <= 10 && row.p > 0)
    .map((row) => ({
      key: `${row.id}-${row.y}`,
      driverId: row.id,
      name: row.n,
      decade: decadeOf(row.y),
      year: row.y,
      label: String(row.y),
      team: row.t,
      teamId: row.c,
      detail: row.t,
      rating: rateSeason({ wins: row.w, races: row.r, points: row.p }, champion.get(row.y)),
      retired: !currentIds.has(row.id),
    }));
}

/**
 * The two ways to play. They use different cards, so they get different record curves
 * (nothing at `low`, a perfect season at `low + span`) and separate personal bests.
 */
export const MODES = {
  normal: {
    id: 'normal',
    name: 'Normal',
    blurb: "Driver-decades, like Hamilton '10s. A card is a driver's best three seasons in that decade, averaged.",
    curve: { low: 40, span: 43, exp: 1.8 },
    build: buildCards,
  },
  hard: {
    id: 'hard',
    name: 'Hard',
    blurb: 'One driver in one single season, with the car. A lot more cards, and a lot more ways to get it wrong.',
    curve: { low: 45, span: 45, exp: 1.6 },
    build: buildSeasonCards,
  },
};

// ---------- randomness ----------

/** Small seeded generator so a "daily draft" gives everyone the same packs. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string -> 32-bit number (cyrb53-style mix, truncated). */
export function hashString(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return (h1 >>> 0) ^ (h2 >>> 0);
}

/**
 * Draw a pack: weighted towards stronger seasons so legends show up now and then,
 * but never two seasons of the same driver, and never a driver already on the team.
 */
export function drawPack(cards, rng, taken = [], size = PACK_SIZE) {
  const blocked = new Set(taken.map((c) => c.driverId));
  let candidates = cards.filter((c) => !blocked.has(c.driverId));
  const pack = [];
  while (pack.length < size && candidates.length) {
    const weights = candidates.map((c) => 1 + (c.rating / 40) ** 2);
    let pick = rng() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < candidates.length - 1 && (pick -= weights[i]) > 0) i++;
    const chosen = candidates[i];
    pack.push(chosen);
    candidates = candidates.filter((c) => c.driverId !== chosen.driverId);
  }
  return pack;
}

// ---------- scoring ----------

/** Weighted average rating of the filled slots (empty slots count as zero). */
export function teamStrength(team) {
  const total = SLOTS.reduce((sum, slot, i) => sum + slot.weight * (team[i]?.rating ?? 0), 0);
  return total / SLOTS.reduce((sum, slot) => sum + slot.weight, 0);
}

/** Wins out of `races` for a team strength: nothing at `low` or below, a perfect season at `low + span`, a steep climb in between. */
export function winsFor(strength, races, curve = MODES.normal.curve) {
  const f = Math.min(Math.max((strength - curve.low) / curve.span, 0), 1) ** curve.exp;
  return Math.round(races * f);
}

export function tierFor(wins, races) {
  const rate = races ? wins / races : 0;
  if (wins === races) return { name: 'Perfect season', emoji: '🏆' };
  if (rate >= 0.85) return { name: 'Dynasty', emoji: '👑' };
  if (rate >= 0.65) return { name: 'Championship team', emoji: '🥇' };
  if (rate >= 0.4) return { name: 'Podium contenders', emoji: '🥈' };
  if (rate >= 0.2) return { name: 'Midfield', emoji: '🔧' };
  return { name: 'Backmarkers', emoji: '🐢' };
}

export function seasonRecord(team, races, mode = 'normal') {
  const strength = teamStrength(team);
  const wins = winsFor(strength, races, MODES[mode].curve);
  return { strength, wins, losses: races - wins, tier: tierFor(wins, races) };
}

/** Plain-text summary for sharing. */
export function shareText(team, record, races, label = 'Dream Grid') {
  const lines = SLOTS.map((slot, i) => `${slot.label}: ${team[i].name} ${team[i].label}${team[i].team ? ` ${team[i].team}` : ''} (${team[i].rating})`);
  return [`${label} ${record.tier.emoji} ${record.wins}-${record.losses} over ${races} races (${record.tier.name})`, ...lines].join('\n');
}
