// Pure championship logic: no DOM, no network. Shared by the UI and the tests.

export const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

/**
 * Scenario shape: { [round]: { race: (driverId|null)[10], sprint: (driverId|null)[8] } }
 * Empty slots mean "outside the points", which scores nothing.
 */

/** Points a driver earns from one session given the ordered finishers. */
function awardPoints(order, table, totals, wins) {
  order.forEach((driverId, i) => {
    if (!driverId || i >= table.length) return;
    totals.set(driverId, (totals.get(driverId) || 0) + table[i]);
  });
  if (wins && order[0]) wins.set(order[0], (wins.get(order[0]) || 0) + 1);
}

/** Add up everything the scenario awards, per driver. */
export function scenarioPoints(scenario) {
  const points = new Map();
  const wins = new Map();
  for (const round of Object.values(scenario)) {
    awardPoints(round.race || [], RACE_POINTS, points, wins);
    awardPoints(round.sprint || [], SPRINT_POINTS, points, null); // sprint wins don't count as wins
  }
  return { points, wins };
}

/** Rank by points, then wins, then the real standing. (Official F1 uses full countback; this is the usual approximation.) */
function rank(rows) {
  return rows
    .sort((a, b) => b.points - a.points || b.wins - a.wins || a.basePosition - b.basePosition)
    .map((row, i) => ({ ...row, position: i + 1, change: row.basePosition - (i + 1) }));
}

/**
 * drivers:      [{ id, points, wins, teamId, ...display }] in current standings order
 * constructors: [{ id, points, wins, ...display }] in current standings order
 */
export function projectStandings({ drivers, constructors, scenario }) {
  const { points, wins } = scenarioPoints(scenario);
  const teamOf = new Map(drivers.map((d) => [d.id, d.teamId]));

  const driverRows = rank(
    drivers.map((d, i) => ({
      ...d,
      basePosition: i + 1,
      added: points.get(d.id) || 0,
      points: d.points + (points.get(d.id) || 0),
      wins: d.wins + (wins.get(d.id) || 0),
    })),
  );

  const teamAdded = new Map();
  const teamWins = new Map();
  for (const [driverId, pts] of points) teamAdded.set(teamOf.get(driverId), (teamAdded.get(teamOf.get(driverId)) || 0) + pts);
  for (const [driverId, n] of wins) teamWins.set(teamOf.get(driverId), (teamWins.get(teamOf.get(driverId)) || 0) + n);

  const constructorRows = rank(
    constructors.map((c, i) => ({
      ...c,
      basePosition: i + 1,
      added: teamAdded.get(c.id) || 0,
      points: c.points + (teamAdded.get(c.id) || 0),
      wins: c.wins + (teamWins.get(c.id) || 0),
    })),
  );

  return { drivers: driverRows, constructors: constructorRows };
}

/** Most points one driver / one team can still collect from the given races. */
export function maxRemaining(races, { perTeam = false } = {}) {
  const race = perTeam ? RACE_POINTS[0] + RACE_POINTS[1] : RACE_POINTS[0];
  const sprint = perTeam ? SPRINT_POINTS[0] + SPRINT_POINTS[1] : SPRINT_POINTS[0];
  return races.reduce((sum, r) => sum + race + (r.hasSprint ? sprint : 0), 0);
}

/** A row can still win the title if its best case reaches the leader's current total. */
export function canStillWin(rows, maxLeft) {
  const leader = rows[0].points;
  return new Map(rows.map((r) => [r.id, r.points + maxLeft >= leader]));
}

/** The order of the current standings, as a fill for one session. */
export function orderFromStandings(drivers, slots) {
  return Array.from({ length: slots }, (_, i) => drivers[i]?.id ?? null);
}

// ---------- scenario editing (used by the drag-and-drop board) ----------

const padded = (order, size) => Array.from({ length: size }, (_, i) => order[i] ?? null);

/**
 * Put a driver into slot `index`. If he already holds another slot in this session the two swap;
 * otherwise whoever was in the slot is bumped out. Returns a new array and never duplicates a driver.
 */
export function placeDriver(order, size, index, driverId) {
  const next = padded(order, size);
  const from = next.indexOf(driverId);
  const displaced = next[index];
  if (from !== -1) next[from] = displaced;
  next[index] = driverId;
  return next;
}

/** Take a driver out of a session (back to "outside the points"). */
export function removeDriver(order, size, driverId) {
  return padded(order, size).map((id) => (id === driverId ? null : id));
}

/**
 * A plausible random result: each remaining slot is filled by sampling the drivers with weights that favour
 * the front of `driverIds` (their current championship order), so chaos still feels like racing.
 */
export function chaosOrder(driverIds, size, rng = Math.random, spread = 0.12) {
  const pool = driverIds.map((id, rank) => ({ id, weight: Math.exp(-rank * spread) }));
  const out = [];
  while (out.length < size && pool.length) {
    let pick = rng() * pool.reduce((s, p) => s + p.weight, 0);
    let i = 0;
    while (i < pool.length - 1 && (pick -= pool[i].weight) > 0) i++;
    out.push(pool.splice(i, 1)[0].id);
  }
  return padded(out, size);
}

/**
 * The first remaining race after which the leader can no longer be caught, given the picks so far.
 * Only counts rounds picked in order (a round with no winner picked stops the search).
 * Returns { race, id } or null.
 */
export function titleClinch({ drivers, constructors, scenario, remaining, kind = 'driver' }) {
  const perTeam = kind === 'constructor';
  const included = {};
  for (let i = 0; i < remaining.length; i++) {
    const race = remaining[i];
    if (!scenario[race.round]?.race?.[0]) return null;
    included[race.round] = scenario[race.round];
    const rows = projectStandings({ drivers, constructors, scenario: included })[perTeam ? 'constructors' : 'drivers'];
    const margin = rows[0].points - (rows[1]?.points ?? 0);
    if (margin > maxRemaining(remaining.slice(i + 1), { perTeam })) return { race, id: rows[0].id };
  }
  return null;
}
