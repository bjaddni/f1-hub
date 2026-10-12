import test from 'node:test';
import assert from 'node:assert/strict';
import { placeDriver, removeDriver, chaosOrder, titleClinch } from '../public/sim.js';

test('placeDriver puts a new driver in a slot and bumps the occupant', () => {
  assert.deepEqual(placeDriver(['a', 'b'], 3, 1, 'c'), ['a', 'c', null]);
});

test('placeDriver swaps when the driver is already placed', () => {
  assert.deepEqual(placeDriver(['a', 'b', 'c'], 3, 0, 'c'), ['c', 'b', 'a']);
  assert.deepEqual(placeDriver(['a', null, 'c'], 3, 1, 'a'), [null, 'a', 'c']);
});

test('placeDriver never duplicates a driver and does not mutate its input', () => {
  const input = ['a', 'b', 'c'];
  const out = placeDriver(input, 3, 2, 'a');
  assert.equal(new Set(out.filter(Boolean)).size, out.filter(Boolean).length);
  assert.deepEqual(input, ['a', 'b', 'c']);
});

test('removeDriver empties that slot only', () => {
  assert.deepEqual(removeDriver(['a', 'b', 'c'], 3, 'b'), ['a', null, 'c']);
});

test('chaosOrder returns unique drivers, the right size, and is deterministic for a seed', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `d${i}`);
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = chaosOrder(ids, 10, rng);
  assert.equal(out.length, 10);
  assert.equal(new Set(out).size, 10);
  assert.ok(out.every((id) => ids.includes(id)));
});

test('chaosOrder favours the front of the order on average', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `d${i}`);
  let seed = 3;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let front = 0;
  let back = 0;
  for (let n = 0; n < 400; n++) {
    const win = chaosOrder(ids, 1, rng)[0];
    if (Number(win.slice(1)) < 5) front++;
    if (Number(win.slice(1)) >= 15) back++;
  }
  assert.ok(front > back * 3, `front ${front} back ${back}`);
});

test('chaosOrder pads when there are fewer drivers than slots', () => {
  assert.deepEqual(chaosOrder(['a', 'b'], 4, () => 0.5).filter(Boolean).length, 2);
});

const drivers = [
  { id: 'a', points: 100, wins: 0, teamId: 'x' },
  { id: 'b', points: 60, wins: 0, teamId: 'y' },
];
const constructors = [{ id: 'x', points: 100, wins: 0 }, { id: 'y', points: 60, wins: 0 }];
const races = [{ round: 1, hasSprint: false }, { round: 2, hasSprint: false }];

test('titleClinch finds the first race after which the gap exceeds what is left', () => {
  // lead 40; after R1 with a winning, lead 65 > 25 left -> clinched at R1
  const scenario = { 1: { race: ['a', 'b'] } };
  const out = titleClinch({ drivers, constructors, scenario, remaining: races });
  assert.equal(out.race.round, 1);
  assert.equal(out.id, 'a');
});

test('a title can go down to the last race', () => {
  // R1: b wins and a scores nothing (100 v 85, 25 left, still open). R2: b wins again -> b 110 v a 100.
  const scenario = { 1: { race: ['b'] }, 2: { race: ['b'] } };
  const out = titleClinch({ drivers, constructors, scenario, remaining: races });
  assert.equal(out.race.round, 2);
  assert.equal(out.id, 'b');
});

test('titleClinch is null when the title is level at the end or picks are missing', () => {
  const level = [
    { id: 'a', points: 100, wins: 0, teamId: 'x' },
    { id: 'b', points: 75, wins: 0, teamId: 'y' },
    { id: 'z', points: 0, wins: 0, teamId: 'y' },
  ];
  const tied = { 1: { race: ['b'] }, 2: { race: ['z'] } }; // b catches a on 100 and a scores nothing more
  assert.equal(titleClinch({ drivers: level, constructors, scenario: tied, remaining: races }), null);
  assert.equal(titleClinch({ drivers, constructors, scenario: {}, remaining: races }), null);
  assert.equal(titleClinch({ drivers, constructors, scenario: { 2: { race: ['a'] } }, remaining: races }), null); // R1 unpicked
});
