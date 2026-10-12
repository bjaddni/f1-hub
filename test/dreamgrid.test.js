import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SLOTS, rateSeason, rateDecade, decadeOf, decadeLabel, buildCards, mulberry32, hashString, drawPack, teamStrength, winsFor, tierFor, seasonRecord, shareText,
} from '../public/dreamgrid.js';

test('a dominant title season rates near 100, a winless back-marker near zero', () => {
  assert.equal(rateSeason({ wins: 19, races: 22, points: 575 }, 575), 100); // Verstappen 2023
  assert.ok(rateSeason({ wins: 13, races: 18, points: 148 }, 148) >= 90); // Schumacher 2004
  assert.ok(rateSeason({ wins: 0, races: 20, points: 4 }, 400) <= 2);
});

test('rating never exceeds 100 and handles empty seasons', () => {
  assert.equal(rateSeason({ wins: 10, races: 10, points: 100 }, 100), 100);
  assert.equal(rateSeason({ wins: 0, races: 0, points: 0 }, 0), 0);
});

const season = (y, id, pos, p, w, n = id) => ({ y, r: 16, id, n, t: 'Team', c: 'team', pos, p, w });
const rows = [
  season(1988, 'senna', 1, 90, 8, 'Ayrton Senna'),
  season(1989, 'senna', 2, 60, 6, 'Ayrton Senna'),
  season(1990, 'senna', 1, 78, 6, 'Ayrton Senna'),
  season(1991, 'senna', 1, 96, 7, 'Ayrton Senna'),
  season(1992, 'senna', 4, 50, 3, 'Ayrton Senna'),
  season(1988, 'prost', 2, 87, 7, 'Alain Prost'),
  season(1989, 'prost', 1, 81, 4, 'Alain Prost'),
  season(1990, 'prost', 2, 73, 5, 'Alain Prost'),
  season(1988, 'oneyear', 5, 20, 0), // a single season in the decade is not enough for a card
  season(1988, 'nopoints', 6, 0, 0),
  season(1989, 'nopoints', 6, 0, 0),
  season(1988, 'tail', 11, 3, 0), // outside the top 10
  season(1989, 'tail', 11, 3, 0),
];

test('buildCards makes one card per driver per decade from scoring top-10 seasons', () => {
  const cards = buildCards(rows, new Set(['prost']));
  assert.deepEqual(cards.map((c) => c.key).sort(), ['prost-1980', 'senna-1980', 'senna-1990']);
  const senna80 = cards.find((c) => c.key === 'senna-1980');
  assert.equal(senna80.label, "'80s");
  assert.equal(senna80.years, 2); // 1988 and 1989
  assert.equal(cards.find((c) => c.key === 'senna-1990').years, 3); // 1990 to 1992
  assert.equal(cards.find((c) => c.driverId === 'senna').retired, true);
  assert.equal(cards.find((c) => c.driverId === 'prost').retired, false);
});

test('a decade card averages only the best three seasons', () => {
  assert.equal(rateDecade([90, 60, 30]), 60);
  assert.equal(rateDecade([100, 80, 60, 10, 5]), 80);
  assert.equal(rateDecade([40, 20]), 30); // fewer than three seasons: average what there is
});

test('decadeOf and decadeLabel', () => {
  assert.deepEqual([1950, 1959, 2000, 2026].map(decadeOf), [1950, 1950, 2000, 2020]);
  assert.deepEqual([1950, 1990, 2000, 2020].map(decadeLabel), ["'50s", "'90s", "'00s", "'20s"]);
});

test('seeded randomness repeats, and different seeds differ', () => {
  const a = mulberry32(hashString('2026-10-12'));
  const b = mulberry32(hashString('2026-10-12'));
  const c = mulberry32(hashString('2026-10-13'));
  const seq = (r) => [r(), r(), r()];
  assert.deepEqual(seq(a), seq(b));
  assert.notDeepEqual(seq(mulberry32(hashString('2026-10-12'))), seq(c));
  assert.ok(seq(mulberry32(1)).every((v) => v >= 0 && v < 1));
});

const pool = Array.from({ length: 30 }, (_, i) => ({ key: `d${i % 15}-${i}`, driverId: `d${i % 15}`, name: `D${i % 15}`, year: 2000 + i, rating: (i * 3) % 100 }));

test('drawPack returns distinct drivers, honours size, and skips drivers already drafted', () => {
  const taken = [pool[0], pool[1]];
  const pack = drawPack(pool, mulberry32(5), taken, 4);
  assert.equal(pack.length, 4);
  assert.equal(new Set(pack.map((c) => c.driverId)).size, 4);
  assert.ok(pack.every((c) => !taken.some((t) => t.driverId === c.driverId)));
});

test('drawPack is deterministic for a seed and copes with a tiny pool', () => {
  const ids = (p) => p.map((c) => c.key);
  assert.deepEqual(ids(drawPack(pool, mulberry32(9))), ids(drawPack(pool, mulberry32(9))));
  assert.equal(drawPack(pool.slice(0, 2), mulberry32(1)).length, 2);
});

test('drawPack favours stronger seasons', () => {
  const two = [
    { key: 'a', driverId: 'a', rating: 100 },
    { key: 'b', driverId: 'b', rating: 5 },
  ];
  const rng = mulberry32(11);
  let a = 0;
  for (let i = 0; i < 500; i++) if (drawPack(two, rng, [], 1)[0].key === 'a') a++;
  assert.ok(a > 400, `a drawn ${a}/500`);
});

