/* Minimal ZIP reader (no dependencies). Supports stored + deflate entries.
   Uses the browser's built-in DecompressionStream. */
(function (root) {
  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer();
  }

  /** @returns {Array<{name:string, text:()=>Promise<string>}>} */
  function readZip(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a valid zip file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const entries = [];
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lh = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (name.endsWith('/') || (flags & 1)) continue; // directory or encrypted
      entries.push({
        name,
        async text() {
          const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
          const data = u8.subarray(start, start + csize);
          if (method === 0) return dec.decode(data);
          if (method === 8) return dec.decode(await inflateRaw(data));
          throw new Error('Unsupported zip compression (' + method + ')');
        },
      });
    }
    return entries;
  }

  root.readZip = readZip;
})(typeof window !== 'undefined' ? window : globalThis);
