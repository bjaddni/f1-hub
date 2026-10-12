// Dev helper: how hard is each mode? Prints the rating spread and the record distribution for simple strategies.
//   node scripts/tune-dreamgrid.mjs
import fs from 'node:fs';
import { MODES, drawPack, mulberry32, SLOTS, seasonRecord } from '../public/dreamgrid.js';

const rows = JSON.parse(fs.readFileSync(new URL('../public/data/driver-seasons.json', import.meta.url), 'utf8'));
const RACES = 23;

for (const mode of Object.values(MODES)) {
  const cards = mode.build(rows);
  const ratings = cards.map((c) => c.rating).sort((a, b) => a - b);
  const pct = (p) => ratings[Math.floor(p * (ratings.length - 1))];
  const label = (c) => `${c.name} ${c.label}${c.team ? ` ${c.team}` : ''} ${c.rating}`;
  console.log(`\n== ${mode.name} ==\ncards ${cards.length}; rating p10 ${pct(0.1)} p50 ${pct(0.5)} p90 ${pct(0.9)} p99 ${pct(0.99)} max ${ratings.at(-1)}`);
  console.log('top 8:', [...cards].sort((a, b) => b.rating - a.rating).slice(0, 8).map(label).join(' | '));

  const play = (strategy, seed) => {
    const rng = mulberry32(seed);
    const team = Array(SLOTS.length).fill(null);
    for (let round = 0; round < SLOTS.length; round++) {
      let pack = drawPack(cards, rng, team.filter(Boolean));
      // one reroll when nothing in the pack is good
      if (strategy.reroll && Math.max(...pack.map((c) => c.rating)) < strategy.reroll) pack = drawPack(cards, rng, team.filter(Boolean));
      team[team.findIndex((t) => t == null)] = pack.reduce((a, b) => (b.rating > a.rating ? b : a));
    }
    return seasonRecord(team, RACES, mode.id).wins;
  };
  for (const [name, strategy] of [['greedy', {}], ['greedy+reroll<70', { reroll: 70 }]]) {
    const N = 20000;
    const hist = new Map();
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const w = play(strategy, i + 1);
      sum += w;
      hist.set(w, (hist.get(w) || 0) + 1);
    }
    const atLeast = (k) => [...hist].filter(([w]) => w >= k).reduce((s, [, n]) => s + n, 0) / N;
    console.log(`${name}: mean wins ${(sum / N).toFixed(1)}; >=10: ${(atLeast(10) * 100).toFixed(0)}%  >=15: ${(atLeast(15) * 100).toFixed(1)}%  >=20: ${(atLeast(20) * 100).toFixed(2)}%  perfect: ${(atLeast(23) * 100).toFixed(3)}%`);
  }
  // theoretical best: the 5 best distinct drivers, strongest in the heaviest slot
  const seen = new Set();
  const bestFive = [...cards].sort((a, b) => b.rating - a.rating).filter((c) => (seen.has(c.driverId) ? false : seen.add(c.driverId))).slice(0, 5);
  console.log('best possible:', bestFive.map(label).join(' | '), '->', seasonRecord(bestFive, RACES, mode.id).wins, 'wins');
}
