// The dashboard and sign-in pages, from the same templates PHP renders (private/templates/*.html, pageRender in
// private/app.php), and the password check (PHP's password_verify through the PHP CLI, which already reads the
// config; the password goes on stdin, never in arguments).
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { ROOT } from './config.js';
import { phpJsonEncode } from './phpjson.js';

/** htmlspecialchars($s, ENT_QUOTES, 'UTF-8'). */
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

/** pageRender(): {{NAME}} placeholders filled in one pass, values inserted as given (strtr). */
export function pageRender(name, vars, root = ROOT) {
  const html = readFileSync(root + '/private/templates/' + name + '.html', 'utf8');
  const keys = Object.keys(vars);
  if (!keys.length) return html;
  const re = new RegExp(keys.map((k) => ('{{' + k + '}}').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|'), 'g');
  return html.replace(re, (m) => String(vars[m.slice(2, -2)]));
}

function envBits(cfg) {
  const env = String(cfg.environment ?? '');
  const staging = ['staging', 'node'].includes(env), label = env === 'node' ? 'NODE TEST' : 'STAGING';
  return { env, staging, label, prefix: staging ? label + ' • ' : '' };
}
export function loginPage(cfg, csrf, error = '') {
  return pageRender('login', { TITLE_PREFIX: envBits(cfg).prefix, CSRF: esc(csrf), ERROR: esc(error) });
}
/** actions: the dashboard actions this service answers (sent to /api/node/ by app.js on the node site). */
export function dashboardPage(cfg, csrf, actions = null) {
  const { env, staging, label, prefix } = envBits(cfg);
  return pageRender('dashboard', {
    TITLE_PREFIX: prefix,
    BANNER: staging ? '<div class="staging-banner">' + label + ' — test copy. Paid generations here cost real money; production is video.mygoldenauto.net.</div>' : '',
    BOOT: 'window.CSRF=' + phpJsonEncode(csrf) + ';' + (env === 'node' && actions ? 'window.NODE_ACTIONS=' + phpJsonEncode(actions) + ';' : ''),
  });
}

/** password_verify($password, $hash) via the PHP CLI (bcrypt "$2y$" hashes made by password_hash). */
export function passwordVerify(password, hash) {
  return new Promise((resolve) => {
    const p = spawn('php', ['-r', '$i=json_decode(stream_get_contents(STDIN),true);echo is_array($i)&&password_verify((string)$i["p"],(string)$i["h"])?"1":"0";'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0 && out === '1'));
    p.stdin.on('error', () => {});
    p.stdin.end(JSON.stringify({ p: String(password), h: String(hash) }));
  });
}
