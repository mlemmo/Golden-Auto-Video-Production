// Golden Auto Node service. For now it only answers a health check; ported dashboard routes move here one area at a
// time while Nginx keeps sending everything else to the PHP dashboard (see node/README.md). No dependencies.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4350);

const routes = {
  'GET /api/node/health': () => ({ ok: true, service: pkg.name, version: pkg.version, node: process.version }),
};

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(json);
}

export const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const handler = routes[`${req.method} ${path}`];
  if (!handler) return send(res, 404, { error: 'Not found' });
  try {
    send(res, 200, handler(req));
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Internal error' });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, HOST, () => console.log(`golden-auto-node listening on http://${HOST}:${PORT}`));
}
