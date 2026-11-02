# LotSpotlight — Architecture & Build Spec (for Claude Code)

> Save this file in the repo as `docs/lotspotlight-architecture.md`.
> Repo: `mlemmo/Golden-Auto-Video-Production` · Work on the `siteground` branch (replaced `nodejs` on 2026-11-02; never `staging` or `main` without asking).
> Owner: Mark Lemmo (mark@lotspotlight.com)
> Last updated: 2026-10-31

---

## 0. Instructions for Claude Code

1. **Read the existing code first.** The current system is the Node.js video app (`node/`, `web/`) on an Ubuntu server (the PHP version and the Node.js port branch are retired; see CLAUDE.md). Inventory what already exists (inventory import, script generation, voice, avatar/lip-sync, ffmpeg composition, Meta code) and **reuse it** rather than rewriting.
2. Before writing code, reply with: (a) what you found, (b) any conflicts with this spec, (c) a step-by-step plan for Milestone 1. Wait for approval.
3. Small, reviewable commits. Each commit message says which milestone/task it covers.
4. **Never commit secrets.** All keys go in `.env` (git-ignored); maintain `.env.example` with placeholder values.
5. Where this spec says **TBD** or **ASK**, stop and ask Mark — don't guess.
6. Node is installed via **nvm** on the server. Target the current Node LTS.

---

## 1. What we're building

**LotSpotlight** turns every car on a dealer's lot into a ~20–30 s vertical video with an AI spokesperson, captions and the car's photos, verifies the facts, then posts it to Facebook/Instagram and runs Meta ads — automatically.

- **Customer #1 / pilot:** Golden Auto (San Ramon, mygoldenauto.net), inventory from DealerCenter.
- **Phase 2:** multi-dealer SaaS sold by eShield. Design multi-tenant from day one (every row has a `dealer_id`).

Tagline: *"Every car in the spotlight."*

---

## 2. Architecture

```
Dealers / staff ──HTTPS──► PORTAL  app.lotspotlight.com   (SiteGround Node.js + MySQL)
                            • auth, dealers, users, roles
                            • Meta OAuth (Facebook Login for Business) + token storage
                            • video review/approval, publish to FB/IG, ads (Marketing API)
                            • job queue (MySQL), signed download links
                                 ▲  pull jobs / post results (HTTPS, HMAC)
                                 │
                            WORKER  node.mygoldenauto.net  (Ubuntu, later worker.lotspotlight.com)
                            • DealerCenter feed polling + photo download
                            • script → voice → avatar/lip-sync → ffmpeg compose
                            • verification gate (facts vs. live inventory)
                            • stores MP4s, serves them via Nginx signed URLs (or bucket)
                                 │
                            AI providers (voice, avatar, lip-sync)  ·  Meta fetches video by URL
```

### Hard rules
- **Video files never pass through the portal.** The portal only stores metadata and URLs.
- **Meta tokens live only on the portal.** The worker never sees them.
- **The worker initiates all connections** (pull model). It needs no inbound ports except 443 for serving signed video URLs (or none, if a bucket is used).
- **Every publish/ad action requires a passed verification record** for that exact video + inventory snapshot.

### SiteGround constraints (portal)
- Node.js projects on GrowBig/GoGeek/Cloud; GitHub auto-deploy from a branch.
- **No WebSockets** → the dashboard polls for job status (every 5–10 s).
- No root, no ffmpeg, no custom ports, fixed resource slice → keep it lightweight; no long-running background loops.
- MySQL (or PostgreSQL) available; **no MongoDB**.
- Don't rely on SiteGround for scheduled jobs; schedules live on the worker.

---

## 3. Domains, URLs & email

| Purpose | Value |
| --- | --- |
| Marketing site | `https://lotspotlight.com` (TBD — can start as a simple page) |
| Portal | `https://app.lotspotlight.com` |
| Worker (now) | `https://node.mygoldenauto.net` → Nginx → `127.0.0.1:4343` |
| Worker (later) | `https://worker.lotspotlight.com` |
| Meta OAuth callback | `https://app.lotspotlight.com/auth/facebook/callback` |
| Privacy policy | `https://app.lotspotlight.com/privacy` |
| Terms | `https://app.lotspotlight.com/terms` |
| Data deletion | `https://app.lotspotlight.com/data-deletion` (instructions page + callback endpoint) |
| Contact / Meta developer email | `mark@lotspotlight.com` (Microsoft 365) |

