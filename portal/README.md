# LotSpotlight portal

The customer-facing site (app.lotspotlight.com, SiteGround): sign-in, dealers, roles, audit log, and the job API the
video worker on the Ubuntu server calls. Spec: [docs/lotspotlight-architecture.md](../docs/lotspotlight-architecture.md).
Milestone 1 (foundations) is what is here now.

- `src/` — Express app (Node ≥ 22, MySQL 8). `src/lib/jobs.js` is the queue, `src/lib/hmac.js` the worker signatures.
- `migrations/` — SQL applied in order by `npm run migrate` (the server also applies them when it starts).
- `web/` — React front end (Vite), built into `public/` with `npm run build` (not committed).
- `test/` — `npm test`. Tests that need a database use `TEST_DATABASE_URL`, an empty database they may wipe;
  without it they are skipped.

The worker side lives with the video app: `node/src/lib/portal-client.js` (signing, lease → run → complete/fail,
heartbeats) and `node/src/cli/portal-worker.js` (the loop; settings PORTAL_API, WORKER_ID, WORKER_SECRET). It is not
started by any service yet.

## Run it locally

1. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `TEST_DATABASE_URL` and `WORKER_SHARED_SECRETS`.
2. `npm ci`, then `npm run build` (front end) and `npm start` → http://localhost:3000.
3. First account: `npm run create-user -- --email you@example.com --name "Your Name" --staff` (password asked twice, hidden).
4. Worker against it: set `PORTAL_API=http://localhost:3000/api/worker`, `WORKER_ID` and `WORKER_SECRET` (one pair from
   `WORKER_SHARED_SECRETS`), then `node ../node/src/cli/portal-worker.js`. "Send test job" (staff only) should show
   **done** within a few seconds.

## Rules

- Roles are checked on the server: staff (eShield) → every dealer; owner > admin > approver > viewer per dealer.
- Every change from the browser needs JSON and the session's `X-CSRF-Token`.
- Worker requests need a valid HMAC signature within 300 s; video files never pass through the portal.
- Never commit `.env` or secrets.
