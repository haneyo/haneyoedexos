#!/usr/bin/env node
// cur2xcursor.js — convert Windows .cur cursor resources into XCursor files.
// Reads each 32x32 32bpp .cur (ICONDIR + BITMAPINFOHEADER DIB, hotspot in the
// ICO entry's planes/bitcount fields) and writes the XCursor binary format
// (magic "Xcur", ARGB top-down pixels) that X11/GTK/Chromium render system-wide.
//
// Usage: node cur2xcursor.js <input.cur> <output> [nominalSize]
// Hotspot comes from the .cur itself; nominal size defaults to the image width.

const fs = require("fs");

function readCur(buf) {
    if (buf.length < 6) throw new Error("too small for ICONDIR");
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (dv.getUint16(0, true) !== 0 || dv.getUint16(2, true) !== 2) {
        throw new Error("not a .cur (expected ICONDIR reserved=0 type=2)");
    }
    const count = dv.getUint16(4, true);
    if (count < 1) throw new Error("empty .cur");
    const off = 6;
    const w = dv.getUint8(off) || 256;
    const h = dv.getUint8(off + 1) || 256;
    const xhot = dv.getUint16(off + 4, true);
    const yhot = dv.getUint16(off + 6, true);
    const bytesInRes = dv.getUint32(off + 8, true);
    const imgOff = dv.getUint32(off + 12, true);
    if (imgOff + 40 > buf.length) throw new Error("BITMAPINFOHEADER out of range");
    const base = imgOff;
    if (dv.getUint32(base, true) < 40) throw new Error("not a BITMAPINFOHEADER");
    const iw = dv.getInt32(base + 4, true);
    const ih = dv.getInt32(base + 8, true) / 2; // height doubled for AND mask
    if (iw !== w || ih !== h) throw new Error(`size mismatch (${iw}x${ih} vs ${w}x${h})`);
    if (dv.getUint16(base + 12, true) !== 1) throw new Error("planes != 1");
    if (dv.getUint16(base + 14, true) !== 32) throw new Error("not 32bpp");
    const xorOff = base + dv.getUint32(base, true);
    const rowBytes = iw * 4;
    // DIB is bottom-up BGRA → top-down ARGB
    const pixels = new Uint32Array(iw * ih);
    for (let y = 0; y < ih; y++) {
        const srcRow = ih - 1 - y;
        const si = xorOff + srcRow * rowBytes;
        const di = y * iw;
        for (let x = 0; x < iw; x++) {
            const s = si + x * 4;
            const b = dv.getUint8(s);
            const g = dv.getUint8(s + 1);
            const r = dv.getUint8(s + 2);
            const a = dv.getUint8(s + 3);
            pixels[di + x] = ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
        }
    }
    return { w: iw, h: ih, xhot, yhot, pixels };
}

function buildXcursor({ w, h, xhot, yhot, pixels }, nominal) {
    const imgHeader = 36;
    const imgSize = imgHeader + pixels.length * 4;
    const tocSize = 16;                          // toc entry: type, subtype, pos, len
    const headerSize = 16;                       // magic, header, version, ntoc
    const imagePos = headerSize + tocSize;       // single toc entry
    const file = Buffer.alloc(imagePos + imgSize);
    let o = 0;
    const u32 = (v) => { file.writeUInt32LE(v, o); o += 4; };
    u32(0x72756358);                             // "Xcur"
    u32(headerSize);
    u32(1);                                      // version
    u32(1);                                      // ntoc
    u32(0xfffd0002);                             // image type
    u32(nominal);                                // subtype (nominal size)
    u32(imagePos);
    u32(imgSize);
    // image chunk
    u32(imgHeader);
    u32(1);                                      // version
    u32(nominal);
    u32(w);
    u32(h);
    u32(xhot);
    u32(yhot);
    u32(0);                                      // delay (static)
    const pxBuf = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    pxBuf.copy(file, o);
    return file;
}

const [, , input, output, nominalArg] = process.argv;
if (!input || !output) {
    console.error("usage: node cur2xcursor.js <in.cur> <out> [nominalSize]");
    process.exit(1);
}
const cur = readCur(fs.readFileSync(input));
const nominal = nominalArg ? parseInt(nominalArg, 10) : cur.w;
const out = buildXcursor(cur, nominal);
fs.writeFileSync(output, out);
console.error(`[cur2xcursor] ${input} ${cur.w}x${cur.h} hot(${cur.xhot},${cur.yhot}) → ${output} (${out.length}B, nominal ${nominal})`);
