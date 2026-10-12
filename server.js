// Zero-dependency server: serves ./public and proxies Jolpica-F1 with a disk cache.
// Jolpica is rate-limited (~4 req/s, 500/h), so every upstream call is throttled and cached.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const CACHE_DIR = path.join(ROOT, '.cache');
const UPSTREAM = 'https://api.jolpi.ca/ergast/f1/';
const PORT = Number(process.env.PORT) || 3000;
// Locally, listen on this machine only. Hosts like Railway set PORT and need the server reachable from outside the container.
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

const LIVE_TTL = 5 * 60 * 1000; // current season data changes after each session
const CAREER_TTL = 60 * 60 * 1000; // career-wide queries include the current season, so they grow after each race
const HISTORY_TTL = 7 * 24 * 60 * 60 * 1000; // a past season never changes
const GAP_MS = 300; // keeps us under 4 requests/second

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let queue = Promise.resolve();
function throttled(task) {
  const run = queue.then(task);
  queue = run.catch(() => {}).then(() => sleep(GAP_MS));
  return run;
}

function ttlFor(apiPath) {
  const thisYear = new Date().getFullYear();
  const first = apiPath.split('/')[0];
  if (/^\d{4}$/.test(first)) return Number(first) < thisYear ? HISTORY_TTL : LIVE_TTL;
  return first === 'current' ? LIVE_TTL : CAREER_TTL;
}

async function readCache(file) {
  try {
    const [stat, body] = await Promise.all([fs.stat(file), fs.readFile(file, 'utf8')]);
    return { body, age: Date.now() - stat.mtimeMs };
  } catch {
    return null;
  }
}

async function fetchUpstream(apiPath, search) {
  const key = crypto.createHash('sha1').update(apiPath + search).digest('hex');
  const file = path.join(CACHE_DIR, `${key}.json`);
  const cached = await readCache(file);
  if (cached && cached.age < ttlFor(apiPath)) return cached.body;

  try {
    const body = await throttled(async () => {
      const res = await fetch(UPSTREAM + apiPath + search, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Jolpica responded ${res.status}`);
      return res.text();
    });
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(file, body);
    return body;
  } catch (err) {
    if (cached) return cached.body; // stale data beats an error page
    throw err;
  }
}

async function handleApi(url, res) {
  const apiPath = url.pathname.slice('/api/'.length);
  // Allow-list: plain Ergast-style paths only, so this can't be used as an open proxy.
  if (!/^[a-zA-Z0-9_\-/.]+$/.test(apiPath) || apiPath.includes('..') || !apiPath.endsWith('.json')) {
    res.writeHead(400).end('Bad API path');
    return;
  }
  const search = /^\?[a-zA-Z0-9=&_-]*$/.test(url.search) ? url.search : '';
  try {
    const body = await fetchUpstream(apiPath, search);
    res.writeHead(200, { 'Content-Type': MIME['.json'] }).end(body);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'text/plain' }).end(`Upstream error: ${err.message}`);
  }
}

async function handleStatic(url, res) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

http
  .createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    (url.pathname.startsWith('/api/') ? handleApi : handleStatic)(url, res);
  })
  .listen(PORT, HOST, () => console.log(`F1 Hub listening on ${HOST}:${PORT}`));