test('teamStrength weights the front slots more and counts empty slots as zero', () => {
  const full = (r) => SLOTS.map(() => ({ rating: r }));
  assert.equal(Math.round(teamStrength(full(80))), 80);
  const topHeavy = [{ rating: 100 }, { rating: 0 }, { rating: 0 }, { rating: 0 }, { rating: 0 }];
  const bottomHeavy = [{ rating: 0 }, { rating: 0 }, { rating: 0 }, { rating: 0 }, { rating: 100 }];
  assert.ok(teamStrength(topHeavy) > teamStrength(bottomHeavy));
  assert.equal(teamStrength([]), 0);
});

test('winsFor is monotonic and bounded', () => {
  assert.equal(winsFor(0, 23), 0);
  assert.equal(winsFor(45, 23), 0);
  assert.equal(winsFor(90, 23), 23);
  assert.equal(winsFor(150, 23), 23);
  let last = -1;
  for (let s = 0; s <= 100; s += 5) {
    const w = winsFor(s, 23);
    assert.ok(w >= last);
    last = w;
  }
});

test('tierFor names the perfect season and scales down', () => {
  assert.equal(tierFor(23, 23).name, 'Perfect season');
  assert.equal(tierFor(20, 23).name, 'Dynasty');
  assert.equal(tierFor(16, 23).name, 'Championship team');
  assert.equal(tierFor(10, 23).name, 'Podium contenders');
  assert.equal(tierFor(5, 23).name, 'Midfield');
  assert.equal(tierFor(1, 23).name, 'Backmarkers');
});

test('seasonRecord adds up and shareText lists every slot', () => {
  const team = SLOTS.map((s, i) => ({ name: `Driver ${i}`, year: 2000 + i, rating: 70 }));
  const rec = seasonRecord(team, 23);
  assert.equal(rec.wins + rec.losses, 23);
  const text = shareText(team, rec, 23);
  assert.ok(text.includes(`${rec.wins}-${rec.losses}`));
  assert.equal(text.split('\n').length, 1 + SLOTS.length);
});

test('the real dataset builds a pool in which the best possible team is a perfect season', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/data/driver-seasons.json', import.meta.url), 'utf8'));
  const cards = buildCards(data);
  assert.ok(cards.length > 100);
  const seen = new Set();
  const best = [...cards].sort((a, b) => b.rating - a.rating).filter((c) => (seen.has(c.driverId) ? false : seen.add(c.driverId))).slice(0, 5);
  assert.equal(seasonRecord(best, 23).wins, 23);
  assert.ok(cards.some((c) => c.retired) && cards.every((c) => c.rating >= 0 && c.rating <= 100));
});

import { buildSeasonCards, MODES } from '../public/dreamgrid.js';

test('hard mode builds one card per scoring top-10 season, with the car and no averaging', () => {
  const cards = buildSeasonCards(rows, new Set(['prost']));
  const senna88 = cards.find((c) => c.key === 'senna-1988');
  assert.equal(senna88.label, '1988');
  assert.equal(senna88.team, 'Team');
  assert.equal(senna88.detail, 'Team');
  assert.equal(cards.filter((c) => c.driverId === 'senna').length, 5); // every season is its own card
  assert.ok(cards.some((c) => c.key === 'oneyear-1988'), 'a single season is enough in hard mode');
  assert.ok(!cards.some((c) => c.driverId === 'tail' || c.driverId === 'nopoints'));
  assert.equal(cards.find((c) => c.driverId === 'prost').retired, false);
  assert.ok(senna88.rating > cards.find((c) => c.key === 'senna-1992').rating);
});

test('each mode has its own deck builder and a sensible curve', () => {
  assert.deepEqual(Object.keys(MODES), ['normal', 'hard']);
  for (const mode of Object.values(MODES)) {
    assert.equal(typeof mode.build, 'function');
    assert.ok(mode.curve.low > 0 && mode.curve.span > 0 && mode.curve.exp >= 1);
    assert.ok(mode.blurb.length > 10);
  }
  // Hard is the stricter one: the same strength wins fewer races
  assert.ok(winsFor(65, 23, MODES.hard.curve) < winsFor(65, 23, MODES.normal.curve));
});

test('seasonRecord uses the mode curve', () => {
  const team = SLOTS.map(() => ({ name: 'x', label: 'y', rating: 70 }));
  assert.ok(seasonRecord(team, 23, 'normal').wins > seasonRecord(team, 23, 'hard').wins);
  assert.equal(seasonRecord(team, 23).wins, seasonRecord(team, 23, 'normal').wins); // normal is the default
});

test('in both modes the best possible real lineup is a perfect season', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/data/driver-seasons.json', import.meta.url), 'utf8'));
  for (const mode of Object.values(MODES)) {
    const cards = mode.build(data);
    const seen = new Set();
    const best = [...cards].sort((a, b) => b.rating - a.rating).filter((c) => (seen.has(c.driverId) ? false : seen.add(c.driverId))).slice(0, 5);
    assert.equal(seasonRecord(best, 23, mode.id).wins, 23, mode.id);
  }
});
