// Reading ZIP files (DealerCenter media ZIPs) with Node's own zlib, no npm dependency: the central directory gives each
// entry's name, sizes and offset; entries are stored (0) or deflated (8). Enough for photo ZIPs; ZIP64 is refused.
import { inflateRawSync } from 'node:zlib';

/** Entries of a ZIP buffer: [{ name, size, data() }] in directory order. Throws on a damaged or unsupported file. */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd === -1) throw new Error('Cannot open ZIP.');
  const count = buf.readUInt16LE(eocd + 10), dirSize = buf.readUInt32LE(eocd + 12), dirOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirOffset === 0xffffffff || dirOffset + dirSize > buf.length) throw new Error('Cannot open ZIP.');
  const entries = [];
  let p = dirOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Cannot open ZIP.');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const flags = buf.readUInt16LE(p + 8);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    p += 46 + nameLen + extraLen + commentLen;
    entries.push({
      name, size,
      data() {
        if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('Cannot read ZIP entry ' + name);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + csize);
        if (method === 0) return Buffer.from(raw);
        if (method === 8) { const out = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) }); if (out.length !== size) throw new Error('Damaged ZIP entry ' + name); return out; }
        throw new Error('Unsupported ZIP compression in ' + name);
      },
    });
  }
  return entries;
}

/** Writes a ZIP of stored (uncompressed) files — tests and tools only. files: [[name, Buffer], …]. */
export function writeZip(files) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals = [], dirs = []; let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name, 'utf8'), crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x800, 6); l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
    const d = Buffer.alloc(46); d.writeUInt32LE(0x02014b50, 0); d.writeUInt16LE(20, 4); d.writeUInt16LE(20, 6); d.writeUInt16LE(0x800, 8); d.writeUInt32LE(crc, 16); d.writeUInt32LE(data.length, 20); d.writeUInt32LE(data.length, 24); d.writeUInt16LE(n.length, 28); d.writeUInt32LE(offset, 42);
    locals.push(l, n, data); dirs.push(d, n); offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(dirs), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(dir.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, e]);
}
