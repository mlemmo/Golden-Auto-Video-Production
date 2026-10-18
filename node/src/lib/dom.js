// A small HTML parser for reading dealer listing pages the way libxml2's HTML parser does, enough
// for the queries the importers use: elements, attributes, text content, ancestors. No npm dependency.
// libxml behaviours kept: a page without a UTF-8 charset declaration is read as ISO-8859-1 (so UTF-8 bytes show up
// as "Ã©"); entities are decoded in text and attribute values; <script>/<style> hold raw text; void
// elements never have children; an open <li>/<p>/<option>/<tr>/<td>/<th>/<dt>/<dd> is closed by the next one; an
// end tag closes up to its nearest open match and is ignored when nothing matches; the first of duplicate
// attributes wins.
import { htmlEntityDecode } from './html.js';

const VOID = new Set(['area', 'base', 'basefont', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'isindex', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
// An opening tag (key) closes these open elements first, like libxml's htmlAutoClose table for the tags that occur.
const BLOCK = ['address', 'blockquote', 'div', 'dl', 'fieldset', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'ol', 'p', 'pre', 'table', 'ul', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'figure'];
const AUTOCLOSE = {
  li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], option: ['option'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'],
  ...Object.fromEntries(BLOCK.map((t) => [t, ['p']])),
};

export class El {
  constructor(tag, attrs, parent) { this.tag = tag; this.attrs = attrs; this.parent = parent; this.children = []; }
  attr(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : ''; }
  has(name) { return Object.hasOwn(this.attrs, name); }
  get textContent() { let s = ''; for (const c of this.children) s += typeof c === 'string' ? c : c.textContent; return s; }
  /** All descendant elements, document order. */
  *descendants() { for (const c of this.children) if (typeof c !== 'string') { yield c; yield* c.descendants(); } }
  findAll(pred) { return [...this.descendants()].filter(pred); }
  hasAncestor(tag) { for (let p = this.parent; p; p = p.parent) if (p.tag === tag) return true; return false; }
}

/** The page decoded as libxml2 would: UTF-8 only when the page declares it, otherwise ISO-8859-1. */
function asLibxmlText(html) {
  const head = html.slice(0, 4096);
  if (/<meta[^>]+charset\s*=\s*["']?\s*utf-?8/i.test(head)) return html;
  return Buffer.from(html, 'utf8').toString('latin1');
}

const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/y;

export function parseHtml(input) {
  const html = asLibxmlText(String(input));
  const root = new El('#document', {}, null);
  let cur = root, i = 0;
  const open = (tag) => { for (let p = cur; p && p !== root; p = p.parent) if (p.tag === tag) return true; return false; };
  const text = (t) => { if (t !== '') cur.children.push(htmlEntityDecode(t)); };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { text(html.slice(i)); break; }
    text(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e === -1 ? html.length : e + 3; continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { const e = html.indexOf('>', lt); i = e === -1 ? html.length : e + 1; continue; }
    const end = html[lt + 1] === '/';
    const nm = html.slice(lt + (end ? 2 : 1)).match(/^[A-Za-z][A-Za-z0-9:-]*/);
    if (!nm) { text('<'); i = lt + 1; continue; }
    const tag = nm[0].toLowerCase();
    let j = lt + (end ? 2 : 1) + nm[0].length;
    const attrs = {};
    // Attributes up to the closing ">" (a ">" inside quotes does not end the tag).
    for (;;) {
      while (j < html.length && /[\s\/]/.test(html[j])) j++;
      if (j >= html.length || html[j] === '>') break;
      ATTR.lastIndex = j;
      const a = ATTR.exec(html);
      if (!a || a[0] === '') { j++; continue; }
      const name = a[1].toLowerCase();
      if (!end && !Object.hasOwn(attrs, name)) attrs[name] = htmlEntityDecode(a[2] ?? a[3] ?? a[4] ?? '');
      j = ATTR.lastIndex;
    }
    i = j + 1;
    if (end) {
      if (open(tag)) { while (cur.tag !== tag) cur = cur.parent; cur = cur.parent; }
      continue;
    }
    for (const closes of AUTOCLOSE[tag] ?? []) {
      // Only an element open directly in the current context is closed (an <li> inside a nested list stays).
      for (let p = cur; p && p !== root && !['ul', 'ol', 'table', 'tbody', 'select', 'dl', 'div'].includes(p.tag) || (p === cur && closes === p.tag); p = p.parent) {
        if (p.tag === closes) { cur = p.parent; break; }
        if (p === cur && ['ul', 'ol', 'table', 'tbody', 'select', 'dl', 'div'].includes(p.tag)) break;
      }
    }
    const el = new El(tag, attrs, cur);
    cur.children.push(el);
    if (VOID.has(tag)) continue;
    if (RAW.has(tag)) {
      const close = html.toLowerCase().indexOf('</' + tag, i);
      const body = html.slice(i, close === -1 ? html.length : close);
      if (body !== '') el.children.push(body);
      i = close === -1 ? html.length : (html.indexOf('>', close) + 1 || html.length);
      continue;
    }
    cur = el;
  }
  return root;
}

/** XPath normalize-space(): XML whitespace runs collapsed, trimmed. */
export const normalizeSpace = (s) => s.replace(/[ \t\n\r]+/g, ' ').replace(/^ | $/g, '');
/** contains(concat(" ", normalize-space(@class), " "), " token ") */
export const hasClassToken = (el, token) => (' ' + normalizeSpace(el.attr('class')) + ' ').includes(' ' + token + ' ');
