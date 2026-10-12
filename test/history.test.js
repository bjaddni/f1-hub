import test from 'node:test';
import assert from 'node:assert/strict';
import { ERAS, eraOf, parseResults, summarize, trackMatrix } from '../public/history.js';

const race = (season, circuitId, { position = '1', positionText = position, grid = '1', points = '25', status = 'Finished' } = {}) => ({
  season: String(season),
  round: '1',
  raceName: 'Some GP',
  Circuit: { circuitId },
  Results: [{ position, positionText, grid, points, status, Constructor: { name: 'Team', constructorId: 'team' } }],
});

test('eraOf maps years to the agreed eras', () => {
  assert.equal(eraOf(1994).id, '1994-2008');
  assert.equal(eraOf(2008).id, '1994-2008');
  assert.equal(eraOf(2009).id, '2009-2013');
  assert.equal(eraOf(2021).id, '2014-2021');
  assert.equal(eraOf(2022).id, '2022-2025');
  assert.equal(eraOf(2025).id, '2022-2025');
  assert.equal(eraOf(2026).id, '2026+');
  assert.equal(eraOf(2031).id, '2026+');
  assert.equal(eraOf(1993), null);
  assert.equal(ERAS.length, 5);
});

test('parseResults drops pre-1994 seasons and flags non-classified results', () => {
  const rows = parseResults([
    race(1990, 'monza'),
    race(2010, 'monza'),
    race(2011, 'monza', { position: '18', positionText: 'R', status: 'Engine' }),
    race(2012, 'monza', { grid: '0' }),
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].position, null);
  assert.equal(rows[2].grid, null); // pit-lane start
});

test('summarize computes the headline numbers', () => {
  const rows = parseResults([
    race(2015, 'x', { position: '1', grid: '2', points: '25' }),
    race(2016, 'x', { position: '3', grid: '4', points: '15' }),
    race(2017, 'x', { position: '12', positionText: '12', grid: '6', points: '0' }),
    race(2018, 'x', { position: '20', positionText: 'R', grid: '8', points: '0' }),
  ]);
  const s = summarize(rows);
  assert.equal(s.starts, 4);
  assert.equal(s.wins, 1);
  assert.equal(s.podiums, 2);
  assert.equal(s.best, 1);
  assert.equal(s.dnfs, 1);
  assert.equal(s.points, 40);
  assert.equal(s.avgFinish, (1 + 3 + 12) / 3); // retirements don't count toward average finish
  assert.equal(s.avgGrid, 5);
});

test('an empty set has null averages, not NaN', () => {
  const s = summarize([]);
  assert.equal(s.starts, 0);
  assert.equal(s.avgFinish, null);
  assert.equal(s.best, null);
});

test('trackMatrix groups one circuit by era and covers every era', () => {
  const rows = parseResults([race(2005, 'monza'), race(2018, 'monza'), race(2019, 'monza'), race(2018, 'spa')]);
  const [monza, other] = trackMatrix(rows, [{ circuitId: 'monza' }, { circuitId: 'suzuka' }]);
  assert.equal(monza.eras['1994-2008'].starts, 1);
  assert.equal(monza.eras['2014-2021'].starts, 2);
  assert.equal(monza.eras['2022-2025'].starts, 0);
  assert.equal(monza.all.starts, 3);
  assert.equal(other.all.starts, 0);
  assert.equal(Object.keys(monza.eras).length, ERAS.length);
});

import { sharedRaces, summarizeH2H, h2hByEra, h2hByTrack } from '../public/history.js';

const row = (year, round, circuitId, position, { grid = 5, teamId = 't1' } = {}) => ({
  year, round, raceName: 'GP', circuitId, team: teamId, teamId, grid, position, status: '', points: 0, era: eraOf(year).id,
});

test('sharedRaces only keeps races both drivers started and decides who was ahead', () => {
  const a = [row(2015, 1, 'x', 3), row(2015, 2, 'x', 8), row(2016, 1, 'y', 2)];
  const b = [row(2015, 1, 'x', 5), row(2015, 2, 'x', 4), row(2017, 1, 'x', 1)];
  const shared = sharedRaces(a, b);
  assert.equal(shared.length, 2);
  assert.deepEqual(shared.map((s) => s.finishAhead), ['a', 'b']);
});

test('a classified finish beats a retirement, and two retirements are no result', () => {
  const shared = sharedRaces(
    [row(2015, 1, 'x', 12), row(2015, 2, 'x', null), row(2015, 3, 'x', null)],
    [row(2015, 1, 'x', null), row(2015, 2, 'x', 9), row(2015, 3, 'x', null)],
  );
  assert.deepEqual(shared.map((s) => s.finishAhead), ['a', 'b', null]);
});

test('grid comparison ignores pit-lane starts and ties', () => {
  const shared = sharedRaces(
    [row(2015, 1, 'x', 1, { grid: 1 }), row(2015, 2, 'x', 1, { grid: null }), row(2015, 3, 'x', 1, { grid: 4 })],
    [row(2015, 1, 'x', 2, { grid: 3 }), row(2015, 2, 'x', 2, { grid: 3 }), row(2015, 3, 'x', 2, { grid: 4 })],
  );
  assert.deepEqual(shared.map((s) => s.gridAhead), ['a', null, null]);
});

