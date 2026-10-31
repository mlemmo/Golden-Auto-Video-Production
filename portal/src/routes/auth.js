// /api/auth: sign in, sign out, and "who am I" (user, their dealers with roles, CSRF token).
import { Router } from 'express';
import { HttpError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { checkLogin, dealersFor, normalEmail, publicUser } from '../lib/users.js';
import { createSession, destroySession, sessionCookie, clearedCookie, COOKIE } from '../lib/sessions.js';
import { loginLimiter } from '../lib/ratelimit.js';

export function authRoutes({ pool, config, limiter = loginLimiter() }) {
  const r = Router();

  r.post('/login', async (req, res) => {
    const email = normalEmail(req.body?.email);
    if (limiter.blocked(email, req.ip)) throw new HttpError(429, 'Too many failed sign-ins. Try again in 15 minutes.');
    const user = await checkLogin(pool, email, req.body?.password);
    if (!user) {
      limiter.fail(email, req.ip);
      await audit(pool, { action: 'login_failed', details: { email }, ip: req.ip });
      throw new HttpError(401, 'Wrong email or password.');
    }
    limiter.clear(email);
    const { token, csrf } = await createSession(pool, user.id);
    await pool.query('UPDATE users SET last_login_at = NOW(3) WHERE id = ?', [user.id]);
    await audit(pool, { userId: user.id, action: 'login', ip: req.ip });
    res.setHeader('Set-Cookie', sessionCookie(token, config.secureCookies));
    res.json({ user: publicUser(user), dealers: await dealersFor(pool, user), csrf });
  });

  r.post('/logout', async (req, res) => {
    await destroySession(pool, req.cookies[COOKIE]);
    res.setHeader('Set-Cookie', clearedCookie(config.secureCookies));
    res.json({ ok: true });
  });

  r.get('/me', async (req, res) => {
    if (!req.session) throw new HttpError(401, 'Please sign in.');
    res.json({ user: req.session.user, dealers: await dealersFor(pool, req.session.user), csrf: req.session.csrf });
  });

  return r;
}
