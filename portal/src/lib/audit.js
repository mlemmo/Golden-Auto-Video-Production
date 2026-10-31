// Audit log: one row per sign-in, dealer or membership change, and (later) every publish, ad change, approval and Meta connect.
import { json } from './db.js';

export async function audit(db, { dealerId = null, userId = null, action, targetType = null, targetId = null, details = null, ip = null }) {
  await db.query(
    'INSERT INTO audit_log (dealer_id, user_id, action, target_type, target_id, details_json, ip) VALUES (?,?,?,?,?,?,?)',
    [dealerId, userId, action, targetType, targetId === null ? null : String(targetId), json(details), ip],
  );
}

export async function auditList(db, dealerId, limit = 100) {
  const [rows] = await db.query(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.details_json AS details, a.ip, a.created_at, u.email AS user_email
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.dealer_id = ? ORDER BY a.id DESC LIMIT ?`,
    [dealerId, limit],
  );
  return rows;
}
