// How rows are written to the database (agent.sqlite), the same format the existing data was stored in, so stored
// records and the hashes made from them (fingerprints, gallery hashes) stay the same: "/" escaped as "\/", every
// non-ASCII character as a lowercase \uXXXX escape (UTF-16, so emoji become surrogate pairs), whole floats without
// ".0" (9000.0 is stored as 9000), and an empty array or object as "[]".
// Reading needs nothing special (JSON.parse); an empty "[]" comes back as an array, and the code treats an empty
// array like an empty object. Key order: JS objects list integer-like keys ("0", "870288") first; none of the app's
// rows use maps keyed by numbers.

function escapeString(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += '\\\\';
    else if (c === 0x2f) out += '\\/';
    else if (c === 0x08) out += '\\b';
    else if (c === 0x0c) out += '\\f';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0d) out += '\\r';
    else if (c === 0x09) out += '\\t';
    else if (c < 0x20 || c > 0x7f) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += s[i];
  }
  return out + '"';
}

function encodeNumber(n) {
  if (!Number.isFinite(n)) throw new Error('Inf and NaN cannot be JSON encoded');
  // The shortest round-trip form, like JS; only the exponent style differs (1.0e+25).
  let s = String(n);
  const e = s.match(/^(-?[\d.]+)e([+-])(\d+)$/);
  if (e) s = `${e[1].includes('.') ? e[1] : e[1] + '.0'}e${e[2]}${e[3]}`;
  return s;
}

/** A value as JSON in the stored format above. */
export function jsonEncode(value) {
  if (value === null || value === undefined) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return encodeNumber(value);
  if (typeof value === 'string') return escapeString(value);
  if (Array.isArray(value)) return '[' + value.map(jsonEncode).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (keys.length === 0) return '[]';
    // A map whose keys are exactly 0..n-1 is written as a list.
    if (keys.every((k, i) => k === String(i))) return '[' + keys.map((k) => jsonEncode(value[k])).join(',') + ']';
    return '{' + keys.map((k) => escapeString(k) + ':' + jsonEncode(value[k])).join(',') + '}';
  }
  throw new Error('Cannot JSON encode ' + typeof value);
}
