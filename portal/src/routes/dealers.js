// /api/dealers: dealers, their members and roles, audit log, and jobs. Roles are checked here on the server for
// every request: viewers read; owners and admins manage members and edit the dealer's details; only eShield staff
// create dealers, change a short name or send test jobs.
import { Router } from 'express';
import { HttpError } from '../lib/errors.js';
import { audit, auditList } from '../lib/audit.js';
import { accessChecks } from '../lib/access.js';
import { ROLES, atLeast, dealersFor, dealerMembers, findUserByEmail, createUser, ownerCount, normalEmail } from '../lib/users.js';
import { enqueueJob, listJobs } from '../lib/jobs.js';
import { cleanDealer } from '../lib/dealers.js';

export function dealerRoutes({ pool }) {
  const r = Router();

  const { signedIn, staffOnly, dealerAccess } = accessChecks(pool);

  r.get('/', async (req, res) => res.json({ dealers: await dealersFor(pool, signedIn(req)) }));

  r.post('/', async (req, res) => {
    const user = staffOnly(req);
    const d = cleanDealer(req.body, { creating: true, staff: true });
    let id;
    try {
      [{ insertId: id }] = await pool.query('INSERT INTO dealers (name, slug, website, city, state, phone, timezone) VALUES (?,?,?,?,?,?,?)',
        [d.name, d.slug, d.website, d.city, d.state, d.phone, d.timezone]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That short name is already used.');
      throw err;
    }
    await audit(pool, { dealerId: id, userId: user.id, action: 'dealer_create', targetType: 'dealer', targetId: id, details: { name: d.name, slug: d.slug }, ip: req.ip });
    res.status(201).json({ dealer: { id, ...d, status: 'active' } });
  });

  // Owners and admins edit their dealer's details; eShield staff edit any dealer, including its short name.
  r.patch('/:dealerId', async (req, res) => {
    const { user, dealer, role } = await dealerAccess(req, 'admin');
    const d = cleanDealer(req.body, { staff: role === 'staff' });
    const changed = Object.keys(d).filter((k) => d[k] !== (dealer[k] ?? null));
    if (changed.length) {
      try {
        await pool.query(`UPDATE dealers SET ${changed.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...changed.map((k) => d[k]), dealer.id]);
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That short name is already used.');
        throw err;
      }
      await audit(pool, { dealerId: dealer.id, userId: user.id, action: 'dealer_edit', targetType: 'dealer', targetId: dealer.id,
        details: Object.fromEntries(changed.map((k) => [k, { from: dealer[k] ?? null, to: d[k] }])), ip: req.ip });
    }
    const [rows] = await pool.query('SELECT * FROM dealers WHERE id = ?', [dealer.id]);
    res.json({ dealer: rows[0], changed });
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
