import { loadSeason, loadDriverHistory, loadCircuit, loadTrackShapes } from './data.js';
import { trackSvg } from './trackmap.js';
import { h, teamColor, pageHeader } from './ui.js';
import { renderWhatIf } from './whatif.js';
import { renderDreamGrid } from './dreamgrid-view.js';
import { ERAS, trackMatrix, summarize, groupByEra, sharedRaces, summarizeH2H, h2hByEra, h2hByTrack, trackWinners, driverTrackStats } from './history.js';
import { projectStandings, maxRemaining, canStillWin } from './sim.js';

const STORAGE_KEY = 'f1hub.scenario';

const state = { season: null, scenario: {}, tab: 'standings', driverId: null, trackId: null, histories: new Map(), h2h: { a: null, b: null, trackId: 'all' }, trackView: { trackId: null }, circuits: new Map(), shapes: {} };

function loadScenario() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveScenario() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ season: state.season.season, rounds: state.scenario }));
  } catch {
    /* storage unavailable: the scenario just won't persist */
  }
}

/** On a phone the result of a tap can be far from the thing tapped (the layout is one column): scroll it into view. */
function revealOnPhone(selector) {
  if (!matchMedia('(max-width: 860px)').matches) return;
  document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- shared table ----------

function standingsTable(rows, { kind, flags, maxLeft }) {
  const isDriver = kind === 'driver';
  const eligible = flags;
  const head = h(
    'tr',
    {},
    h('th', {}, 'Pos'),
    h('th', {}, isDriver ? 'Driver' : 'Team'),
    isDriver ? h('th', { class: 'hide-sm' }, 'Team') : null,
    h('th', { class: 'num' }, 'Wins'),
    h('th', { class: 'num' }, 'Pts'),
    h('th', { class: 'num' }, 'Gap'),
  );
  const leader = rows[0].points;
  const body = rows.map((r) => {
    const out = !eligible.get(r.id);
    const delta = r.change
      ? h('span', { class: r.change > 0 ? 'up' : 'down' }, `${r.change > 0 ? '▲' : '▼'}${Math.abs(r.change)}`)
      : null;
    const added = r.added ? h('span', { class: 'added' }, `+${r.added}`) : null;
    return h(
      'tr',
      { class: out ? 'out' : '', title: out ? 'Mathematically out of the title fight' : '' },
      h('td', { class: 'pos' }, String(r.position), delta),
      h(
        'td',
        { class: 'name' },
        h('i', { class: 'stripe', style: `background:${teamColor(isDriver ? r.teamId : r.id)}` }),
        isDriver ? h('span', {}, r.name, h('small', {}, ` ${r.code}`)) : r.name,
      ),
      isDriver ? h('td', { class: 'hide-sm muted' }, r.team) : null,
      h('td', { class: 'num' }, String(r.wins)),
      h('td', { class: 'num strong' }, String(r.points), added),
      h('td', { class: 'num muted' }, r.position === 1 ? '—' : `-${leader - r.points}`),
    );
  });
  return h('table', { class: 'standings' }, h('thead', {}, head), h('tbody', {}, body));
}

function standingsViews(projection) {
  const { remaining } = state.season;
  const driverFlags = canStillWin(projection.drivers, maxRemaining(remaining));
  const teamFlags = canStillWin(projection.constructors, maxRemaining(remaining, { perTeam: true }));
  return [
    h('section', { class: 'card' }, h('h2', {}, 'Drivers'), standingsTable(projection.drivers, { kind: 'driver', flags: driverFlags })),
    h('section', { class: 'card' }, h('h2', {}, 'Constructors'), standingsTable(projection.constructors, { kind: 'team', flags: teamFlags })),
  ];
}

// ---------- season tab: the dashboard ----------

const pill = (...children) => h('span', { class: 'pill' }, ...children);

function leaderCard(maxLeft) {
  const { drivers, remaining } = state.season;
  const leader = drivers[0];
  const second = drivers[1];
  // Anyone who could still catch the leader if they won everything left
  const fight = drivers.filter((d) => d.points + maxLeft >= leader.points).slice(0, 8);
  const lead = second ? leader.points - second.points : 0;

  const rows = fight.map((d) =>
    h(
      'div',
      { class: 'fight-row' },
      h('span', { class: 'fight-code' }, d.code),
      h('div', { class: 'bar' }, h('i', { style: `width:${(d.points / leader.points) * 100}%;background:${teamColor(d.teamId)}` })),
      h('span', { class: 'muted num' }, d === leader ? 'leader' : `−${leader.points - d.points}`),
    ),
  );
  return h(
    'section',
    { class: 'card leader-card' },
    h(
      'div',
      { class: 'leader-top' },
      h(
        'div',
        { class: 'leader-main' },
        h('span', { class: 'eyebrow' }, remaining.length ? 'Championship leader' : 'World champion'),
        h('div', { class: 'bignum num' }, String(leader.points)),
        h('div', {}, h('div', { class: 'leader-name' }, leader.name), h('div', { class: 'muted' }, `${leader.team} · ${leader.wins} win${leader.wins === 1 ? '' : 's'}${lead ? ` · ${lead} points clear` : ''}`)),
      ),
      remaining.length ? h('div', { class: 'fight' }, h('span', { class: 'eyebrow' }, 'Still in the title fight'), ...rows) : null,
    ),
    remaining.length
      ? h('div', { class: 'pills' }, pill(h('b', { class: 'num' }, String(maxLeft)), ' points still on offer'), drivers.length > fight.length ? pill(`${drivers.length - fight.length} drivers are out of reach`) : null)
      : null,
  );
}

function nextRaceCard() {
  const { remaining, season, drivers } = state.season;
  if (!remaining.length) {
    return h('section', { class: 'card next-card' }, h('span', { class: 'eyebrow' }, `${season} season`), h('h2', { class: 'next-title' }, 'Season complete'), h('p', { class: 'muted' }, `${drivers[0].name} is the world champion.`));
  }
  const next = remaining[0];
  const shape = state.shapes[next.circuitId];
  const map = h('div', { class: 'trackmap next-map' });
  if (shape) map.innerHTML = trackSvg(shape.line);
  const facts = shape ? [pill(h('b', { class: 'num' }, (shape.length / 1000).toFixed(3)), ' km'), shape.opened ? pill('Opened ', h('b', { class: 'num' }, String(shape.opened))) : null, shape.altitude != null ? pill(h('b', { class: 'num' }, String(shape.altitude)), ' m altitude') : null] : [];
  const date = new Date(`${next.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return h(
    'section',
    { class: 'card next-card' },
    h('span', { class: 'eyebrow' }, `Next · Round ${next.round} · ${date}`),
    h('h2', { class: 'next-title' }, next.name.replace(' Grand Prix', ' GP')),
    h('span', { class: 'muted' }, `${next.circuit} · ${next.locality}`),
    shape ? map : null,
    h('div', { class: 'pills' }, facts),
    h(
      'div',
      { class: 'next-actions' },
      h('button', { onclick: () => { state.trackView.trackId = next.circuitId; selectTab('tracks'); } }, 'Track history'),
      h('button', { class: 'ghost', onclick: () => selectTab('whatif') }, 'Play it out'),
    ),
  );
}

function playCards() {
  const podium = h('div', { class: 'mini-podium', 'aria-hidden': 'true' }, h('i', { class: 'p2' }), h('i', { class: 'p1' }), h('i', { class: 'p3' }));
  const tokens = h('div', { class: 'mini-tokens', 'aria-hidden': 'true' }, ['Schumacher 2004', 'Rosberg 2016', 'Vettel 2013'].map((t, i) => h('span', { class: 'mini-token', style: `--team:${['#e8002d', '#27f4d2', '#3671c6'][i]}` }, t)));
  const card = (tab, title, text, art) =>
    h('button', { class: 'play-card', onclick: () => selectTab(tab) }, h('div', {}, h('span', { class: 'eyebrow' }, 'Play'), h('span', { class: 'play-title' }, title), h('span', { class: 'muted' }, text)), art);
  return h(
    'div',
    { class: 'play-band' },
    card('whatif', 'What-if', 'Drag the remaining races into place and watch the title swing.', podium),
    card('dream', 'Dream Grid', 'Draft five legends from every era and chase a perfect season.', tokens),
  );
}

function renderStandings() {
  const { season, completedRound, drivers, constructors, races, remaining } = state.season;
  const base = projectStandings({ drivers, constructors, scenario: {} });
  const left = remaining.length;
  const maxLeft = maxRemaining(remaining);

  const pips = h('div', { class: 'pips' }, races.map((r) => h('i', { class: r.round <= completedRound ? 'done' : r.round === completedRound + 1 ? 'next' : '', title: `Round ${r.round}: ${r.name}` })));
  return h(
    'div',
    { class: 'dash' },
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('span', { class: 'eyebrow' }, `${season} Formula 1 season`), h('h1', { class: 'page-title' }, 'Championship')),
      h('div', { class: 'progress' }, h('div', { class: 'progress-top' }, h('span', { class: 'eyebrow' }, `Round ${completedRound} of ${races.length}`), h('span', { class: 'muted' }, left ? `${left} race${left === 1 ? '' : 's'} to go` : 'Season complete')), pips),
    ),
    h('div', { class: 'dash-hero' }, leaderCard(maxLeft), nextRaceCard()),
    h('div', { class: 'grid' }, ...standingsViews(base)),
    playCards(),
  );
}

// ---------- track map ----------

/** Card with the circuit's outline and basic facts, or null when we have no outline for it. */
function trackMapCard(race) {
  const shape = state.shapes[race.circuitId];
  if (!shape) return null;
  const map = h('div', { class: 'trackmap' });
  map.innerHTML = trackSvg(shape.line); // markup is built from numbers only
  const facts = [`${(shape.length / 1000).toFixed(3)} km`, shape.opened ? `opened ${shape.opened}` : null, shape.altitude != null ? `${shape.altitude} m altitude` : null];
  return h('section', { class: 'card' }, h('h2', {}, shortTrack(race.circuit), ' ', h('span', { class: 'muted' }, `· ${race.locality}, ${race.country}`)), map, h('p', { class: 'muted map-facts' }, facts.filter(Boolean).join(' · ')));
}

// ---------- drivers tab ----------

const fmtPos = (p) => (p == null ? '—' : `P${p}`);
const fmtAvg = (v) => (v == null ? '—' : `P${v.toFixed(1)}`);

/** Green for strong averages, red for weak ones. */
function heat(avg) {
  const t = Math.min(Math.max((avg - 1) / 19, 0), 1);
  return `hsl(${Math.round(130 - t * 130)} 55% 40% / .28)`;
}

function matrixCell(s) {
  if (!s.starts) return h('td', { class: 'cell empty' }, '—');
  if (s.avgFinish == null) return h('td', { class: 'cell' }, h('b', { class: 'down' }, 'DNF'), h('small', {}, `${s.starts}×`));
  return h(
    'td',
    { class: 'cell', style: `background:${heat(s.avgFinish)}` },
    h('b', {}, fmtAvg(s.avgFinish)),
    h('small', {}, `best ${fmtPos(s.best)} · ${s.starts}×`),
  );
}

function eraSummary(rows) {
  const byEra = groupByEra(rows);
  const head = h('tr', {}, h('th', {}, 'Era'), ['Starts', 'Poles', 'Wins', 'Podiums', 'Avg quali', 'Avg finish', 'DNFs'].map((t) => h('th', { class: 'num' }, t)));
  const body = ERAS.map((era) => {
    const s = summarize(byEra[era.id]);
    return h(
      'tr',
      { class: s.starts ? '' : 'muted' },
      h('td', {}, h('b', {}, era.label), h('small', { class: 'muted' }, ` ${era.caption}`)),
      h('td', { class: 'num' }, String(s.starts)),
      h('td', { class: 'num' }, s.starts ? String(s.poles) : '—'),
      h('td', { class: 'num' }, s.starts ? String(s.wins) : '—'),
      h('td', { class: 'num' }, s.starts ? String(s.podiums) : '—'),
      h('td', { class: 'num' }, fmtAvg(s.avgQuali)),
      h('td', { class: 'num' }, fmtAvg(s.avgFinish)),
      h('td', { class: 'num' }, s.starts ? String(s.dnfs) : '—'),
    );
  });
  return h('table', { class: 'standings compact' }, h('thead', {}, head), h('tbody', {}, body));
}

function trackDetail(entry) {
  const { circuit } = entry;
  const title = h('h2', {}, `${circuit.circuit} `, h('span', { class: 'muted' }, `· ${circuit.country}`));
  if (!entry.rows.length) return h('section', { class: 'card' }, title, h('p', { class: 'muted' }, 'No starts here in the 1994+ era.'));

  const blocks = ERAS.filter((era) => entry.eras[era.id].starts).map((era) => {
    const e = entry.eras[era.id];
    const rows = e.rows.map((r) =>
      h(
        'tr',
        {},
        h('td', {}, String(r.year)),
        h('td', { class: 'muted' }, r.team),
        h('td', { class: 'num' }, r.quali ? `P${r.quali}` : '—'),
        h('td', { class: 'num' }, r.grid ? `P${r.grid}` : 'pit'),
        h('td', { class: `num ${r.position === 1 ? 'win' : ''}` }, r.position != null ? `P${r.position}` : 'DNF'),
        h('td', { class: 'num muted' }, r.position != null ? String(r.points) : r.status),
      ),
    );
    return h(
      'div',
      { class: 'era-block' },
      h('div', { class: 'era-head' }, h('b', {}, era.label), h('small', { class: 'muted' }, `${e.starts} start${e.starts === 1 ? '' : 's'} · avg ${fmtAvg(e.avgFinish)} · ${e.wins} win${e.wins === 1 ? '' : 's'}`)),
      h('table', { class: 'standings compact' }, h('thead', {}, h('tr', {}, ['Year', 'Team', 'Quali', 'Grid', 'Finish', 'Pts / status'].map((t, i) => h('th', { class: i > 1 ? 'num' : '' }, t)))), h('tbody', {}, rows)),
    );
  });
  return h('section', { class: 'card' }, title, blocks);
}

/** A driver's history entry ({status, rows?, error?}); the first call starts the fetch and re-renders when it lands. */
function historyFor(driverId) {
  let entry = state.histories.get(driverId);
  if (!entry) {
    entry = { status: 'loading' };
    state.histories.set(driverId, entry);
    const done = (result) => {
      state.histories.set(driverId, result);
      if (state.tab === 'drivers' || state.tab === 'h2h') rerender();
    };
    loadDriverHistory(driverId).then(
      (rows) => done({ status: 'ready', rows }),
      (err) => done({ status: 'error', error: err.message }),
    );
  }
  return entry;
}

/** A loading / error message while any of these drivers' histories aren't ready, else null. */
function historyNotice(drivers) {
  const entries = drivers.map((d) => [d, historyFor(d.id)]);
  const failed = entries.find(([, e]) => e.status === 'error');
  if (failed) {
    const [d, e] = failed;
    const retry = () => {
      state.histories.delete(d.id);
      rerender();
    };
    return h('p', { class: 'status error' }, `Couldn't load ${d.name}'s history: ${e.error} `, h('button', { class: 'ghost', onclick: retry }, 'Retry'));
  }
  const loading = entries.filter(([, e]) => e.status === 'loading').map(([d]) => d.name);
  return loading.length ? h('p', { class: 'status' }, `Loading race history for ${loading.join(' and ')}…`) : null;
}

function renderDrivers() {
  const { drivers, races } = state.season;
  const driver = drivers.find((d) => d.id === state.driverId) ?? drivers[0];
  state.driverId = driver.id;

  const picker = h(
    'select',
    {
      'aria-label': 'Driver',
      onchange: (e) => {
        state.driverId = e.target.value;
        rerender();
      },
    },
    drivers.map((d) => h('option', { value: d.id, selected: d.id === driver.id }, `${d.name} · ${d.team}`)),
  );
  const root = h('div', {}, pageHeader('Career by era', 'Drivers', 'Every driver since 1994, split into regulation eras, at every circuit on this year\'s calendar.'), h('div', { class: 'picker' }, h('label', {}, 'Driver ', picker)));

  const history = historyFor(driver.id);
  const notice = historyNotice([driver]);
  if (notice) {
    root.append(notice);
    return root;
  }

  // Calendar circuits are keyed by circuitId, in calendar order.
  const matrix = trackMatrix(history.rows, races);
  const selected = matrix.find((m) => m.circuit.circuitId === state.trackId) ?? matrix.find((m) => m.all.starts) ?? matrix[0];

  const matrixTable = h(
    'table',
    { class: 'standings matrix' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Track'), ERAS.map((e) => h('th', { class: 'num', title: e.caption }, e.label)), h('th', { class: 'num' }, 'All'))),
    h(
      'tbody',
      {},
      matrix.map((m) =>
        h(
          'tr',
          { class: `pick ${m === selected ? 'selected' : ''}`, onclick: () => { state.trackId = m.circuit.circuitId; rerender(); revealOnPhone('.col-right'); } },
          h('td', { class: 'name' }, h('span', {}, m.circuit.circuit.replace(/ (Circuit|International Circuit)$/, '')), h('small', { class: 'muted' }, ` R${m.circuit.round}`)),
          ERAS.map((e) => matrixCell(m.eras[e.id])),
          matrixCell(m.all),
        ),
      ),
    ),
  );

  root.append(
    h('p', { class: 'lede' }, `Average finish (retirements excluded), best result and starts at each ${state.season.season} circuit, split by regulation era. Click a track for every race. Poles are P1 in the qualifying data, which can differ slightly from official counts (sprint weekends) and has gaps in some older seasons.`),
    h(
      'div',
      { class: 'whatif' },
      h('div', { class: 'col-left wide' }, h('section', { class: 'card' }, h('h2', {}, 'Career by era'), eraSummary(history.rows)), h('section', { class: 'card' }, h('h2', {}, `${state.season.season} circuits`), matrixTable)),
      h('div', { class: 'col-right' }, trackMapCard(selected.circuit), trackDetail(selected)),
    ),
  );
  return root;
}

// ---------- head-to-head tab ----------

const shortTrack = (name) => name.replace(/ (Grand Prix Circuit|International Circuit|Circuit|Grand Prix)$/, '');
const fmtResult = (r) => `${r.quali ? `P${r.quali}` : '—'} → ${r.position != null ? `P${r.position}` : 'DNF'}`;

/** "3–1" with the leading side coloured: .side-a / .side-b. */
function record(a, b) {
  return h('span', { class: 'record' }, h('b', { class: a > b ? 'side-a' : '' }, String(a)), '–', h('b', { class: b > a ? 'side-b' : '' }, String(b)));
}

function renderH2H() {
  const { drivers, races } = state.season;
  const h2h = state.h2h;
  h2h.a = drivers.some((d) => d.id === h2h.a) ? h2h.a : drivers[0].id;
  h2h.b = drivers.some((d) => d.id === h2h.b) ? h2h.b : drivers[1]?.id ?? drivers[0].id;
  const A = drivers.find((d) => d.id === h2h.a);
  const B = drivers.find((d) => d.id === h2h.b);

  const driverSelect = (label, side, cls) =>
    h(
      'label',
      { class: cls },
      `${label} `,
      h(
        'select',
        { 'aria-label': label, onchange: (e) => { h2h[side] = e.target.value; rerender(); } },
        drivers.map((d) => h('option', { value: d.id, selected: d.id === h2h[side] }, d.name)),
      ),
    );
  const trackSelect = h(
    'label',
    {},
    'Track ',
    h(
      'select',
      { 'aria-label': 'Track', onchange: (e) => { h2h.trackId = e.target.value; rerender(); } },
      h('option', { value: 'all', selected: h2h.trackId === 'all' }, 'All 2026 circuits'),
      races.map((r) => h('option', { value: r.circuitId, selected: h2h.trackId === r.circuitId }, shortTrack(r.circuit))),
    ),
  );
  const root = h('div', {}, pageHeader('Compare', 'Head-to-head', 'Two drivers, every race they both started.'), h('div', { class: 'picker h2h-picker' }, driverSelect('Driver A', 'a', 'side-a'), h('span', { class: 'vs' }, 'vs'), driverSelect('Driver B', 'b', 'side-b'), trackSelect));

  if (A.id === B.id) {
    root.append(h('p', { class: 'status' }, 'Pick two different drivers.'));
    return root;
  }
  const notice = historyNotice([A, B]);
  if (notice) {
    root.append(notice);
    return root;
  }

  const all = sharedRaces(historyFor(A.id).rows, historyFor(B.id).rows);
  const entries = h2h.trackId === 'all' ? all : all.filter((e) => e.circuitId === h2h.trackId);
  const scope = h2h.trackId === 'all' ? 'all 2026 circuits' : shortTrack(races.find((r) => r.circuitId === h2h.trackId)?.circuit ?? h2h.trackId);
  // "All circuits" only counts tracks on this year's calendar, like the rest of the app.
  const calendar = new Set(races.map((r) => r.circuitId));
  const scoped = h2h.trackId === 'all' ? entries.filter((e) => calendar.has(e.circuitId)) : entries;
  const total = summarizeH2H(scoped);

  const scoreboard = h(
    'section',
    { class: 'card score' },
    h('div', { class: 'score-names' }, h('span', { class: 'side-a' }, A.name), h('span', { class: 'side-b' }, B.name)),
    h('div', { class: 'score-main' }, record(total.finishA, total.finishB)),
    h(
      'p',
      { class: 'muted' },
      total.shared
        ? `Finished ahead, over ${total.shared} shared race${total.shared === 1 ? '' : 's'} at ${scope}` + (total.teammates ? ` (${total.teammates} as teammates)` : '')
        : `They never started a race together at ${scope} (1994 onwards).`,
    ),
    total.shared ? h('p', { class: 'muted' }, 'Qualified ahead: ', record(total.qualiA, total.qualiB), ' · Avg finish: ', h('b', { class: 'side-a' }, fmtAvg(total.a.avgFinish)), ' v ', h('b', { class: 'side-b' }, fmtAvg(total.b.avgFinish))) : null,
  );

  const eraRows = h2hByEra(scoped).map((e) =>
    e.shared
      ? h('tr', {}, h('td', {}, h('b', {}, e.era.label)), h('td', { class: 'num' }, String(e.shared)), h('td', { class: 'num' }, record(e.finishA, e.finishB)), h('td', { class: 'num' }, record(e.qualiA, e.qualiB)), h('td', { class: 'num' }, fmtAvg(e.a.avgFinish)), h('td', { class: 'num' }, fmtAvg(e.b.avgFinish)))
      : h('tr', { class: 'muted' }, h('td', {}, e.era.label), h('td', { class: 'num' }, '0'), h('td', { class: 'num' }, '—'), h('td', { class: 'num' }, '—'), h('td', { class: 'num' }, '—'), h('td', { class: 'num' }, '—')),
  );
  const eraTable = h(
    'table',
    { class: 'standings compact' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Era'), h('th', { class: 'num' }, 'Races'), h('th', { class: 'num' }, 'Finish'), h('th', { class: 'num' }, 'Quali'), h('th', { class: 'num side-a' }, 'Avg A'), h('th', { class: 'num side-b' }, 'Avg B'))),
    h('tbody', {}, eraRows),
  );

  const raceRows = [...scoped].reverse().map((e) =>
    h(
      'tr',
      {},
      h('td', {}, String(e.year)),
      h('td', { class: 'muted' }, shortTrack(races.find((r) => r.circuitId === e.circuitId)?.circuit ?? e.raceName.replace(' Grand Prix', ''))),
      h('td', { class: `num ${e.finishAhead === 'a' ? 'lead-a' : ''}` }, fmtResult(e.a)),
      h('td', { class: `num ${e.finishAhead === 'b' ? 'lead-b' : ''}` }, fmtResult(e.b)),
      h('td', { class: 'num muted' }, e.teammates ? 'team-mates' : `${e.a.team} / ${e.b.team}`),
    ),
  );
  const raceTable = raceRows.length
    ? h('table', { class: 'standings compact' }, h('thead', {}, h('tr', {}, h('th', {}, 'Year'), h('th', {}, 'Track'), h('th', { class: 'num side-a' }, 'A quali → finish'), h('th', { class: 'num side-b' }, 'B quali → finish'), h('th', { class: 'num' }, 'Teams'))), h('tbody', {}, raceRows))
    : h('p', { class: 'muted' }, 'No shared races.');

  const trackRows = h2hByTrack(all, races).map((t) =>
    h(
      'tr',
      { class: `pick ${h2h.trackId === t.circuit.circuitId ? 'selected' : ''}`, onclick: () => { h2h.trackId = t.circuit.circuitId; rerender(); revealOnPhone('.score'); } },
      h('td', { class: 'name' }, shortTrack(t.circuit.circuit)),
      h('td', { class: 'num muted' }, String(t.shared)),
      h('td', { class: 'num' }, t.shared ? record(t.finishA, t.finishB) : h('span', { class: 'muted' }, '—')),
    ),
  );
  const trackTable = h('table', { class: 'standings compact' }, h('thead', {}, h('tr', {}, h('th', {}, 'Track'), h('th', { class: 'num' }, 'Races'), h('th', { class: 'num' }, 'Finish'))), h('tbody', {}, trackRows));

  root.append(
    h('p', { class: 'lede' }, 'Only races both drivers started. A classified finish beats a retirement; two retirements count for neither. Qualifying positions are missing for some races, which then count for neither driver.'),
    h(
      'div',
      { class: 'whatif' },
      h('div', { class: 'col-left wide' }, scoreboard, h('section', { class: 'card' }, h('h2', {}, 'By era'), eraTable), h('section', { class: 'card' }, h('h2', {}, 'Race by race'), raceTable)),
      h('div', { class: 'col-right' }, h2h.trackId === 'all' ? null : trackMapCard(races.find((r) => r.circuitId === h2h.trackId)), h('section', { class: 'card' }, h('h2', {}, 'By track · click to focus'), h('p', { class: 'link-row' }, h('button', { class: 'link', onclick: () => { h2h.trackId = 'all'; rerender(); revealOnPhone('.score'); } }, 'Show all circuits')), trackTable)),
    ),
  );
  return root;
}

// ---------- tracks tab ----------

/** Like historyFor, but for a circuit's results: starts the fetch once and re-renders the Tracks tab when it lands. */
function circuitFor(circuitId) {
  let entry = state.circuits.get(circuitId);
  if (!entry) {
    entry = { status: 'loading' };
    state.circuits.set(circuitId, entry);
    const done = (result) => {
      state.circuits.set(circuitId, result);
      if (state.tab === 'tracks') rerender();
    };
    loadCircuit(circuitId).then(
      (data) => done({ status: 'ready', ...data }),
      (err) => done({ status: 'error', error: err.message }),
    );
  }
  return entry;
}

function winnersBlock({ era, winners, top }) {
  if (!winners.length) return null;
  const rows = winners.map((w) =>
    h(
      'tr',
      {},
      h('td', {}, String(w.year)),
      h('td', { class: 'name' }, w.driverName),
      h('td', { class: 'muted' }, w.team),
      h('td', { class: `num ${w.pole === w.driverName ? 'win' : 'muted'}` }, w.pole ? (w.pole === w.driverName ? 'from pole' : w.pole) : '—'),
    ),
  );
  return h(
    'div',
    { class: 'era-block' },
    h('div', { class: 'era-head' }, h('b', {}, era.label), h('small', { class: 'muted' }, `${winners.length} race${winners.length === 1 ? '' : 's'} · most wins: ${top.driverName} (${top.wins})`)),
    h('table', { class: 'standings compact' }, h('thead', {}, h('tr', {}, h('th', {}, 'Year'), h('th', {}, 'Winner'), h('th', {}, 'Team'), h('th', { class: 'num' }, 'Pole'))), h('tbody', {}, rows)),
  );
}

function renderTracks() {
  const { races, drivers } = state.season;
  const tv = state.trackView;
  const race = races.find((r) => r.circuitId === tv.trackId) ?? races.find((r) => r.round === state.season.completedRound + 1) ?? races[0];
  tv.trackId = race.circuitId;

  const picker = h(
    'select',
    { 'aria-label': 'Track', onchange: (e) => { tv.trackId = e.target.value; rerender(); } },
    races.map((r) => h('option', { value: r.circuitId, selected: r.circuitId === race.circuitId }, `R${r.round} · ${shortTrack(r.circuit)} (${r.country})`)),
  );
  const root = h('div', {}, pageHeader('Circuits', 'Tracks', 'Who has won here, and how this year\'s grid has done, era by era.'), h('div', { class: 'picker' }, h('label', {}, 'Track ', picker)));

  const data = circuitFor(race.circuitId);
  if (data.status === 'loading') {
    root.append(h('p', { class: 'status' }, `Loading results for ${shortTrack(race.circuit)} (can take a few seconds the first time)…`));
    return root;
  }
  if (data.status === 'error') {
    root.append(h('p', { class: 'status error' }, `Couldn't load track data: ${data.error} `, h('button', { class: 'ghost', onclick: () => { state.circuits.delete(race.circuitId); rerender(); } }, 'Retry')));
    return root;
  }

  const raceCount = new Set(data.rows.map((r) => `${r.year}-${r.round}`)).size;
  const firstYear = raceCount ? Math.min(...data.rows.map((r) => r.year)) : null;
  const stats = driverTrackStats(data.rows, drivers);
  // Drivers with a classified average first (best average on top), then retirements-only, then no starts.
  const rank = ({ all }) => (all.avgFinish != null ? all.avgFinish : all.starts ? 100 : 200);
  const sorted = [...stats].sort((a, b) => rank(a) - rank(b) || a.driver.name.localeCompare(b.driver.name));

  const gridRows = sorted.map((s) =>
    h(
      'tr',
      {},
      h('td', { class: 'name' }, h('i', { class: 'stripe', style: `background:${teamColor(s.driver.teamId)}` }), h('span', {}, s.driver.name)),
      ERAS.map((e) => matrixCell(s.eras[e.id])),
      matrixCell(s.all),
    ),
  );
  const gridTable = h(
    'table',
    { class: 'standings matrix' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Driver'), ERAS.map((e) => h('th', { class: 'num', title: e.caption }, e.label)), h('th', { class: 'num' }, 'All'))),
    h('tbody', {}, gridRows),
  );

  const winnerBlocks = trackWinners(data.rows, data.poles)
    .filter((e) => e.winners.length)
    .reverse()
    .map(winnersBlock);

  root.append(
    h(
      'p',
      { class: 'lede' },
      `${race.circuit}, ${race.locality}, ${race.country}. ` + (raceCount ? `${raceCount} Grands Prix here since ${firstYear > 1994 ? firstYear : 1994} (1994 onwards).` : 'No Grands Prix here in the 1994+ era.'),
    ),
    h(
      'div',
      { class: 'whatif' },
      h('div', { class: 'col-left wide' }, h('section', { class: 'card' }, h('h2', {}, `${state.season.season} grid at this track`), gridTable)),
      h('div', { class: 'col-right' }, trackMapCard(race), h('section', { class: 'card' }, h('h2', {}, 'Winners'), winnerBlocks.length ? winnerBlocks : h('p', { class: 'muted' }, 'No races yet.'))),
    ),
  );
  return root;
}

// ---------- shell ----------

function rerender() {
  if (!state.season) return; // tabs can be clicked while the season is still loading; init() renders afterwards
  const app = document.getElementById('app');
  const scroll = window.scrollY; // keep the scroll position across re-renders
  const views = { standings: renderStandings, drivers: renderDrivers, h2h: renderH2H, tracks: renderTracks, whatif: () => renderWhatIf({ state, save: saveScenario }), dream: () => renderDreamGrid({ state }) };
  app.replaceChildren(views[state.tab]());
  window.scrollTo(0, scroll);
}

function selectTab(tab) {
  state.tab = tab;
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  rerender();
  window.scrollTo(0, 0);
}

async function init() {
  document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  try {
    [state.season, state.shapes] = await Promise.all([loadSeason(), loadTrackShapes()]);
  } catch (err) {
    document.getElementById('app').replaceChildren(h('p', { class: 'status error' }, `Couldn't load F1 data: ${err.message}`));
    return;
  }
  const saved = loadScenario();
  // Only restore picks for rounds that are still in the future, for the same season.
  if (saved.season === state.season.season) {
    const futureRounds = new Set(state.season.remaining.map((r) => String(r.round)));
    state.scenario = Object.fromEntries(Object.entries(saved.rounds || {}).filter(([round]) => futureRounds.has(round)));
  }
  document.getElementById('meta').textContent = `${state.season.season} season · after round ${state.season.completedRound}`;
  rerender();
}

init();
