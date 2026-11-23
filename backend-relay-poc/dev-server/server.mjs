#!/usr/bin/env node
/**
 * Local dev server for the logging POC. No dependencies, no Azure account.
 *
 *  1. Fake API under /api/... : each route produces one kind of outcome.
 *  2. Fake Azure collector at  /v2/track : receives exactly what the real
 *     Application Insights SDK would send to Azure, prints it, checks it for
 *     data that should never leave the device, and saves it to telemetry.jsonl.
 *
 * Run:  node dev-server/server.mjs      (PORT=4040 by default)
 */
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 4040);
const OUT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'telemetry.jsonl');

// Fields the app is allowed to send (common context + logger context)
const ALLOWED = new Set([
  'source', 'appVersion', 'environment', 'platform', 'osVersion', 'sessionId', 'event',
  'feature', 'endpoint', 'status', 'errorCode', 'errorName', 'durationMs',
]);

const recent = [];
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const SEVERITY = { 0: 'VERBOSE', 1: 'INFO', 2: 'WARN', 3: 'ERROR', 4: 'CRITICAL' };
const time = () => new Date().toISOString().slice(11, 23);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ fake API
const LOANS = [
  { id: 'L-1001', amount: 250000, status: 'APPROVED' },
  { id: 'L-1002', amount: 120000, status: 'IN_REVIEW' },
];

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  console.log(c.dim(`${time()}  api  ${route}`));
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  switch (route) {
    case 'GET /api/loans':
      return json(200, LOANS);
    case 'GET /api/loans/server-error':
      return json(503, { error: 'Service unavailable', traceId: 'backend-has-the-details' });
    case 'GET /api/loans/slow':
      await sleep(3000);
      return json(200, LOANS);
    case 'GET /api/loans/hang':
      await sleep(15000); // client times out after 5 s
      return json(200, LOANS);
    case 'GET /api/loans/bad-json':
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html><body>502 Bad Gateway (proxy page)</body></html>');
    case 'GET /api/loans/not-found':
      return json(404, { error: 'Loan not found' });
    case 'GET /api/me/expired':
      return json(401, { error: 'Token expired' });
    case 'POST /api/loans/submit':
      return json(422, { error: 'Validation failed', fields: { amount: 'Too high' } });
    default:
      return json(404, { error: `No route ${route}` });
  }
}

// ------------------------------------------------------------ fake collector
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let buf = Buffer.concat(chunks);
      if ((req.headers['content-encoding'] ?? '').includes('gzip')) buf = zlib.gunzipSync(buf);
      resolve(buf.toString('utf8'));
    });
    req.on('error', reject);
  });
}

function parseEnvelopes(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed); // JSON array (SDK default)
  return trimmed.split('\n').filter(Boolean).map((line) => JSON.parse(line)); // NDJSON
}

function privacyProblems(properties) {
  const problems = [];
  for (const [key, value] of Object.entries(properties ?? {})) {
    const v = String(value);
    if (!ALLOWED.has(key)) problems.push(`unexpected field "${key}"`);
    if (/\d{6,}/.test(v) && key !== 'sessionId') problems.push(`"${key}" contains a long number`);
    if (/\s/.test(v) && key !== 'osVersion') problems.push(`"${key}" contains free text`);
  }
  return problems;
}

function printEnvelope(env) {
  const base = env?.data?.baseData ?? {};
  const type = env?.data?.baseType ?? 'unknown';
  const props = base.properties ?? {};
  const sev = SEVERITY[base.severityLevel] ?? '';
  const color = sev === 'ERROR' || sev === 'CRITICAL' ? c.red : sev === 'WARN' ? c.yellow : c.green;

  const title = type === 'MessageData' ? base.message : `${type} ${base.name ?? ''}`;
  console.log(`${c.cyan(time())}  ${color(sev.padEnd(5))}  ${c.bold(title)}`);

  const context = Object.entries(props).filter(
    ([k]) => !['source', 'appVersion', 'environment', 'platform', 'osVersion', 'sessionId', 'event'].includes(k),
  );
  if (context.length) console.log('        ' + context.map(([k, v]) => `${k}=${v}`).join('  '));
  console.log(
    c.dim(
      `        ${props.platform ?? '?'} ${props.osVersion ?? ''} · app ${props.appVersion ?? '?'} · ${props.environment ?? '?'} · session ${props.sessionId ?? '?'}`,
    ),
  );

  const problems = privacyProblems(props);
  if (problems.length) console.log(c.red(`        ⚠ privacy check: ${problems.join('; ')}`));
}

async function handleTrack(req, res) {
  try {
    const envelopes = parseEnvelopes(await readBody(req));
    for (const env of envelopes) {
      printEnvelope(env);
      recent.push(env);
      if (recent.length > 200) recent.shift();
      fs.appendFileSync(OUT_FILE, JSON.stringify(env) + '\n');
    }
    // Same response shape as the real ingestion endpoint
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ itemsReceived: envelopes.length, itemsAccepted: envelopes.length, errors: [] }));
  } catch (e) {
    console.log(c.red(`${time()}  collector: could not parse payload: ${e.message}`));
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ itemsReceived: 0, itemsAccepted: 0, errors: [{ message: e.message }] }));
  }
}

// ------------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  // CORS, harmless for native apps and useful if you test from a browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (req.method === 'POST' && /\/track\/?$/.test(url.pathname)) return handleTrack(req, res);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method === 'GET' && url.pathname === '/telemetry') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(recent, null, 2));
  }
  // Anything else: print it, so a wrong SDK endpoint path is easy to spot
  console.log(c.yellow(`${time()}  unknown request: ${req.method} ${url.pathname}`));
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(c.bold(`\nLogging POC dev server on http://localhost:${PORT}`));
  console.log(`  Fake API:        http://localhost:${PORT}/api/loans`);
  console.log(`  Fake collector:  POST http://localhost:${PORT}/v2/track`);
  console.log(`  Recent events:   http://localhost:${PORT}/telemetry`);
  console.log(`  Saved to:        ${OUT_FILE}\n`);
  console.log(c.dim('Android emulator: run `adb reverse tcp:4040 tcp:4040` once.\n'));
});
