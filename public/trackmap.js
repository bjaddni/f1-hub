// Turns a circuit's GPS outline into an SVG. Pure: no DOM, no network.

/**
 * Fit a [lon, lat] polyline into a width x height box (north up), keeping its true proportions.
 * Longitude degrees are shrunk by cos(latitude) so a track isn't stretched sideways.
 */
export function projectLine(line, width = 400, height = 300, pad = 16) {
  const lat0 = (line.reduce((s, [, lat]) => s + lat, 0) / line.length) * (Math.PI / 180);
  const pts = line.map(([lon, lat]) => [lon * Math.cos(lat0), -lat]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((width - 2 * pad) / (maxX - minX || 1), (height - 2 * pad) / (maxY - minY || 1));
  // Centre the outline in the box
  const offX = (width - (maxX - minX) * scale) / 2;
  const offY = (height - (maxY - minY) * scale) / 2;
  return pts.map(([x, y]) => [(x - minX) * scale + offX, (y - minY) * scale + offY]);
}

/** SVG path data ("M x y L x y …") for projected points. */
export function toPath(points) {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
}

/** Complete <svg> markup for a track outline: a dark casing under a bright line. */
export function trackSvg(line, { width = 400, height = 300 } = {}) {
  const d = toPath(projectLine(line, width, height));
  return (
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Track layout">` +
    `<path d="${d}" fill="none" stroke="var(--track-casing)" stroke-width="11" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="var(--track-line)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` +
    `</svg>`
  );
}
