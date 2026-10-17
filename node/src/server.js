// Golden Auto Node service. Ported dashboard actions answer here as POST /api/node/<action>, with the same JSON in
// and out as the PHP dashboard's ?api=<action>; Nginx sends /api/node/ to this service and everything else to PHP
// (see node/README.md). Sign-in is checked by PHP (src/lib/auth.js) until login itself moves. No npm dependencies.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { checkAuth, HttpError } from './lib/auth.js';
import { loadConfig } from './lib/config.js';
import { openDb } from './lib/db.js';
import { clientRoutes } from './routes/clients.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4350);
const MAX_BODY = 1 << 20;

// action → handler(ctx), ctx = { cfg, db, client, body, req }. A plain Error is a user-facing message (HTTP 400,
// like PHP's RuntimeException); HttpError carries its own status; anything else is a 500 that is logged, not shown.
export const actions = { ...clientRoutes };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new HttpError(413, 'Request is too large.'); chunks.push(c); }
  const text = Buffer.concat(chunks).toString('utf8');
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
  try {
    const cfg = loadConfig();
    const { client } = await checkAuth(req, process.env.NODE_AUTH_URL ?? String(cfg.public_base_url).replace(/\/$/, '') + '/node_auth.php');
    const body = await readJson(req);
    send(res, 200, await handler({ cfg, db: openDb(cfg), client, body, req }));
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    if (userError(e)) return send(res, 400, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Internal error' });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, HOST, () => console.log(`golden-auto-node listening on http://${HOST}:${PORT}`));
}
