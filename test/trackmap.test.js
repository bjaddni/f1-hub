import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { projectLine, toPath, trackSvg } from '../public/trackmap.js';

test('projectLine keeps points inside the box, north up, and preserves proportions', () => {
  // A square-ish box near the equator: 2 degrees wide, 1 degree tall
  const pts = projectLine([[0, 0], [2, 0], [2, 1], [0, 1]], 400, 300, 10);
  for (const [x, y] of pts) {
    assert.ok(x >= 10 - 1e-9 && x <= 390 + 1e-9, `x ${x}`);
    assert.ok(y >= 10 - 1e-9 && y <= 290 + 1e-9, `y ${y}`);
  }
  const [w, h] = [pts[1][0] - pts[0][0], Math.abs(pts[3][1] - pts[0][1])];
  assert.ok(Math.abs(w / h - 2) < 0.01, 'about 2:1, as on the ground');
  assert.ok(pts[3][1] < pts[0][1], 'larger latitude is drawn higher (smaller y)');
});

test('longitude is squeezed by cos(latitude) away from the equator', () => {
  const near = projectLine([[0, 0], [1, 0], [1, 1], [0, 1]], 400, 400, 0);
  const far = projectLine([[0, 60], [1, 60], [1, 61], [0, 61]], 400, 400, 0);
  const ratio = (p) => (p[1][0] - p[0][0]) / Math.abs(p[3][1] - p[0][1]);
  assert.ok(ratio(far) < ratio(near) * 0.6);
});

test('toPath builds move/line commands', () => {
  assert.equal(toPath([[1, 2], [3.14159, 4]]), 'M1.0 2.0 L3.1 4.0');
});

test('every bundled circuit renders to a non-empty SVG', () => {
  const circuits = JSON.parse(fs.readFileSync(new URL('../public/data/circuits.json', import.meta.url), 'utf8'));
  const ids = Object.keys(circuits);
  assert.equal(ids.length, 23);
  for (const id of ids) {
    const svg = trackSvg(circuits[id].line);
    assert.ok(svg.startsWith('<svg') && svg.includes(' L'), id);
    assert.ok(!svg.includes('NaN'), `${id} has NaN coordinates`);
  }
});
