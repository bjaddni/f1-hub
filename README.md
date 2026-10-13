# F1 Hub

Private F1 stats app. Data from [Jolpica-F1](https://api.jolpi.ca/ergast/f1/).

```
npm start    # http://localhost:3000  (PORT env var to change)
npm test     # simulator unit tests
```

No dependencies, Node 20+.

- `server.js`: serves `public/` and proxies `/api/*` to Jolpica with a throttled disk cache (`.cache/`).
- `public/sim.js`: points tables and projection logic (pure, tested).
- `public/history.js`: regulation eras (1994–2008, 2009–13, 2014–21, 2022–25, 2026+) per-track stats, head-to-head and track-view helpers (pure, tested).
- `public/data.js`: loads standings, the schedule, a driver's race and qualifying history, and everyone's results at a circuit.
- `public/trackmap.js`: projects a circuit's GPS outline into an SVG. Outlines live in `public/data/circuits.json` (see `public/data/NOTICE.md` for the source and license).
- `public/whatif.js`: the drag-and-drop What-if game (podium board, driver pool, animated projected standings). Editing and title-clinch logic is in `sim.js`.
- `public/dreamgrid.js` / `dreamgrid-view.js`: the Dream Grid draft game (ratings, packs, record; UI). Two modes: Normal drafts driver-decades, Hard drafts a driver in a single season with the car; each has its own record curve and personal best. Data in `public/data/driver-seasons.json`, built by `npm run build:data` (re-run after each season ends); `npm run tune` shows how hard the draft is.
- `public/ui.js`: tiny DOM helper, page header and team colours shared by the views.
- `public/style.css`: the whole look. A carbon ground with one lime accent and Barlow Condensed numerals; a left rail on desktop that becomes a bottom tab bar on phones.
- `public/app.js`: UI (Standings, Drivers, Tracks, Head-to-head, What-if and Dream Grid tabs). What-if picks persist in localStorage.

Simplifications: championship ties are broken by wins, then current position (F1 uses full countback);
constructors' points are credited to each driver's current team; no fastest-lap point (dropped from 2025).
