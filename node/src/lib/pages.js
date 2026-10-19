// The sign-in page (src/templates/login.html), the dashboard page (the React build, web/ → public/app/index.html,
// with this browser's session values put in) and the password check (bcrypt; existing "$2y$" hashes work, so
// the password stays the same).
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { ROOT } from './config.js';

/** HTML-escape a value for the page (& < > " '). */
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

/** {{NAME}} placeholders filled in one pass, values inserted as given. */
export function fill(html, vars) {
  const keys = Object.keys(vars);
  if (!keys.length) return html;
  const re = new RegExp(keys.map((k) => ('{{' + k + '}}').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|'), 'g');
  return html.replace(re, (m) => String(vars[m.slice(2, -2)]));
}

export function envBits(cfg) {
  const env = String(cfg.environment ?? '');
  const test = ['staging', 'node'].includes(env), label = env === 'node' ? 'NODE TEST' : 'STAGING';
  return { env, test, label, prefix: test ? label + ' • ' : '' };
}
/** firstRun: no accounts yet — the old dashboard password creates the first admin for the email entered. */
export function loginPage(cfg, csrf, error = '', firstRun = false) {
  const html = readFileSync(new URL('../templates/login.html', import.meta.url), 'utf8');
  const note = firstRun ? '<p class="note-important">First sign-in: enter your email and the current dashboard password. This creates your admin account; after that, admins add everyone else.</p>' : '';
  return fill(html, { TITLE_PREFIX: esc(envBits(cfg).prefix), CSRF: esc(csrf), ERROR: esc(error), NOTE: note });
}

/**
 * The React dashboard (built by `npm run build` in web/). Its index.html carries <!--GA_BOOT--> where this browser's
 * CSRF token and the site's banner go; null when the front end has not been built.
 */
export function dashboardPage(cfg, csrf, root = ROOT, user = null) {
  let html;
  try { html = readFileSync(root + '/public/app/index.html', 'utf8'); } catch { return null; }
  const { env, test, label, prefix } = envBits(cfg);
  const boot = { csrf, env, user, banner: test ? label + ' — test copy. Paid generations here cost real money; production is video.mygoldenauto.net.' : '' };
  // JSON inside <script>: "<" escaped so no value can close the tag.
  const script = '<script>window.GA=' + JSON.stringify(boot).replace(/</g, '\\u003c') + ';</script>';
  return html.replace('<!--GA_BOOT-->', script).replace(/<title>([^<]*)<\/title>/, (_, t) => '<title>' + esc(prefix) + t + '</title>');
}

/** The dashboard password against its bcrypt hash ("$2y$…" hashes work as is). */
export async function passwordVerify(password, hash) {
  try { return await bcrypt.compare(String(password), String(hash)); } catch { return false; }
}
