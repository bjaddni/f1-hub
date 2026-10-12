// Pure helpers for driver-at-track history. No DOM, no network.

// Regulation eras ("car generations"). Results before 1994 are deliberately left out.
export const ERAS = [
  { id: '1994-2008', label: '1994–2008', from: 1994, to: 2008, caption: 'V10 / V8' },
  { id: '2009-2013', label: '2009–2013', from: 2009, to: 2013, caption: 'V8 · KERS · DRS' },
  { id: '2014-2021', label: '2014–2021', from: 2014, to: 2021, caption: 'Turbo-hybrid' },
  { id: '2022-2025', label: '2022–2025', from: 2022, to: 2025, caption: 'Ground effect' },
  { id: '2026+', label: '2026+', from: 2026, to: Infinity, caption: 'New regulations' },
];

export function eraOf(year) {
  return ERAS.find((e) => year >= e.from && year <= e.to) ?? null;
}

/** One race result as a plain row. `quali` is the qualifying position, or null when Jolpica has none for that race. */
function toRow(race, r, quali = null) {
  const year = Number(race.season);
  return {
    year,
    round: Number(race.round),
    raceName: race.raceName,
    circuitId: race.Circuit.circuitId,
    driverId: r.Driver?.driverId ?? null,
    driverName: r.Driver ? `${r.Driver.givenName} ${r.Driver.familyName}` : null,
    team: r.Constructor.name,
    teamId: r.Constructor.constructorId,
    quali,
    grid: Number(r.grid) || null, // 0 means pit-lane start
    position: /^\d+$/.test(r.positionText) ? Number(r.position) : null, // null = retired / DSQ / not classified
    status: r.status,
    points: Number(r.points),
    era: eraOf(year)?.id ?? null,
  };
}

/** Qualifying positions keyed by season-round-driver, from RaceTable.Races of a qualifying query. */
function qualiLookup(qualiRaces) {
  const lookup = new Map();
  for (const race of qualiRaces) {
    for (const q of race.QualifyingResults ?? []) {
      const pos = Number(q.position);
      if (pos) lookup.set(`${race.season}-${race.round}-${q.Driver.driverId}`, pos);
    }
  }
  return lookup;
}

/** Flatten Jolpica's RaceTable.Races (one driver's results) into plain rows, dropping pre-1994 seasons. */
export function parseResults(races, qualiRaces = []) {
  const quali = qualiLookup(qualiRaces);
  return races
    .map((race) => {
      const r = race.Results?.[0];
      return r ? toRow(race, r, quali.get(`${race.season}-${race.round}-${r.Driver?.driverId}`) ?? null) : null;
    })
    .filter((row) => row && row.era);
}

/** Every driver's result at one circuit (RaceTable.Races of a circuit query), one row per driver per race. */
export function parseCircuitResults(races) {
  return races.flatMap((race) => (race.Results ?? []).map((r) => toRow(race, r))).filter((row) => row.era);
}

