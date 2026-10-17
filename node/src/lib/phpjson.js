// json_encode() as PHP writes it with no flags, so rows Node saves are byte-for-byte what PHP would have saved:
// "/" escaped as "\/", every non-ASCII character as a lowercase \uXXXX escape (UTF-16, so emoji become surrogate
// pairs), whole floats without ".0" (PHP stores 9000.0 as 9000), and an empty array/object as "[]" (PHP cannot tell
// an empty list from an empty map; json_decode(…, true) reads both as []).
// Reading needs nothing special: JSON.parse gives the same values json_decode($s, true) does, except that PHP's
// empty "[]" comes back as a JS array; ported code treats an empty array like an empty object.
// Key order: JS objects list integer-like keys ("0", "870288") first, PHP keeps insertion order. Rows whose maps are
// keyed by numbers would be rewritten in a different order (same data); none of the app's rows are.

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
  // PHP (serialize_precision = -1) prints the shortest round-trip form, like JS; it differs only in exponent style.
  let s = String(n);
  const e = s.match(/^(-?[\d.]+)e([+-])(\d+)$/);
  if (e) s = `${e[1].includes('.') ? e[1] : e[1] + '.0'}e${e[2]}${e[3]}`;
  return s;
}

/** PHP json_encode($value) with no flags. */
export function phpJsonEncode(value) {
  if (value === null || value === undefined) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return encodeNumber(value);
  if (typeof value === 'string') return escapeString(value);
  if (Array.isArray(value)) return '[' + value.map(phpJsonEncode).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (keys.length === 0) return '[]';
    // A PHP array whose keys are exactly 0..n-1 is a list.
    if (keys.every((k, i) => k === String(i))) return '[' + keys.map((k) => phpJsonEncode(value[k])).join(',') + ']';
    return '{' + keys.map((k) => escapeString(k) + ':' + phpJsonEncode(value[k])).join(',') + '}';
  }
  throw new Error('Cannot JSON encode ' + typeof value);
}
