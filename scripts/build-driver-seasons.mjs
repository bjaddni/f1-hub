// One-off data build: every driver's championship result for every completed season (1950 onwards),
// written to public/data/driver-seasons.json for the "Dream Grid" draft game.
//
//   node scripts/build-driver-seasons.mjs
//
// Talks to Jolpica directly at ~3 requests/second (its limit is about 4/s and 500/h; this makes ~76 calls).
// Re-run after each season ends to add the finished year. The live season comes from the app's own standings.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'driver-seasons.json');
const FIRST_YEAR = 1950;
const KEEP_TOP = 12; // the game only drafts top-10 finishers; a couple extra are kept as headroom
const lastYear = new Date().getFullYear() - 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function standingsFor(year) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`https://api.jolpi.ca/ergast/f1/${year}/driverstandings.json?limit=100`, { signal: AbortSignal.timeout(20000) });
    if (res.ok) return (await res.json()).MRData.StandingsTable.StandingsLists[0];
    if (res.status !== 429 && res.status < 500) throw new Error(`${year}: HTTP ${res.status}`);
    await sleep(2000 * attempt); // rate-limited or a hiccup: back off and retry
  }
  throw new Error(`${year}: gave up after 3 attempts`);
}

const rows = [];
for (let year = FIRST_YEAR; year <= lastYear; year++) {
  const list = await standingsFor(year);
  if (!list) throw new Error(`${year}: no standings`);
  const races = Number(list.round);
  for (const s of list.DriverStandings.slice(0, KEEP_TOP)) {
    const team = s.Constructors.at(-1) ?? { name: '—', constructorId: 'unknown' };
    rows.push({
      y: year,
      r: races,
      id: s.Driver.driverId,
      n: `${s.Driver.givenName} ${s.Driver.familyName}`,
      t: team.name,
      c: team.constructorId,
      pos: Number(s.position) || null, // can be missing in old seasons
      p: Number(s.points),
      w: Number(s.wins),
    });
  }
  process.stdout.write(`${year} `);
  await sleep(330);
}

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(rows));
console.log(`\n${rows.length} driver-seasons, ${FIRST_YEAR}-${lastYear} -> ${path.relative(process.cwd(), OUT)}`);