---

## 4. Data model (MySQL)

All tables: `id` (BIGINT PK), `created_at`, `updated_at`. All tenant data carries `dealer_id`.

```sql
dealers           (id, name, slug, website, timezone, status, dms_type, dms_config_json,
                   spokesperson_id, voice_id, brand_json, created_at, updated_at)
users             (id, email UNIQUE, password_hash, name, mfa_secret NULL, status, ...)
dealer_users      (dealer_id, user_id, role ENUM('owner','admin','approver','viewer'))
meta_connections  (id, dealer_id, business_id, page_id, ig_user_id, ad_account_id,
                   catalog_id, pixel_id, token_encrypted, token_type ENUM('system_user','user'),
                   token_expires_at NULL, scopes, status, ...)
vehicles          (id, dealer_id, vin, stock_no, year, make, model, trim, mileage, price,
                   status ENUM('active','sold','removed'), photos_json, features_json,
                   source_hash, last_seen_at, ...)            UNIQUE(dealer_id, vin)
videos            (id, dealer_id, vehicle_id, kind ENUM('vehicle','price_drop','roundup','brand'),
                   script_text, status ENUM('queued','rendering','rendered','verifying',
                   'needs_review','approved','rejected','published','failed'),
                   storage_key, public_url NULL, duration_s, inventory_snapshot_json, ...)
verifications     (id, video_id, passed BOOL, checks_json, reviewer_user_id NULL,
                   reviewed_at NULL, ...)
jobs              (id, dealer_id, type ENUM('render_video','verify_video','sync_inventory',
                   'rerender_price_drop'), payload_json, status ENUM('queued','leased',
                   'done','failed'), attempts, leased_by NULL, lease_expires_at NULL,
                   result_json NULL, error NULL, ...)
publications      (id, video_id, channel ENUM('facebook','instagram'), external_id,
                   permalink, status, published_at, error NULL)
ad_campaigns      (id, dealer_id, meta_campaign_id, kind ENUM('prospecting','retargeting',
                   'price_drop'), special_ad_category NULL, daily_budget_cents, status, ...)
ads               (id, ad_campaign_id, video_id NULL, meta_ad_id, status, ...)
audit_log         (id, dealer_id NULL, user_id NULL, action, target_type, target_id,
                   details_json, ip, created_at)
```

- Encrypt `meta_connections.token_encrypted` at rest (AES-256-GCM, key in `.env`).
- `audit_log` every publish, ad change, approval, token connect/disconnect.

---

## 5. Portal ↔ Worker job API

Base: `https://app.lotspotlight.com/api/worker`

### Authentication
- Each worker has `WORKER_ID` + `WORKER_SECRET`.
- Every request carries headers:
  `X-Worker-Id`, `X-Timestamp` (unix seconds), `X-Signature` = hex HMAC-SHA256 of `timestamp + "\n" + method + "\n" + path + "\n" + sha256(body)` using `WORKER_SECRET`.
- Reject if timestamp skew > 300 s or signature mismatch. Optional IP allowlist.

### Endpoints
| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/jobs/lease` | Body `{types:[...], max:1}` → leases the oldest queued job (sets `leased_by`, `lease_expires_at = now+15min`). Returns `204` if none. |
| `POST` | `/jobs/:id/heartbeat` | Extends the lease during long renders. |
| `POST` | `/jobs/:id/complete` | Body `{result}` → marks done, updates `videos`/`verifications`. |
| `POST` | `/jobs/:id/fail` | Body `{error, retryable}` → requeue with backoff (max 3 attempts) or fail. |
| `POST` | `/inventory/sync` | Worker pushes normalized vehicle records after a DMS pull (upsert by `dealer_id+vin`; mark missing as `sold`). |
| `GET` | `/dealers/:id/config` | Spokesperson, voice, branding, disclaimers for rendering. |

Expired leases return to `queued` automatically (checked on each `/jobs/lease` call — no cron needed on SiteGround).

### Worker loop
```
every 10–30 s:
  job = POST /jobs/lease
  if none: sleep
  else: run handler, heartbeat every 2 min, POST complete|fail
