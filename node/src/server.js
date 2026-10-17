// Golden Auto Node service. Ported dashboard actions answer here as POST /api/node/<action>, with the same JSON in
// and out as the PHP dashboard's ?api=<action>; Nginx sends /api/node/ to this service and everything else to PHP
// (see node/README.md). Sign-in is checked by PHP (src/lib/auth.js) until login itself moves. No npm dependencies.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { checkAuth, HttpError } from './lib/auth.js';
import { loadConfig } from './lib/config.js';
import { openDb } from './lib/db.js';
import { clientRoutes } from './routes/clients.js';
import { narrationRoutes } from './routes/narrations.js';
import { jobRoutes, MULTIPART } from './routes/jobs.js';
import { parseMultipart } from './lib/multipart.js';
import { CLIENT_DEFAULT, clientFind, clientDetails } from './lib/clients.js';
import { withSpeechSites } from './lib/speech.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4350);
const MAX_BODY = 1 << 20;
const MAX_UPLOAD = 72 * 1024 * 1024;  // Nginx client_max_body_size and PHP post_max_size

// action → handler(ctx), ctx = { cfg, db, client, dealer, body, files, req }. A plain Error is a user-facing message (HTTP 400,
// like PHP's RuntimeException); HttpError carries its own status; anything else is a 500 that is logged, not shown.
export const actions = { ...clientRoutes, ...narrationRoutes, ...jobRoutes };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function readBody(req, max) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw new HttpError(413, 'Request is too large.'); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const text = (await readBody(req, MAX_BODY)).toString('utf8');
  if (text === '') return {};
  let v;
  try { v = JSON.parse(text); } catch { throw new HttpError(400, 'Invalid request.'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Invalid request.');
  return v;
}
const userError = (e) => e instanceof Error && e.constructor === Error;

export const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/api/node/health') return send(res, 200, { ok: true, service: pkg.name, version: pkg.version, node: process.version });
  const m = path.match(/^\/api\/node\/([a-z_]+)$/);
  const handler = m && Object.hasOwn(actions, m[1]) ? actions[m[1]] : null;
  if (!handler) return send(res, 404, { error: 'Not found' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST required.' });
  let uploadDir = null;
  try {
    const cfg = loadConfig();
    const { client } = await checkAuth(req, process.env.NODE_AUTH_URL ?? String(cfg.public_base_url).replace(/\/$/, '') + '/node_auth.php');
    const db = openDb(cfg);
    let body, files = {};
    if (MULTIPART.has(m[1])) {
      uploadDir = mkdtempSync(tmpdir() + '/ga-upload-');
      ({ fields: body, files } = parseMultipart(await readBody(req, MAX_UPLOAD), req.headers['content-type'], uploadDir));
    } else body = await readJson(req);
    // Dealer named in scripts and speech for this client; its website is said as written in its details (as PHP does per request).
    const dealer = clientDetails(clientFind(db, client));
    const sites = client !== CLIENT_DEFAULT ? { [dealer.website]: dealer.website_spoken } : {};
    send(res, 200, await withSpeechSites(sites, () => handler({ cfg, db, client, dealer, body, files, req })));
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    if (userError(e)) return send(res, 400, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Internal error' });
  } finally {
    if (uploadDir) rmSync(uploadDir, { recursive: true, force: true });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, HOST, () => console.log(`golden-auto-node listening on http://${HOST}:${PORT}`));
}