/** Pages of a result query can cut a race in half; stitch the halves back together by season and round. */
export function mergeRacePages(pages, listKey = 'Results') {
  const merged = new Map();
  for (const race of pages.flatMap((p) => p)) {
    const key = `${race.season}-${race.round}`;
    const seen = merged.get(key);
    if (seen) seen[listKey] = [...(seen[listKey] ?? []), ...(race[listKey] ?? [])];
    else merged.set(key, { ...race, [listKey]: [...(race[listKey] ?? [])] });
  }
  return [...merged.values()];
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Headline numbers for a set of rows (all of one driver's starts in some slice). */
export function summarize(rows) {
  const finishes = rows.map((r) => r.position).filter((p) => p != null);
  return {
    starts: rows.length,
    wins: finishes.filter((p) => p === 1).length,
    podiums: finishes.filter((p) => p <= 3).length,
    best: finishes.length ? Math.min(...finishes) : null,
    avgFinish: mean(finishes),
    avgGrid: mean(rows.map((r) => r.grid).filter((g) => g != null)),
    poles: rows.filter((r) => r.quali === 1).length,
    avgQuali: mean(rows.map((r) => r.quali).filter((q) => q != null)),
    dnfs: rows.filter((r) => r.position == null).length,
    points: rows.reduce((sum, r) => sum + r.points, 0),
  };
}

/** { [eraId]: rows[] } with every era present, so tables always have all columns. */
export function groupByEra(rows) {
  const out = Object.fromEntries(ERAS.map((e) => [e.id, []]));
  for (const row of rows) out[row.era].push(row);
  return out;
}

/** For each given circuit: its rows split by era, plus a summary per era. */
export function trackMatrix(rows, circuits) {
  return circuits.map((circuit) => {
    const atTrack = rows.filter((r) => r.circuitId === circuit.circuitId).sort((a, b) => a.year - b.year);
    const byEra = groupByEra(atTrack);
    return {
      circuit,
      rows: atTrack,
      all: summarize(atTrack),
      eras: Object.fromEntries(ERAS.map((e) => [e.id, { rows: byEra[e.id], ...summarize(byEra[e.id]) }])),
    };
  });
}

// ---------- head-to-head ----------

/** Who was ahead at the flag: a classified finisher beats a retirement; two retirements settle nothing. */
function finishWinner(a, b) {
  if (a.position != null && b.position != null) return a.position === b.position ? null : a.position < b.position ? 'a' : 'b';
  if (a.position != null) return 'a';
  if (b.position != null) return 'b';
  return null;
}

/** Lower is better for qualifying and grid positions; unknown or equal settles nothing. */
function lowerWins(x, y) {
  if (x == null || y == null || x === y) return null;
  return x < y ? 'a' : 'b';
}

/** Races both drivers started, oldest first, each with who finished and who started ahead. */
export function sharedRaces(rowsA, rowsB) {
  const key = (r) => `${r.year}-${r.round}`;
  const byRace = new Map(rowsB.map((r) => [key(r), r]));
  return rowsA
    .filter((a) => byRace.has(key(a)))
    .map((a) => {
      const b = byRace.get(key(a));
      return {
        year: a.year,
        round: a.round,
        raceName: a.raceName,
        circuitId: a.circuitId,
        era: a.era,
        a,
        b,
        teammates: a.teamId === b.teamId,
        finishAhead: finishWinner(a, b),
        gridAhead: lowerWins(a.grid, b.grid),
        qualiAhead: lowerWins(a.quali, b.quali),
      };
    })
    .sort((x, y) => x.year - y.year || x.round - y.round);
}

/** Tallies for a set of shared races. Averages cover the same races for both drivers. */
export function summarizeH2H(entries) {
  const count = (field, who) => entries.filter((e) => e[field] === who).length;
  const a = summarize(entries.map((e) => e.a));
  const b = summarize(entries.map((e) => e.b));
  return {
    shared: entries.length,
    teammates: entries.filter((e) => e.teammates).length,
    finishA: count('finishAhead', 'a'),
    finishB: count('finishAhead', 'b'),
    gridA: count('gridAhead', 'a'),
    gridB: count('gridAhead', 'b'),
    qualiA: count('qualiAhead', 'a'),
    qualiB: count('qualiAhead', 'b'),
    a,
    b,
  };
}

export function h2hByEra(entries) {
  return ERAS.map((era) => ({ era, ...summarizeH2H(entries.filter((e) => e.era === era.id)) }));
}

export function h2hByTrack(entries, circuits) {
  return circuits.map((circuit) => ({ circuit, ...summarizeH2H(entries.filter((e) => e.circuitId === circuit.circuitId)) }));
}

// ---------- track view ----------

/** Wins per era at a circuit, as [{ era, winners: [{year, driverName, team}], top: {driverName, wins} | null }]. */
export function trackWinners(rows, poles = new Map()) {
  const winners = rows
    .filter((r) => r.position === 1)
    .map((r) => ({
      year: r.year,
      round: r.round,
      era: r.era,
      driverName: r.driverName,
      team: r.team,
      pole: poles.get(`${r.year}-${r.round}`) ?? null,
    }))
    .sort((a, b) => b.year - a.year);
  return ERAS.map((era) => {
    const inEra = winners.filter((w) => w.era === era.id);
    const tally = new Map();
    for (const w of inEra) tally.set(w.driverName, (tally.get(w.driverName) ?? 0) + 1);
    const [driverName, wins] = [...tally].sort((a, b) => b[1] - a[1])[0] ?? [];
    return { era, winners: inEra, top: driverName ? { driverName, wins } : null };
  });
}

/** For each driver: their results at this circuit overall and by era. Rows are every driver's results here. */
export function driverTrackStats(rows, drivers) {
  return drivers.map((driver) => {
    const mine = rows.filter((r) => r.driverId === driver.id);
    const byEra = groupByEra(mine);
    return {
      driver,
      all: summarize(mine),
      eras: Object.fromEntries(ERAS.map((e) => [e.id, summarize(byEra[e.id])])),
    };
  });
}
