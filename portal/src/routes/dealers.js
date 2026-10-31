// /api/dealers: dealers, their members and roles, audit log, and jobs. Roles are checked here on the server for
// every request: viewers read; owners and admins manage members; only eShield staff create dealers or send test jobs.
import { Router } from 'express';
import { HttpError } from '../lib/errors.js';
import { audit, auditList } from '../lib/audit.js';
import { ROLES, atLeast, roleAt, dealersFor, dealerMembers, findUserByEmail, createUser, ownerCount, normalEmail } from '../lib/users.js';
import { enqueueJob, listJobs } from '../lib/jobs.js';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export function dealerRoutes({ pool }) {
  const r = Router();

  const signedIn = (req) => {
    if (!req.session) throw new HttpError(401, 'Please sign in.');
    return req.session.user;
  };
  const staffOnly = (req) => {
    const user = signedIn(req);
    if (!user.is_staff) throw new HttpError(403, 'Only eShield staff can do that.');
    return user;
  };
  /** Loads the dealer in :dealerId and the caller's role there; 404 when they have none (no hint that it exists). */
  const dealerAccess = async (req, minimum) => {
    const user = signedIn(req);
    const dealerId = Number(req.params.dealerId);
    const [rows] = Number.isSafeInteger(dealerId) ? await pool.query('SELECT * FROM dealers WHERE id = ?', [dealerId]) : [[]];
    const role = rows[0] ? await roleAt(pool, user, dealerId) : null;
    if (!role) throw new HttpError(404, 'Dealer not found.');
    if (!atLeast(role, minimum)) throw new HttpError(403, 'Your role at this dealer does not allow that.');
    return { user, dealer: rows[0], role };
  };

  r.get('/', async (req, res) => res.json({ dealers: await dealersFor(pool, signedIn(req)) }));

  r.post('/', async (req, res) => {
    const user = staffOnly(req);
    const name = String(req.body?.name ?? '').trim();
    const slug = String(req.body?.slug ?? '').trim().toLowerCase();
    const website = String(req.body?.website ?? '').trim() || null;
    const timezone = String(req.body?.timezone ?? '').trim() || 'America/Los_Angeles';
    if (!name || name.length > 190) throw new HttpError(400, 'Enter the dealer name.');
    if (!SLUG.test(slug)) throw new HttpError(400, 'The short name may use lowercase letters, numbers and dashes.');
    if (website && !/^https:\/\/[^\s]+$/.test(website)) throw new HttpError(400, 'The website must start with https://');
    let id;
    try {
      [{ insertId: id }] = await pool.query('INSERT INTO dealers (name, slug, website, timezone) VALUES (?,?,?,?)', [name, slug, website, timezone]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That short name is already used.');
      throw err;
    }
    await audit(pool, { dealerId: id, userId: user.id, action: 'dealer_create', targetType: 'dealer', targetId: id, details: { name, slug }, ip: req.ip });
    res.status(201).json({ dealer: { id, name, slug, website, timezone, status: 'active' } });
  });

  r.get('/:dealerId', async (req, res) => {
    const { dealer, role } = await dealerAccess(req, 'viewer');
    res.json({ dealer, role });
  });

  r.get('/:dealerId/users', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'admin');
    res.json({ users: await dealerMembers(pool, dealer.id) });
  });

  // Adds an existing account to the dealer, or creates one (with the password given) when the email is new.
  r.post('/:dealerId/users', async (req, res) => {
    const { user, dealer, role: myRole } = await dealerAccess(req, 'admin');
    const email = normalEmail(req.body?.email);
    const role = String(req.body?.role ?? '');
    if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a role: owner, admin, approver or viewer.');
    if (role === 'owner' && !atLeast(myRole, 'owner')) throw new HttpError(403, 'Only an owner can add another owner.');
    let member = await findUserByEmail(pool, email);
    const created = !member;
    if (created) member = { id: await createUser(pool, { email, name: req.body?.name, password: req.body?.password }), email };
    try {
      await pool.query('INSERT INTO dealer_users (dealer_id, user_id, role) VALUES (?,?,?)', [dealer.id, member.id, role]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That person is already a member; change their role instead.');
      throw err;
    }
    await audit(pool, { dealerId: dealer.id, userId: user.id, action: 'member_add', targetType: 'user', targetId: member.id, details: { email, role, created }, ip: req.ip });
    res.status(201).json({ user: { id: member.id, email, role }, created });
  });

  r.patch('/:dealerId/users/:userId', async (req, res) => {
    const { user, dealer, role: myRole } = await dealerAccess(req, 'admin');
    const role = String(req.body?.role ?? '');
    if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a role: owner, admin, approver or viewer.');
    const member = (await dealerMembers(pool, dealer.id)).find((m) => m.id === Number(req.params.userId));
    if (!member) throw new HttpError(404, 'That person is not a member of this dealer.');
    if ((role === 'owner' || member.role === 'owner') && !atLeast(myRole, 'owner')) throw new HttpError(403, 'Only an owner can change an owner.');
    if (member.role === 'owner' && role !== 'owner' && await ownerCount(pool, dealer.id) <= 1) throw new HttpError(409, 'A dealer needs at least one owner.');
    await pool.query('UPDATE dealer_users SET role = ? WHERE dealer_id = ? AND user_id = ?', [role, dealer.id, member.id]);
    await audit(pool, { dealerId: dealer.id, userId: user.id, action: 'member_role', targetType: 'user', targetId: member.id, details: { from: member.role, to: role }, ip: req.ip });
    res.json({ ok: true });
  });

  r.delete('/:dealerId/users/:userId', async (req, res) => {
    const { user, dealer, role: myRole } = await dealerAccess(req, 'admin');
    const member = (await dealerMembers(pool, dealer.id)).find((m) => m.id === Number(req.params.userId));
    if (!member) throw new HttpError(404, 'That person is not a member of this dealer.');
    if (member.role === 'owner' && !atLeast(myRole, 'owner')) throw new HttpError(403, 'Only an owner can remove an owner.');
    if (member.role === 'owner' && await ownerCount(pool, dealer.id) <= 1) throw new HttpError(409, 'A dealer needs at least one owner.');
    await pool.query('DELETE FROM dealer_users WHERE dealer_id = ? AND user_id = ?', [dealer.id, member.id]);
    await audit(pool, { dealerId: dealer.id, userId: user.id, action: 'member_remove', targetType: 'user', targetId: member.id, details: { email: member.email, role: member.role }, ip: req.ip });
    res.json({ ok: true });
  });

  r.get('/:dealerId/audit', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'admin');
    res.json({ entries: await auditList(pool, dealer.id) });
  });

  r.get('/:dealerId/jobs', async (req, res) => {
    const { dealer } = await dealerAccess(req, 'viewer');
    res.json({ jobs: await listJobs(pool, dealer.id) });
  });

  // Milestone 1 check: queue a 'ping' job that the worker answers, proving portal → worker → portal works.
  r.post('/:dealerId/jobs/ping', async (req, res) => {
    staffOnly(req);
    const { user, dealer } = await dealerAccess(req, 'viewer');
    const id = await enqueueJob(pool, { dealerId: dealer.id, type: 'ping', payload: { sent_at: new Date().toISOString() } });
    await audit(pool, { dealerId: dealer.id, userId: user.id, action: 'job_ping', targetType: 'job', targetId: id, ip: req.ip });
    res.status(201).json({ job: { id, type: 'ping', status: 'queued' } });
  });

  return r;
}
