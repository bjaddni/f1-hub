import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStandings, maxRemaining, canStillWin, scenarioPoints, orderFromStandings } from '../public/sim.js';

const drivers = [
  { id: 'a', points: 100, wins: 3, teamId: 'x' },
  { id: 'b', points: 90, wins: 1, teamId: 'x' },
  { id: 'c', points: 80, wins: 0, teamId: 'y' },
];
const constructors = [
  { id: 'x', points: 190, wins: 4 },
  { id: 'y', points: 80, wins: 0 },
];

test('with no scenario, standings are unchanged', () => {
  const out = projectStandings({ drivers, constructors, scenario: {} });
  assert.deepEqual(out.drivers.map((d) => d.id), ['a', 'b', 'c']);
  assert.ok(out.drivers.every((d) => d.change === 0 && d.added === 0));
});

test('race and sprint points are awarded and can reorder the table', () => {
  const scenario = { 1: { race: ['c', 'b', 'a'], sprint: ['c'] } };
  const out = projectStandings({ drivers, constructors, scenario });
  const pts = Object.fromEntries(out.drivers.map((d) => [d.id, d.points]));
  assert.deepEqual(pts, { a: 115, b: 108, c: 113 }); // c: 80 + 25 + 8, b: 90 + 18, a: 100 + 15
  assert.deepEqual(out.drivers.map((d) => d.id), ['a', 'c', 'b']);
  assert.equal(out.drivers.find((d) => d.id === 'c').change, 1);
});

test('only race wins count as wins, not sprint wins', () => {
  const { wins } = scenarioPoints({ 1: { race: ['b'], sprint: ['c'] } });
  assert.equal(wins.get('b'), 1);
  assert.equal(wins.has('c'), false);
});

test('constructors collect points from both drivers', () => {
  const out = projectStandings({ drivers, constructors, scenario: { 1: { race: ['b', 'a', 'c'] } } });
  assert.equal(out.constructors.find((c) => c.id === 'x').points, 190 + 25 + 18);
  assert.equal(out.constructors.find((c) => c.id === 'y').points, 80 + 15);
});

test('equal points are split by wins', () => {
  const rows = [
    { id: 'p', points: 50, wins: 0, teamId: 't' },
    { id: 'q', points: 40, wins: 2, teamId: 't' },
  ];
  const out = projectStandings({ drivers: rows, constructors: [{ id: 't', points: 90, wins: 2 }], scenario: { 1: { race: ['q', null, null, null, 'p'] } } });
  // p: 50 + 10 = 60, q: 40 + 25 = 65
  assert.deepEqual(out.drivers.map((d) => d.id), ['q', 'p']);
});

test('max remaining points', () => {
  const races = [{ hasSprint: false }, { hasSprint: true }];
  assert.equal(maxRemaining(races), 25 + 25 + 8);
  assert.equal(maxRemaining(races, { perTeam: true }), 43 + 43 + 15);
});

test('canStillWin compares best case to the leader', () => {
  const rows = [{ id: 'a', points: 100 }, { id: 'b', points: 70 }, { id: 'c', points: 74 }];
  const sorted = [...rows].sort((x, y) => y.points - x.points);
  const result = canStillWin(sorted, 26);
  assert.equal(result.get('a'), true);
  assert.equal(result.get('c'), true); // 74 + 26 = 100, level with the leader
  assert.equal(result.get('b'), false);
});

test('orderFromStandings pads with null', () => {
  assert.deepEqual(orderFromStandings(drivers, 4), ['a', 'b', 'c', null]);
});
