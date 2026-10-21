// Usage tracking: one row per thing someone did (who, which client, what, when, details), in agent.sqlite table
// activity. The admin's Usage dashboard reads it (usageReport). History from before tracking (videos, voice
// previews and lip-sync jobs already saved) is imported once, marked backfilled, with "before accounts" as the user
// when no approver was recorded.
import { str, toFloat } from './text.js';
import { jsonEncode } from './storedjson.js';
import { CLIENT_DEFAULT } from './clients.js';

export const BEFORE_ACCOUNTS = 'before accounts';
// Estimated provider cost per paid action (USD). Change with config cost_estimates.
export const DEFAULT_COSTS = { generate_30: 9.71, generate_15: 4.86, narration_preview: 0, narration_lipsync: 0, spokesperson_picture: 0.15, generate_1080_factor: 1.385 };
// The kinds of activity the dashboard counts, and the actions behind them.
export const KINDS = { generate: 'AI videos', narration_preview: 'Voice previews', narration_lipsync: 'Lip-syncs', footage_build: 'Footage videos' };

function table(db) {
  const fresh = !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='activity'").get();
  db.exec(`CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT NOT NULL,
    client TEXT NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_at ON activity(at)`);
  if (fresh) backfillActivity(db);
}
const iso = (d = new Date()) => d.toISOString();

/** Record one activity. detail: small facts about it (car, length, …), never secrets. */
export function recordActivity(db, { user, client, action, detail = {}, at = iso() }) {
  table(db);
  db.prepare('INSERT INTO activity (at, user, client, action, payload) VALUES (?,?,?,?,?)').run(at, str(user), str(client ?? ''), str(action), jsonEncode(detail));
}

/** Import what was made before tracking started (runs once, when the activity table is created). */
export function backfillActivity(db) {
  const rows = [];
  const read = (t) => { try { return db.prepare(`SELECT payload FROM ${t}`).all().map((r) => JSON.parse(r.payload)); } catch { return []; } };
  for (const j of read('jobs')) {
    const action = j.provider === 'footage' ? 'footage_build' : j.provider === 'fal_lipsync' ? null : 'generate';
    if (action && j.created_at) rows.push({ at: j.created_at, user: j.approved_by || BEFORE_ACCOUNTS, client: j.client ?? CLIENT_DEFAULT, action, detail: { stock: j.stock, vehicle: j.vehicle, duration: j.duration, voice: j.voice, backfilled: true } });
  }
  for (const n of read('narrations')) if (n.created_at) rows.push({ at: n.created_at, user: n.approved_by || BEFORE_ACCOUNTS, client: n.client ?? CLIENT_DEFAULT, action: 'narration_preview', detail: { stock: n.stock, vehicle: n.vehicle, duration: n.duration, backfilled: true } });
  for (const l of read('narration_lipsync')) if (l.created_at) rows.push({ at: l.created_at, user: l.approved_by || BEFORE_ACCOUNTS, client: l.client ?? CLIENT_DEFAULT, action: 'narration_lipsync', detail: { stock: l.stock, vehicle: l.vehicle, backfilled: true } });
  rows.sort((a, b) => a.at.localeCompare(b.at));
  for (const r of rows) recordActivity(db, { ...r, at: iso(new Date(r.at)) });
  return rows.length;
}

/** Estimated cost of one activity row. */
export function costOf(row, costs) {
  if (row.action === 'generate') return toFloat(Number(row.detail.duration) >= 30 ? costs.generate_30 : costs.generate_15) * (row.detail.resolution === '1080p' ? toFloat(costs.generate_1080_factor ?? 1.385) : 1);
  return toFloat(costs[row.action] ?? 0);
}

/**
 * The Usage dashboard's data: totals, per user, per client, per day (paid kinds), and recent activity, for the last
 * `days` days (0 = all time), optionally one client and/or one user.
 */
export function usageReport(db, cfg, { days = 30, client = '', user = '' } = {}, now = new Date()) {
  table(db);
  const costs = { ...DEFAULT_COSTS, ...(cfg.cost_estimates ?? {}) };
  const since = days > 0 ? iso(new Date(now.getTime() - days * 86400000)) : '';
  const all = db.prepare('SELECT at, user, client, action, payload FROM activity WHERE at >= ? ORDER BY at').all(since)
    .map((r) => ({ ...r, detail: JSON.parse(r.payload) }))
    .filter((r) => (!client || r.client === client) && (!user || r.user === user));
  const blank = () => ({ sign_ins: 0, failed_sign_ins: 0, generate: 0, narration_preview: 0, narration_lipsync: 0, footage_build: 0, finish: 0, deletes: 0, cost: 0, last_active: null });
  const totals = blank(), byUser = {}, byClient = {}, byDay = {};
  for (const r of all) {
    const u = (byUser[r.user] ??= blank()), c = r.client ? (byClient[r.client] ??= blank()) : null;
    for (const t of [totals, u, c]) {
      if (!t) continue;
      if (r.action === 'sign_in') t.sign_ins++;
      else if (r.action === 'sign_in_failed') t.failed_sign_ins++;
      else if (r.action in KINDS || r.action === 'finish') { t[r.action]++; t.cost += costOf(r, costs); }
      else if (r.action === 'spokesperson_picture') t.cost += costOf(r, costs);
      else if (r.action === 'job_delete' || r.action === 'narration_delete') t.deletes++;
      if (r.action !== 'sign_in_failed') t.last_active = r.at;
    }
    if (r.action in KINDS) {
      const day = r.at.slice(0, 10), d = (byDay[day] ??= { day, generate: 0, narration_preview: 0, narration_lipsync: 0, footage_build: 0, cost: 0 });
      d[r.action]++; d.cost += costOf(r, costs);
    }
  }
  const round = (o) => ({ ...o, cost: Math.round(o.cost * 100) / 100 });
  // Every day in the period (zero days included) so the chart's time axis is even; all time starts at the first entry.
  const days_ = [];
  const first = since ? new Date(since) : all.length ? new Date(all[0].at) : now;
  for (let d = new Date(first.toISOString().slice(0, 10)); d <= now; d = new Date(d.getTime() + 86400000)) {
    const k = d.toISOString().slice(0, 10);
    days_.push(round(byDay[k] ?? { day: k, generate: 0, narration_preview: 0, narration_lipsync: 0, footage_build: 0, cost: 0 }));
  }
  return {
    days, since: since || (all[0]?.at ?? null), costs, kinds: KINDS,
    totals: { ...round(totals), active_users: Object.keys(byUser).filter((k) => k !== BEFORE_ACCOUNTS && Object.entries(byUser[k]).some(([key, v]) => key !== 'last_active' && key !== 'failed_sign_ins' && v)).length },
    users: Object.entries(byUser).map(([email, t]) => ({ email, ...round(t) })).sort((a, b) => b.cost - a.cost || (b.last_active ?? '').localeCompare(a.last_active ?? '')),
    clients: Object.entries(byClient).map(([id, t]) => ({ id, ...round(t) })).sort((a, b) => b.cost - a.cost),
    per_day: days_,
    recent: all.slice(-100).reverse().map((r) => ({ at: r.at, user: r.user, client: r.client, action: r.action, detail: r.detail, cost: Math.round(costOf(r, costs) * 100) / 100 })),
  };
}
