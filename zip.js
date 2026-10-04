/* Minimal ZIP reader (stored + deflate) using the built-in DecompressionStream. No dependencies, nothing uploaded. */
(function (root) {
  'use strict';
  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }
  async function inflateRaw(bytes) {
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  /* returns [{name, text}] for every non-directory entry (text decoded as UTF-8) */
  async function readZip(buf) {
    var d = new Uint8Array(buf), eocd = -1;
    for (var i = d.length - 22; i >= Math.max(0, d.length - 65557); i--) { if (u32(d, i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('Not a ZIP file (no end-of-directory record).');
    var count = u16(d, eocd + 10), off = u32(d, eocd + 16), out = [], dec = new TextDecoder('utf-8');
    if (off === 0xFFFFFFFF) throw new Error('ZIP64 archives are not supported. Unzip it and drop the CSV files instead.');
    for (var n = 0; n < count; n++) {
      if (u32(d, off) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
      var method = u16(d, off + 10), csize = u32(d, off + 20), nlen = u16(d, off + 28), xlen = u16(d, off + 30), clen = u16(d, off + 32), loff = u32(d, off + 42);
      var name = dec.decode(d.subarray(off + 46, off + 46 + nlen));
      off += 46 + nlen + xlen + clen;
      if (/\/$/.test(name) || /^__MACOSX\//.test(name)) continue;
      if (u32(d, loff) !== 0x04034b50) throw new Error('Corrupt ZIP local header: ' + name);
      var start = loff + 30 + u16(d, loff + 26) + u16(d, loff + 28), raw = d.subarray(start, start + csize), data;
      if (method === 0) data = raw; else if (method === 8) data = await inflateRaw(raw);
      else throw new Error('Unsupported ZIP compression (method ' + method + ') in ' + name);
      out.push({ name: name, text: dec.decode(data) });
    }
    return out;
  }
  var api = { readZip: readZip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LTZip = api;
})(typeof window !== 'undefined' ? window : globalThis);
