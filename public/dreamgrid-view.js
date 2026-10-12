// Dream Grid UI: draft cards from random packs into five grid slots, then see your season record.
// Two modes: Normal drafts driver-decades; Hard drafts a driver in one single season, with the car.
import { h, teamColor } from './ui.js';
import {
  SLOTS, PACK_SIZE, REROLLS, MODES, drawPack, mulberry32, hashString, seasonRecord, shareText,
} from './dreamgrid.js';

const STORAGE_KEY = 'f1hub.dreamgrid';

// Normal-mode cards carry a colour stripe per decade: purely decorative, and says nothing about a card's strength.
const decadeColor = (decade) => `hsl(${((decade - 1950) / 10) * 52 + 200} 55% 55%)`;
const stripeColor = (card) => (card.teamId ? teamColor(card.teamId) : decadeColor(card.decade));

// Module-level so a draft in progress survives switching tabs.
const game = {
  phase: 'intro', // intro | drafting | done
  difficulty: 'normal', // key of MODES
  kind: 'random', // random | daily
  seedKey: '',
  team: [],
  round: 0,
  rerollsUsed: 0,
  pack: [],
  selected: null,
  record: null,
  newBest: false,
};
let dataset = null; // { decks: { normal, hard }, races }
let loading = null;

const emptyTeam = () => Array(SLOTS.length).fill(null);

/**
 * Saved in the browser: { plays, difficulty, bests: { normal, hard }, dailies: { normal, hard } }.
 * Each mode keeps its own best and its own daily result, since the two modes aren't comparable.
 */
function readStore() {
  try {
    const store = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return { plays: 0, bests: {}, dailies: {}, ...store };
  } catch {
    return { plays: 0, bests: {}, dailies: {} };
  }
}
function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* private mode etc.: the draft still works, scores just aren't remembered */
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/** Fetch the bundled history once and merge in the live season, so today's drivers can be drafted too. */
function loadDecks(season) {
  loading ||= fetch('/data/driver-seasons.json')
    .then((res) => {
      if (!res.ok) throw new Error(`driver-seasons.json: ${res.status}`);
      return res.json();
    })
    .then((rows) => {
      const live = season.drivers.map((d, i) => ({ y: Number(season.season), r: season.completedRound, id: d.id, n: d.name, t: d.team, c: d.teamId, pos: i + 1, p: d.points, w: d.wins }));
      const current = new Set(season.drivers.map((d) => d.id));
      const all = [...rows, ...live];
      dataset = {
        decks: Object.fromEntries(Object.values(MODES).map((mode) => [mode.id, mode.build(all, current)])),
        races: season.races.length,
      };
    })
    .catch((err) => {
      loading = null; // allow a retry
      throw err;
    });
  return loading;
}

// ---------- game flow ----------

function packRng() {
  return mulberry32(hashString(`${game.seedKey}:${game.round}:${game.rerollsUsed}`));
}

function dealPack() {
  game.pack = drawPack(dataset.decks[game.difficulty], packRng(), game.team.filter(Boolean), PACK_SIZE);
  game.selected = null;
}

function startDraft(kind) {
  game.kind = kind;
  // The daily seed includes the mode, so Normal and Hard get different packs.
  game.seedKey = kind === 'daily' ? `${game.difficulty}:${today()}` : `r${Math.random().toString(36).slice(2)}`;
  game.team = emptyTeam();
  game.round = 0;
  game.rerollsUsed = 0;
  game.record = null;
  game.newBest = false;
  game.phase = 'drafting';
  dealPack();
}

function reroll() {
  if (game.rerollsUsed >= REROLLS) return;
  game.rerollsUsed++;
  dealPack();
}

function place(slotIndex, card) {
  if (game.team[slotIndex] || !card) return;
  game.team[slotIndex] = card;
  game.round++;
  if (game.round >= SLOTS.length) finish();
  else dealPack();
}

function finish() {
  game.phase = 'done';
  game.selected = null;
  game.record = seasonRecord(game.team, dataset.races, game.difficulty);
  const store = readStore();
  store.plays += 1;
  const { wins, losses, tier } = game.record;
  const previous = store.bests[game.difficulty];
  if (!previous || wins > previous.wins) {
    game.newBest = Boolean(previous); // the very first result in a mode isn't "new"
    store.bests[game.difficulty] = { wins, losses, tier: tier.name, emoji: tier.emoji };
  }
  if (game.kind === 'daily') store.dailies[game.difficulty] = { date: today(), wins, losses };
  writeStore(store);
}

function setDifficulty(id) {
  game.difficulty = id;
  const store = readStore();
  store.difficulty = id;
  writeStore(store);
}

// ---------- view ----------

