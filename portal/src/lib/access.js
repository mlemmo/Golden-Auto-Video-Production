// Who may do what, checked on the server for every request: signed in, eShield staff, or a role at the dealer in the
// :dealerId part of the path. Shared by the dealer, car and order routes.
import { HttpError } from './errors.js';
import { atLeast, roleAt } from './users.js';

export function accessChecks(pool) {
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
  return { signedIn, staffOnly, dealerAccess };
}
