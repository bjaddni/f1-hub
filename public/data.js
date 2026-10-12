// Loads and normalises Jolpica data (via our caching proxy at /api/).
import { parseResults, parseCircuitResults, mergeRacePages } from './history.js';

async function get(path) {
  const res = await fetch(`/api/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()).MRData;
}

export async function loadSeason() {
  const [driverData, constructorData, scheduleData] = await Promise.all([
    get('current/driverstandings.json'),
    get('current/constructorstandings.json'),
    get('current.json?limit=40'),
  ]);

  const driverList = driverData.StandingsTable.StandingsLists[0];
  const constructorList = constructorData.StandingsTable.StandingsLists[0];
  if (!driverList || !constructorList) throw new Error('No standings published yet for this season.');

  const drivers = driverList.DriverStandings.map((s) => ({
    id: s.Driver.driverId,
    code: s.Driver.code || s.Driver.familyName.slice(0, 3).toUpperCase(),
    name: `${s.Driver.givenName} ${s.Driver.familyName}`,
    number: s.Driver.permanentNumber,
    team: s.Constructors.at(-1)?.name ?? '—',
    teamId: s.Constructors.at(-1)?.constructorId ?? 'unknown',
    points: Number(s.points),
    wins: Number(s.wins),
  }));

  const constructors = constructorList.ConstructorStandings.map((s) => ({
    id: s.Constructor.constructorId,
    name: s.Constructor.name,
    points: Number(s.points),
    wins: Number(s.wins),
  }));

  const completedRound = Number(driverList.round);
  const races = scheduleData.RaceTable.Races.map((r) => ({
    round: Number(r.round),
    name: r.raceName,
    circuitId: r.Circuit.circuitId,
    circuit: r.Circuit.circuitName,
    country: r.Circuit.Location.country,
    locality: r.Circuit.Location.locality,
    date: r.date,
    hasSprint: Boolean(r.Sprint),
  }));

  return {
    season: driverList.season,
    completedRound,
    drivers,
    constructors,
    races,
    remaining: races.filter((r) => r.round > completedRound),
  };
}

/** Memoise a promise-returning loader per key for the page's lifetime, forgetting failures so they can be retried. */
function memoByKey(load) {
  const cache = new Map();
  return (key) => {
    if (!cache.has(key)) {
      cache.set(
        key,
        load(key).catch((err) => {
          cache.delete(key);
          throw err;
        }),
      );
    }
    return cache.get(key);
  };
}

/** Every page of a paginated Jolpica query, as one list of `RaceTable.Races` per page. */
async function getAllPages(path) {
  const PAGE = 100; // Jolpica's maximum page size
  const sep = path.includes('?') ? '&' : '?';
  const first = await get(`${path}${sep}limit=${PAGE}`);
  const offsets = [];
  for (let offset = PAGE; offset < Number(first.total); offset += PAGE) offsets.push(offset);
  const rest = await Promise.all(offsets.map((o) => get(`${path}${sep}limit=${PAGE}&offset=${o}`)));
  return [first, ...rest].map((page) => page.RaceTable.Races);
}

/** Every race result for one driver, with qualifying positions, limited to 1994 onwards. */
export const loadDriverHistory = memoByKey(async (driverId) => {
  const [results, quali] = await Promise.all([
    getAllPages(`drivers/${driverId}/results.json`),
    // Qualifying is a bonus: if it can't load, the race history is still worth showing.
    getAllPages(`drivers/${driverId}/qualifying.json`).catch(() => []),
  ]);
  return parseResults(results.flat(), quali.flat());
});

/** Everyone's results at one circuit (1994+), plus pole-sitters by season-round. */
export const loadCircuit = memoByKey(async (circuitId) => {
  const [results, poles] = await Promise.all([
    getAllPages(`circuits/${circuitId}/results.json`),
    getAllPages(`circuits/${circuitId}/qualifying/1.json`).catch(() => []),
  ]);
  const poleByRace = new Map();
  for (const race of poles.flat()) {
    const q = race.QualifyingResults?.[0];
    if (q) poleByRace.set(`${race.season}-${race.round}`, `${q.Driver.givenName} ${q.Driver.familyName}`);
  }
  return { rows: parseCircuitResults(mergeRacePages(results)), poles: poleByRace };
});

/** Circuit outlines (bundled from bacinger/f1-circuits), keyed by Jolpica circuitId. Maps are optional, so failures give none. */
export async function loadTrackShapes() {
  try {
    const res = await fetch('/data/circuits.json');
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}
