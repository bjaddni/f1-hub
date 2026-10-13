// What-if: a drag-and-drop championship game. Drag drivers onto a race's finishing grid and watch the standings react.
import { h, teamColor, isTouch } from './ui.js';
import {
  RACE_POINTS,
  SPRINT_POINTS,
  projectStandings,
  maxRemaining,
  canStillWin,
  orderFromStandings,
  placeDriver,
  removeDriver,
  chaosOrder,
  titleClinch,
} from './sim.js';

// Kept at module level so the chosen race and view survive switching tabs.
const ui = { round: null, session: 'race', selected: null, kind: 'drivers' };

// Chips use the host city: "Brazilian" or "United States" read poorly as a tab label.
const cityName = (race) => race.locality || race.name.replace(/ Grand Prix$/, '');
const TABLES = { race: RACE_POINTS, sprint: SPRINT_POINTS };

export function renderWhatIf({ state, save }) {
  const { drivers, constructors, remaining } = state.season;
  if (!remaining.length) return h('p', { class: 'status' }, 'The season is over: nothing left to simulate.');

  if (!remaining.some((r) => r.round === ui.round)) ui.round = remaining[0].round;
  let dragId = null;

  const banner = h('section', { class: 'wi-banner' });
  const strip = h('div', { class: 'wi-strip' });
  const board = h('section', { class: 'card wi-board' });
  const standingsPanel = h('section', { class: 'card wi-standings' });
  const root = h('div', { class: 'wi' }, banner, h('div', { class: 'wi-main' }, h('div', { class: 'wi-left' }, strip, board), standingsPanel));

  const race = () => remaining.find((r) => r.round === ui.round);
  const orderOf = (round, session) => state.scenario[round]?.[session] ?? [];
  const byId = new Map(drivers.map((d) => [d.id, d]));

  // ---------- editing ----------

  /** Apply a change to the order of the race/session being edited. */
  function edit(change) {
    if (ui.session === 'sprint' && !race().hasSprint) ui.session = 'race';
    const size = TABLES[ui.session].length;
    const entry = (state.scenario[ui.round] ||= { race: [], sprint: [] });
    entry[ui.session] = change(entry[ui.session] ?? [], size);
    ui.selected = null;
    save();
    refresh();
  }

  function fillEverything(makeOrder) {
    state.scenario = Object.fromEntries(
      remaining.map((r) => [r.round, { race: makeOrder(RACE_POINTS.length), sprint: r.hasSprint ? makeOrder(SPRINT_POINTS.length) : [] }]),
    );
    ui.selected = null;
    save();
    refresh();
  }

  const standingOrder = drivers.map((d) => d.id);

  // ---------- drag and drop ----------

  function dropZone(el, onDrop) {
    el.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('over');
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) el.classList.remove('over');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('over');
      const id = dragId;
      dragId = null;
      if (id) onDrop(id);
    });
  }

  function draggable(el, id) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      dragId = id;
      e.dataTransfer.setData('text/plain', id); // some browsers refuse to start a drag without data
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => el.classList.add('dragging'));
    });
    el.addEventListener('dragend', () => {
      dragId = null;
      el.classList.remove('dragging');
      root.querySelectorAll('.over').forEach((n) => n.classList.remove('over'));
    });
  }

  // ---------- pieces ----------

  function slot(index, driverId) {
    const table = TABLES[ui.session];
    const d = driverId ? byId.get(driverId) : null;
    const el = h(
      'div',
      { class: `wi-slot${d ? ' filled' : ''}${index < 3 ? ` podium p${index + 1}` : ''}${d && ui.selected === d.id ? ' selected' : ''}`, 'data-pos': index + 1 },
      h('span', { class: 'wi-pos' }, `P${index + 1}`),
      d
        ? h(
            'div',
            { class: 'wi-card', style: `--team:${teamColor(d.teamId)}`, title: `${d.name} · ${d.team}` },
            h('b', {}, d.code),
            h('span', { class: 'wi-card-name' }, d.name.split(' ').slice(-1)[0]),
            h('button', { class: 'wi-x', 'aria-label': `Remove ${d.name}`, onclick: (e) => { e.stopPropagation(); edit((o, n) => removeDriver(o, n, d.id)); } }, '×'),
          )
        : h('span', { class: 'wi-empty' }, 'drop here'),
      h('span', { class: 'wi-pts' }, `+${table[index]}`),
    );
    if (d) draggable(el.querySelector('.wi-card'), d.id);
    dropZone(el, (id) => edit((o, n) => placeDriver(o, n, index, id)));
    el.addEventListener('click', () => {
      if (ui.selected) edit((o, n) => placeDriver(o, n, index, ui.selected));
      else if (d) {
        ui.selected = d.id;
        refresh();
      }
    });
    return el;
  }

  function chip(d) {
    // A div rather than a <button>: Firefox won't start a drag from a button.
    const toggle = () => {
      ui.selected = ui.selected === d.id ? null : d.id;
      refresh();
    };
    const el = h(
      'div',
      {
        class: `wi-chip-driver${ui.selected === d.id ? ' selected' : ''}`,
        role: 'button',
        tabindex: '0',
        style: `--team:${teamColor(d.teamId)}`,
        'aria-pressed': String(ui.selected === d.id),
        title: `${d.name} · ${d.team}`,
        onclick: toggle,
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        },
      },
      h('b', {}, d.code),
      h('small', {}, `${d.points}`),
    );
    draggable(el, d.id);
    return el;
  }

  // ---------- rendering ----------

  function renderBanner(projection) {
    const lead = projection.drivers[0];
    const second = projection.drivers[1];
    const picks = Object.values(state.scenario).some((e) => e.race?.some(Boolean) || e.sprint?.some(Boolean));
    const clinch = (kind) => titleClinch({ drivers, constructors, scenario: state.scenario, remaining, kind });
    const dClinch = picks ? clinch('driver') : null;
    const cClinch = picks ? clinch('constructor') : null;
    const name = (id) => byId.get(id)?.name ?? id;
    const teamName = (id) => constructors.find((c) => c.id === id)?.name ?? id;

    const headline = !picks
      ? h('p', { class: 'wi-headline' }, 'Drag drivers onto the grid and see how the championship could play out.')
      : dClinch
        ? h('p', { class: 'wi-headline' }, h('span', { class: 'wi-trophy' }, '🏆'), ` ${name(dClinch.id)} clinches the title at the ${dClinch.race.name}`)
        : h('p', { class: 'wi-headline' }, `Title not decided yet: ${lead.name} leads ${second.name} by ${lead.points - second.points}`);

    const sub = [
      h('span', { class: 'wi-pill' }, picks ? 'Projected leader ' : 'Leader today ', h('b', {}, `${lead.code} ${lead.points}`), picks && lead.points !== state.season.drivers[0].points ? h('em', {}, `+${lead.added}`) : null),
      cClinch ? h('span', { class: 'wi-pill' }, '🏆 Constructors: ', h('b', {}, teamName(cClinch.id)), ` at ${cClinch.race.name.replace(/ Grand Prix$/, ' GP')}`) : null,
      h('span', { class: 'wi-pill muted' }, `${remaining.length} races · up to ${maxRemaining(remaining)} pts each`),
    ];

    banner.replaceChildren(
      h('div', { class: 'wi-banner-text' }, headline, h('div', { class: 'wi-pills' }, sub)),
      h(
        'div',
        { class: 'wi-global' },
        h('button', { onclick: () => fillEverything((n) => orderFromStandings(drivers, n)) }, 'Hold position'),
        h('button', { onclick: () => fillEverything((n) => chaosOrder(standingOrder, n)) }, '🎲 Chaos season'),
        h('button', { class: 'ghost', onclick: () => { state.scenario = {}; ui.selected = null; save(); refresh(); } }, 'Reset'),
      ),
    );
  }

  function renderStrip() {
    strip.replaceChildren(
      ...remaining.map((r) => {
        const filled = orderOf(r.round, 'race').filter(Boolean).length;
        const done = filled === RACE_POINTS.length;
        return h(
          'button',
          { class: `wi-chip${r.round === ui.round ? ' active' : ''}${done ? ' done' : ''}`, onclick: () => { ui.round = r.round; ui.selected = null; if (!r.hasSprint) ui.session = 'race'; refresh(); } },
          h('small', {}, `R${r.round}`),
          h('b', {}, cityName(r)),
          h('span', { class: 'wi-dots', 'aria-label': `${filled} of ${RACE_POINTS.length} places set` }, h('i', { style: `width:${(filled / RACE_POINTS.length) * 100}%` })),
          r.hasSprint ? h('em', { class: 'badge' }, 'Sprint') : null,
        );
      }),
    );
  }

  function renderBoard() {
    const r = race();
    if (ui.session === 'sprint' && !r.hasSprint) ui.session = 'race';
    const table = TABLES[ui.session];
    const order = Array.from({ length: table.length }, (_, i) => orderOf(r.round, ui.session)[i] ?? null);
    const placed = new Set(order.filter(Boolean));
    const pool = drivers.filter((d) => !placed.has(d.id));

    const poolEl = h(
      'div',
      { class: 'wi-pool' },
      pool.length ? pool.map(chip) : h('p', { class: 'muted wi-pool-empty' }, 'Everyone is on the grid'),
    );
    dropZone(poolEl, (id) => edit((o, n) => removeDriver(o, n, id)));

    board.replaceChildren(
      h(
        'div',
        { class: 'wi-board-head' },
        h('div', {}, h('h2', {}, `R${r.round} · ${r.name}`), h('small', { class: 'muted' }, `${r.circuit} · ${r.date}`)),
        r.hasSprint
          ? h('div', { class: 'wi-seg' }, ['sprint', 'race'].map((s) => h('button', { class: ui.session === s ? 'active' : '', onclick: () => { ui.session = s; ui.selected = null; refresh(); } }, s === 'sprint' ? 'Sprint' : 'Race')))
          : null,
      ),
      h(
        'div',
        { class: 'wi-actions' },
        h('button', { class: 'link', onclick: () => edit((o, n) => orderFromStandings(drivers, n)) }, 'Current order'),
        h('button', { class: 'link', onclick: () => edit((o, n) => chaosOrder(standingOrder, n)) }, '🎲 Random result'),
        h('button', { class: 'link', onclick: () => edit(() => []) }, 'Clear'),
      ),
      h('div', { class: 'wi-podium' }, [1, 0, 2].filter((i) => i < table.length).map((i) => slot(i, order[i]))),
      h('div', { class: 'wi-rest' }, order.slice(3).map((id, i) => slot(i + 3, id))),
      h('div', { class: 'wi-pool-head' }, h('b', {}, 'Drivers'), h('small', { class: 'muted' }, ui.selected ? (isTouch() ? 'Now tap a position' : 'Now click a position') : isTouch() ? 'Tap a driver, then tap a position' : 'Drag onto a position, or click a driver and then a position')),
      poolEl,
    );
  }

  // Standings rows persist between refreshes so they can slide to their new places (FLIP animation).
  const rowEls = new Map();
  const standingsList = h('div', { class: 'wi-rows' });
  const tabBtn = (kind, label) => h('button', { class: ui.kind === kind ? 'active' : '', onclick: () => { ui.kind = kind; rowEls.clear(); standingsList.replaceChildren(); refresh(); } }, label);
  const standingsHead = h('div', { class: 'wi-standings-head' });
  standingsPanel.append(standingsHead, standingsList);

  function makeRow() {
    const el = h('div', { class: 'wi-row' });
    el.parts = {
      pos: h('span', { class: 'wi-rpos' }),
      move: h('span', { class: 'wi-move' }),
      name: h('span', { class: 'wi-rname' }),
      bar: h('i'),
      pts: h('b', { class: 'wi-rpts' }),
      add: h('em', { class: 'wi-radd' }),
    };
    el.append(el.parts.pos, el.parts.move, el.parts.name, h('span', { class: 'wi-bar' }, el.parts.bar), el.parts.pts, el.parts.add);
    return el;
  }

  function renderStandings(projection) {
    const isDriver = ui.kind === 'drivers';
    const rows = projection[ui.kind];
    const flags = canStillWin(rows, maxRemaining(remaining, { perTeam: !isDriver }));
    const top = rows[0].points || 1;

    standingsHead.replaceChildren(h('h2', {}, 'Projected standings'), h('div', { class: 'wi-seg' }, tabBtn('drivers', 'Drivers'), tabBtn('constructors', 'Constructors')));

    const before = new Map([...rowEls].map(([id, el]) => [id, el.getBoundingClientRect().top]));
    rows.forEach((r) => {
      let el = rowEls.get(r.id);
      if (!el) rowEls.set(r.id, (el = makeRow()));
      const p = el.parts;
      el.style.setProperty('--team', teamColor(isDriver ? r.teamId : r.id));
      el.classList.toggle('out', !flags.get(r.id));
      p.pos.textContent = String(r.position);
      p.move.textContent = r.change ? `${r.change > 0 ? '▲' : '▼'}${Math.abs(r.change)}` : '';
      p.move.className = `wi-move ${r.change > 0 ? 'up' : r.change < 0 ? 'down' : ''}`;
      p.name.textContent = r.name;
      p.bar.style.width = `${(r.points / top) * 100}%`;
      p.pts.textContent = String(r.points);
      p.add.textContent = r.added ? `+${r.added}` : '';
      if (el.lastPoints !== undefined && el.lastPoints !== r.points) {
        el.classList.remove('flash');
        void el.offsetWidth; // restart the animation
        el.classList.add('flash');
      }
      el.lastPoints = r.points;
      standingsList.append(el); // re-appending moves it into the new order
    });
    for (const [id, el] of rowEls) {
      if (!rows.some((r) => r.id === id)) {
        el.remove();
        rowEls.delete(id);
      }
    }

    // FLIP: jump each row back to where it was, then let it slide to where it is now.
    for (const [id, el] of rowEls) {
      const was = before.get(id);
      if (was === undefined) continue;
      const delta = was - el.getBoundingClientRect().top;
      if (!delta) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform .4s cubic-bezier(.2,.8,.2,1)';
        el.style.transform = '';
      });
    }
  }

  function refresh() {
    const projection = projectStandings({ drivers, constructors, scenario: state.scenario });
    renderBanner(projection);
    renderStrip();
    renderBoard();
    renderStandings(projection);
  }

  // Escape drops the current selection.
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.selected) {
      ui.selected = null;
      refresh();
    }
  });

  refresh();
  return root;
}
