// multipart/form-data uploads (the dashboard's import, spokesperson and footage forms), read into
// fields (strings) and files, each saved to a temporary file as { name, tmp_name, size, error } with error codes
// 0 OK, 1 larger than 64 MB, 4 no file chosen. No npm dependency.
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { HttpError } from './auth.js';

export const UPLOAD_MAX_FILESIZE = 64 * 1024 * 1024;
const invalid = () => new HttpError(400, 'Invalid request.');

/** body: the whole request body; dir: where files are written (the caller removes it afterwards). */
export function parseMultipart(body, contentType, dir, maxFile = UPLOAD_MAX_FILESIZE) {
  const m = /^multipart\/form-data\s*;.*?boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType ?? ''));
  if (!m) throw invalid();
  const boundary = Buffer.from('--' + (m[1] ?? m[2]));
  const delimiter = Buffer.concat([Buffer.from('\r\n'), boundary]);
  const fields = {}, files = {};
  let pos = body.indexOf(boundary);
  if (pos < 0) throw invalid();
  for (;;) {
    pos += boundary.length;
    if (body.subarray(pos, pos + 2).toString() === '--') break;
    if (body.subarray(pos, pos + 2).toString() !== '\r\n') throw invalid();
    pos += 2;
    const headEnd = body.indexOf('\r\n\r\n', pos);
    if (headEnd < 0) throw invalid();
    const head = body.subarray(pos, headEnd).toString('utf8');
    const next = body.indexOf(delimiter, headEnd + 4);
    if (next < 0) throw invalid();
    const data = body.subarray(headEnd + 4, next);
    pos = next + 2;
    const disp = /^content-disposition:\s*form-data(.*)$/im.exec(head);
    if (!disp) continue;
    // Browsers send quotes and line breaks in names percent-encoded (%22, %0D%0A), never backslash-escaped.
    const param = (k) => { const r = new RegExp(';\\s*' + k + '="([^"]*)"', 'i').exec(disp[1]); return r ? r[1] : undefined; };
    const name = param('name'), filename = param('filename');
    if (!name) continue;
    if (filename === undefined) { fields[name] = data.toString('utf8'); continue; }
    const base = filename.split(/[\\/]/).pop();
    if (base === '') files[name] = { name: '', tmp_name: '', size: 0, error: 4 };
    else if (data.length > maxFile) files[name] = { name: base, tmp_name: '', size: 0, error: 1 };
    else {
      const tmp = dir + '/upload-' + randomBytes(8).toString('hex');
      writeFileSync(tmp, data, { mode: 0o600 });
      files[name] = { name: base, tmp_name: tmp, size: data.length, error: 0 };
    }
  }
  return { fields, files };
}
