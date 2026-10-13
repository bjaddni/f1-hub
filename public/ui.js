// Small DOM helpers shared by the views.

const TEAM_COLORS = {
  mercedes: '#27f4d2',
  ferrari: '#e8002d',
  mclaren: '#ff8000',
  red_bull: '#3671c6',
  alpine: '#ff87bc',
  williams: '#64c4ff',
  haas: '#b6babd',
  rb: '#6692ff',
  audi: '#f50537',
  cadillac: '#9aa0a6',
  aston_martin: '#229971',
};

/** Team colour; teams without a hand-picked colour (historic constructors) get a stable colour derived from their id. */
export function teamColor(id) {
  if (TEAM_COLORS[id]) return TEAM_COLORS[id];
  if (!id || id === 'unknown') return '#777';
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 55%)`;
}

/** True on phones and tablets, where "tap" is the right word and drag-and-drop is unreliable. */
export const isTouch = () => matchMedia('(pointer: coarse)').matches;

/** Tiny DOM helper: h('div', {class: 'x', onclick}, child, 'text'). Falsy props and children are skipped. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false && value != null) el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

/** The big page title every tab starts with: a small label, the title, and an optional line of context. */
export function pageHeader(eyebrow, title, sub) {
  return h('div', { class: 'page-head' }, h('div', {}, h('span', { class: 'eyebrow' }, eyebrow), h('h1', { class: 'page-title' }, title), sub ? h('span', { class: 'page-sub' }, sub) : null));
}