test('summarizeH2H tallies results and flags teammate races', () => {
  const shared = sharedRaces(
    [row(2015, 1, 'x', 1, { teamId: 'm' }), row(2015, 2, 'x', 6, { teamId: 'm' }), row(2016, 1, 'x', 2, { teamId: 'm' })],
    [row(2015, 1, 'x', 2, { teamId: 'm' }), row(2015, 2, 'x', 3, { teamId: 'n' }), row(2016, 1, 'x', 5, { teamId: 'n' })],
  );
  const s = summarizeH2H(shared);
  assert.equal(s.shared, 3);
  assert.equal(s.finishA, 2); // P1 v P2 and P2 v P5
  assert.equal(s.finishB, 1); // P3 v P6
  assert.equal(s.teammates, 1);
  assert.equal(s.a.wins, 1);
});

test('h2h splits by era and by track', () => {
  const shared = sharedRaces(
    [row(2005, 1, 'x', 1), row(2015, 1, 'x', 1), row(2015, 2, 'y', 1)],
    [row(2005, 1, 'x', 2), row(2015, 1, 'x', 2), row(2015, 2, 'y', 2)],
  );
  const eras = h2hByEra(shared);
  assert.equal(eras.length, ERAS.length);
  assert.equal(eras.find((e) => e.era.id === '2014-2021').shared, 2);
  const tracks = h2hByTrack(shared, [{ circuitId: 'x' }, { circuitId: 'z' }]);
  assert.equal(tracks[0].shared, 2);
  assert.equal(tracks[1].shared, 0);
});

import { mergeRacePages, parseCircuitResults, trackWinners, driverTrackStats } from '../public/history.js';

test('parseResults attaches qualifying positions and leaves gaps as null', () => {
  const races = [race(2015, 'x'), race(2016, 'x')].map((r, i) => ({
    ...r,
    round: String(i + 1),
    Results: [{ ...r.Results[0], Driver: { driverId: 'd', givenName: 'D', familyName: 'Driver' } }],
  }));
  const quali = [{ season: '2015', round: '1', QualifyingResults: [{ position: '3', Driver: { driverId: 'd' } }] }];
  const rows = parseResults(races, quali);
  assert.equal(rows[0].quali, 3);
  assert.equal(rows[1].quali, null); // no qualifying record for 2016
});

test('summarize counts poles and averages qualifying', () => {
  const rows = [row(2015, 1, 'x', 1), row(2015, 2, 'x', 2), row(2015, 3, 'x', 3)].map((r, i) => ({ ...r, quali: [1, 3, null][i] }));
  const s = summarize(rows);
  assert.equal(s.poles, 1);
  assert.equal(s.avgQuali, 2);
});

test('h2h qualifying comparison ignores missing data', () => {
  const withQ = (r, quali) => ({ ...r, quali });
  const shared = sharedRaces(
    [withQ(row(2015, 1, 'x', 1), 2), withQ(row(2015, 2, 'x', 1), null), withQ(row(2015, 3, 'x', 1), 5)],
    [withQ(row(2015, 1, 'x', 2), 4), withQ(row(2015, 2, 'x', 2), 1), withQ(row(2015, 3, 'x', 2), 1)],
  );
  const s = summarizeH2H(shared);
  assert.equal(s.qualiA, 1);
  assert.equal(s.qualiB, 1);
});

test('mergeRacePages stitches a race that was split across pages', () => {
  const page1 = [{ season: '2019', round: '14', Results: [{ n: 1 }, { n: 2 }] }];
  const page2 = [{ season: '2019', round: '14', Results: [{ n: 3 }] }, { season: '2019', round: '15', Results: [{ n: 9 }] }];
  const merged = mergeRacePages([page1, page2]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].Results.length, 3);
  assert.equal(page1[0].Results.length, 2); // inputs are not mutated
});

test('trackWinners groups winners by era with the top winner and pole-sitter', () => {
  const win = (year, driverId) => ({ ...row(year, 1, 'x', 1), driverId, driverName: driverId, team: 'T' });
  const rows = [win(2005, 'a'), win(2015, 'b'), win(2016, 'b'), win(2017, 'c'), { ...row(2017, 1, 'x', 2), driverId: 'z', driverName: 'z' }];
  const out = trackWinners(rows, new Map([['2017-1', 'pole man']]));
  const mid = out.find((e) => e.era.id === '2014-2021');
  assert.equal(mid.winners.length, 3);
  assert.deepEqual(mid.top, { driverName: 'b', wins: 2 });
  assert.equal(mid.winners[0].pole, 'pole man'); // newest first
  assert.equal(out.find((e) => e.era.id === '2026+').top, null);
});

test('driverTrackStats builds per-era summaries for each driver, empty when absent', () => {
  const at = (year, driverId, pos) => ({ ...row(year, 1, 'x', pos), driverId });
  const stats = driverTrackStats([at(2005, 'a', 2), at(2015, 'a', 4), at(2015, 'b', 1)], [{ id: 'a' }, { id: 'c' }]);
  assert.equal(stats[0].all.starts, 2);
  assert.equal(stats[0].eras['2014-2021'].best, 4);
  assert.equal(stats[1].all.starts, 0);
});

test('parseCircuitResults keeps one row per driver per race', () => {
  const driver = (id) => ({ position: '1', positionText: '1', grid: '1', points: '25', status: 'Finished', Driver: { driverId: id, givenName: id, familyName: 'X' }, Constructor: { name: 'T', constructorId: 't' } });
  const rows = parseCircuitResults([{ season: '2015', round: '1', raceName: 'GP', Circuit: { circuitId: 'x' }, Results: [driver('a'), driver('b')] }]);
  assert.deepEqual(rows.map((r) => r.driverId), ['a', 'b']);
});