function cardEl(card, { onSelect, selected = false, draggableCard = false, dealIndex = 0, onDragStart, onDragEnd } = {}) {
  const el = h(
    'div',
    {
      class: `dg-card${selected ? ' selected' : ''}`,
      style: `--team:${stripeColor(card)};--deal:${dealIndex * 70}ms`,
      role: onSelect ? 'button' : null,
      tabindex: onSelect ? '0' : null,
      title: `${card.name} ${card.label}${card.team ? ` · ${card.team}` : ''}`,
      onclick: onSelect,
      onkeydown: onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } } : null,
    },
    // Name and era (a decade, or a year with the car in Hard). Ratings stay hidden until the season result.
    h('div', { class: 'dg-name' }, card.name),
    h('div', { class: 'dg-year' }, card.label),
    card.team ? h('div', { class: 'dg-team' }, card.team) : null,
  );
  if (draggableCard) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.key);
      e.dataTransfer.effectAllowed = 'move';
      onDragStart?.();
      requestAnimationFrame(() => el.classList.add('dragging'));
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      onDragEnd?.();
    });
  }
  return el;
}

function countUp(el, to, ms = 900) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || to === 0) {
    el.textContent = String(to);
    return;
  }
  const start = performance.now();
  // Animation frames pause in background tabs; make sure the real number always ends up on screen.
  setTimeout(() => (el.textContent = String(to)), ms + 100);
  const step = (now) => {
    const t = Math.min((now - start) / ms, 1);
    el.textContent = String(Math.round(to * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function renderDreamGrid({ state }) {
  const root = h('div', { class: 'dg' });

  function refresh() {
    if (!dataset) {
      root.replaceChildren(h('p', { class: 'status' }, 'Loading driver history…'));
      return;
    }
    const store = readStore();
    const races = dataset.races;
    const parts = [hero(store, races)];
    if (game.phase === 'intro') parts.push(intro(store));
    else parts.push(board());
    if (game.phase === 'drafting') parts.push(packPanel());
    if (game.phase === 'done') parts.push(resultPanel(races));
    root.replaceChildren(...parts);
    if (game.phase === 'done') countUp(root.querySelector('.dg-wins'), game.record.wins);
  }

  function hero(store, races) {
    const best = store.bests[game.difficulty];
    return h(
      'section',
      { class: 'dg-hero' },
      h(
        'div',
        {},
        h('h1', {}, `${races}-0`, h('span', { class: `dg-mode ${game.difficulty}` }, MODES[game.difficulty].name)),
        h('p', {}, `Build the front of the grid from every era of F1, and try to win all ${races} races.`),
      ),
      best ? h('div', { class: 'dg-best' }, h('small', {}, `Your best · ${MODES[game.difficulty].name}`), h('b', {}, `${best.emoji} ${best.wins}-${best.losses}`), h('small', {}, best.tier)) : null,
    );
  }

  function modePicker() {
    return h(
      'div',
      { class: 'dg-modes', role: 'radiogroup', 'aria-label': 'Mode' },
      Object.values(MODES).map((mode) =>
        h(
          'button',
          {
            class: `dg-modeopt${game.difficulty === mode.id ? ' active' : ''}`,
            role: 'radio',
            'aria-checked': String(game.difficulty === mode.id),
            onclick: () => { setDifficulty(mode.id); refresh(); },
          },
          h('b', {}, mode.name),
          h('small', {}, mode.blurb),
        ),
      ),
    );
  }

  function intro(store) {
    const daily = store.dailies[game.difficulty];
    const dailyDone = daily?.date === today() ? daily : null;
    return h(
      'section',
      { class: 'card dg-intro' },
      h('h2', {}, 'Pick a mode'),
      modePicker(),
      h('h2', {}, 'How it works'),
      h(
        'ol',
        {},
        h('li', {}, `Each round you get a pack of four cards. Every card is rated 0-100, but you only see a name and ${game.difficulty === 'hard' ? 'a year and the car' : 'a decade'}. Ratings are measured against that year's champion, so every era is fair, and retired legends are in the pool.`),
        h('li', {}, "Put one into a grid slot. Slots can't be changed afterwards, and the front of the grid counts for more (Pole ×1.4 down to P5 ×0.6)."),
        h('li', {}, `Not happy with a pack? You can reroll it ${REROLLS} times per draft.`),
        h('li', {}, `After five picks your lineup is turned into a season record. A perfect season takes the best ${game.difficulty === 'hard' ? 'seasons' : 'decades'} ever, in the right slots.`),
      ),
      h(
        'div',
        { class: 'dg-start' },
        h('button', { onclick: () => { startDraft('random'); refresh(); } }, `New draft · ${MODES[game.difficulty].name}`),
        h('button', { class: 'ghost', onclick: () => { startDraft('daily'); refresh(); } }, dailyDone ? `Daily draft (played: ${dailyDone.wins}-${dailyDone.losses})` : 'Daily draft'),
        h('small', { class: 'muted' }, 'The daily draft deals everyone the same packs today.'),
      ),
    );
  }

  function board() {
    const slots = SLOTS.map((slot, i) => {
      const card = game.team[i];
      const open = !card && game.phase === 'drafting';
      const el = h(
        'div',
        { class: `dg-slot${card ? ' filled' : ''}${open && game.selected ? ' ready' : ''}`, 'data-slot': i },
        h('div', { class: 'dg-slot-head' }, h('b', {}, slot.label), h('small', {}, `×${slot.weight}`)),
        card ? cardEl(card) : h('div', { class: 'dg-slot-empty' }, open ? (game.selected ? 'Place here' : 'Empty') : '—'),
      );
      if (open) {
        el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
        el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
        el.addEventListener('drop', (e) => {
          e.preventDefault();
          el.classList.remove('over');
          const dragged = game.pack.find((c) => c.key === e.dataTransfer.getData('text/plain'));
          place(i, dragged);
          refresh();
        });
        el.addEventListener('click', () => {
          if (!game.selected) return;
          place(i, game.selected);
          refresh();
        });
      }
      return el;
    });
    return h('section', { class: 'dg-board' }, slots);
  }

  function packPanel() {
    const left = REROLLS - game.rerollsUsed;
    return h(
      'section',
      { class: 'card dg-pack' },
      h(
        'div',
        { class: 'dg-pack-head' },
        h('div', {}, h('h2', {}, `Pick ${game.round + 1} of ${SLOTS.length}`), h('small', { class: 'muted' }, game.selected ? 'Now choose a slot' : 'Drag a driver onto a slot, or click one and then a slot')),
        h('button', { class: 'ghost', disabled: left === 0, onclick: () => { reroll(); refresh(); } }, `Reroll pack (${left} left)`),
      ),
      h(
        'div',
        { class: 'dg-cards' },
        game.pack.map((card, i) =>
          cardEl(card, {
            dealIndex: i,
            selected: game.selected?.key === card.key,
            draggableCard: true,
            onSelect: () => { game.selected = game.selected?.key === card.key ? null : card; refresh(); },
          }),
        ),
      ),
    );
  }

  function resultPanel(races) {
    const rec = game.record;
    const mode = MODES[game.difficulty];
    const copy = async (btn) => {
      const title = `Dream Grid ${mode.name}${game.kind === 'daily' ? ` daily ${today()}` : ''}`;
      try {
        await navigator.clipboard.writeText(shareText(game.team, rec, races, title));
        btn.textContent = 'Copied!';
      } catch {
        btn.textContent = 'Copy failed';
      }
      setTimeout(() => (btn.textContent = 'Copy result'), 1800);
    };
    const rows = SLOTS.map((slot, i) => {
      const card = game.team[i];
      return h('tr', {}, h('td', {}, h('b', {}, slot.label)), h('td', {}, card.name), h('td', { class: 'muted' }, `${card.label} · ${card.detail}`), h('td', { class: 'num' }, String(card.rating)), h('td', { class: 'num muted' }, `×${slot.weight}`));
    });
    return h(
      'section',
      { class: `card dg-result${rec.wins === races ? ' perfect' : ''}` },
      h('div', { class: 'dg-emoji' }, rec.tier.emoji),
      h('div', { class: 'dg-record' }, h('span', { class: 'dg-wins' }, '0'), h('span', { class: 'dg-dash' }, '–'), h('span', {}, String(rec.losses))),
      h('p', { class: 'dg-tier' }, rec.tier.name, h('span', { class: `dg-mode ${game.difficulty}` }, mode.name)),
      h('p', { class: 'muted' }, `Team strength ${rec.strength.toFixed(1)} · ${rec.wins} wins from ${races} races`, game.newBest ? h('b', { class: 'dg-newbest' }, ' · New personal best!') : null),
      h('table', { class: 'standings compact' }, h('thead', {}, h('tr', {}, h('th', {}, 'Slot'), h('th', {}, 'Driver'), h('th', {}, game.difficulty === 'hard' ? 'Season' : 'Decade'), h('th', { class: 'num' }, 'Rating'), h('th', { class: 'num' }, 'Weight'))), h('tbody', {}, rows)),
      h(
        'div',
        { class: 'dg-start' },
        h('button', { onclick: () => { startDraft('random'); refresh(); } }, 'Play again'),
        h('button', { class: 'ghost', onclick: (e) => copy(e.currentTarget) }, 'Copy result'),
        h('button', { class: 'ghost', onclick: () => { game.phase = 'intro'; refresh(); } }, 'Change mode'),
      ),
    );
  }

  refresh();
  if (!dataset) {
    loadDecks(state.season).then(
      () => {
        game.difficulty = MODES[readStore().difficulty] ? readStore().difficulty : game.difficulty;
        if (root.isConnected) refresh();
      },
      (err) => root.replaceChildren(h('p', { class: 'status error' }, `Couldn't load the driver history: ${err.message}`)),
    );
  }
  return root;
}