every 30 min (per dealer): sync_inventory from DealerCenter → POST /inventory/sync
on new/changed vehicle: portal enqueues render_video (or rerender_price_drop)
```
Run the worker under **systemd** (or pm2) with restart-on-failure; log to journald.

---

## 6. Video pipeline (worker)

1. **Inventory import** — DealerCenter XML export (**ASK: export URL/format still pending**). Fallback: scrape the dealer website inventory feed. Download photos from the CDN. Normalize to the `vehicles` shape.
2. **Script** — 20–30 s, year/make/model/trim, mileage, price, 2–3 standout features, dealer name, CTA. Template + LLM; never invent features not in the feed.
3. **Voice** — TTS provider (**ASK which**; ElevenLabs used before).
4. **Spokesperson + lip-sync** — avatar provider + separate lip-sync model (**ASK which**; Higgsfield/ElevenLabs output previously needed a separate lip-sync step).
5. **Compose (ffmpeg)** — 1080×1920, spokesperson + photo sequence, burned-in captions matching narration, price card, dealer logo, required disclaimer: *"Plus tax, title and fees. See dealer for details."*
6. **Verification gate** (`verify_video` job) — must pass before `approved`:
   - price, mileage, year, make, model, trim in script/captions == **live** vehicle record (re-fetch, not cached);
   - vehicle still `active` (block if sold);
   - captions == narration text;
   - disclaimer present whenever a price or payment is shown;
   - financing language detected → flag `special_ad_category = FINANCIAL_PRODUCTS_SERVICES` for any ad;
   - until auto-checks are trusted: status `needs_review` → one-click human approve in portal.
7. **Store** — MP4 to storage; return `storage_key`. Public URL = short-lived signed URL (Nginx `secure_link` on worker, or bucket pre-signed URL).

---

## 7. Meta integration (portal)

- **Developer app:** Business type, name "LotSpotlight", owned by the LotSpotlight Business Portfolio.
- **Facebook Login for Business** with a Configuration (`META_CONFIG_ID`). Routes:
  - `GET /auth/facebook/login` → redirect to Meta with `config_id`, `state` (CSRF, stored in session).
  - `GET /auth/facebook/callback` → verify `state`, exchange `code` for token, fetch Pages / IG account / ad accounts, save to `meta_connections` (encrypted).
- **Publishing:** Page video/Reel and Instagram Reel via Graph API using `public_url` (Meta pulls the file).
- **Ads (Marketing API):** create/update campaigns per `ad_campaigns.kind`; Automotive Inventory Ads use the dealer's vehicle catalog + product-level video. Financing/payment ads **must** set the Financial Products and Services special ad category (no ZIP, min 15-mile radius, no lookalikes, all ages/genders).
- **Pixel + Conversions API:** send lead events server-side.
- **Data deletion:** `/data-deletion` page (instructions) + `POST /auth/facebook/data-deletion` (verify signed_request, delete dealer's Meta data, return `{url, confirmation_code}`).
- **App Review:** build a demo mode that walks each permission (Page publish, IG publish, `ads_management`, `ads_read`) for screencasts.
- **Access level note:** Standard access works for Golden Auto's own accounts; managing other dealers' ad accounts needs Advanced access (App Review + ≥1,500 Marketing API calls and <15% error rate over 15 days). Log API call counts/errors to track this.

---

## 8. Portal UI (MVP)

- Login (email + password, MFA optional), password reset.
- Dealer switcher (for eShield staff); roles enforced server-side.
- **Inventory** list with video status per car.
- **Review queue:** video player, verification checklist, Approve / Reject (+ reason) / Re-render.
- **Published** list with FB/IG links and basic stats.
- **Ads:** campaign on/off, daily budget, simple results (spend, leads, CPL).
- **Settings:** Meta connect/disconnect, spokesperson/voice choice, branding, disclaimers.
- Status updates by polling (no WebSockets).

---

## 9. Environment variables

`.env.example` (portal):
```
NODE_ENV=production
APP_URL=https://app.lotspotlight.com
DATABASE_URL=mysql://user:pass@localhost:3306/lotspotlight
SESSION_SECRET=
TOKEN_ENCRYPTION_KEY=          # 32-byte base64
META_APP_ID=
META_APP_SECRET=
META_CONFIG_ID=
META_GRAPH_VERSION=            # pin a current version
WORKER_SHARED_SECRETS=         # workerId:secret,workerId:secret
MAIL_FROM=no-reply@lotspotlight.com
```
`.env.example` (worker):
```
PORTAL_API=https://app.lotspotlight.com/api/worker
WORKER_ID=
WORKER_SECRET=
STORAGE_DIR=/srv/lotspotlight/videos
SIGNED_URL_SECRET=
SIGNED_URL_BASE=https://node.mygoldenauto.net/v
TTS_API_KEY=
AVATAR_API_KEY=
LIPSYNC_API_KEY=
LLM_API_KEY=
DEALERCENTER_FEED_URL=         # per dealer later; in dealer config
```

---

## 10. Server setup (worker, Ubuntu)

- Nginx terminates TLS (Let's Encrypt via certbot) and proxies to `127.0.0.1:4343`; Node binds to **127.0.0.1 only**; `app.set('trust proxy', 1)`.
- Firewall: allow 22, 80, 443 only.
- `location /v/` uses Nginx `secure_link` (md5 + expiry) to serve MP4s from `STORAGE_DIR`.
- ffmpeg installed via apt; verify version in startup check.
- Future option: move worker to AWS Lightsail (General Purpose 4 GB, us-west-2) — keep the worker stateless apart from `STORAGE_DIR` so it's easy to move.

---

## 11. Milestones

**M1 — Foundations (portal skeleton + job API)**
- Portal Express app, MySQL migrations for §4, auth, dealer/user/roles, audit log.
- Worker job API (§5) with HMAC auth + lease/heartbeat/complete/fail.
- Worker loop skeleton that leases a dummy job and completes it.
- ✅ Done when: a test job round-trips portal → worker → portal; tests pass.

**M2 — Pipeline on the worker**
- Port/reuse existing render code into `render_video` handler; inventory sync (fallback scraper if no XML yet).
- Verification gate + `needs_review` flow; signed video URLs.
- ✅ Done when: a Golden Auto car produces a verified MP4 visible in the review queue.

**M3 — Meta**
- Facebook Login for Business, token storage, Page + IG Reel publishing, data-deletion + privacy/terms pages.
- ✅ Done when: an approved video publishes to Golden Auto FB + IG from the portal.

**M4 — Ads + measurement**
- Prospecting, retargeting (catalog/inventory ads) and price-drop campaigns; special ad category handling; Pixel/CAPI lead events; basic stats.
- ✅ Done when: a $5 test ad goes live from the portal and leads are recorded.

**M5 — Multi-dealer readiness**
- Dealer onboarding flow, per-dealer config, second DMS adapter interface, App Review demo mode, call/error metrics for Advanced access.

---

## 12. Testing & quality

- Unit tests for HMAC signing, lease logic, verification checks (price/mileage mismatch, sold car, missing disclaimer, financing detection).
- Integration test: fake DealerCenter feed → render (mock providers) → verify → approve.
- Lint + format on commit. No feature merges without tests for the verification gate.

---

## 13. Open questions (ASK Mark)

1. DealerCenter XML export: URL, auth, field list, update frequency.
2. Which TTS, avatar and lip-sync providers to standardize on (and their API keys).
3. Video storage: worker disk + Nginx signed URLs, or a Lightsail/S3 bucket?
4. SiteGround plan level and whether app.lotspotlight.com DNS is on SiteGround or Cloudflare.
5. Portal framework preference (plain Express + server-rendered views vs. a React front end).
6. Which existing PHP features must keep running during the migration.
