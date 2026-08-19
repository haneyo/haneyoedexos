#!/usr/bin/env node
// cur2xcursor.js — convert Windows cursor resources (.cur or .ani) into XCursor files.
// Reads a single 32bpp DIB frame (ICONDIR + BITMAPINFOHEADER, height doubled for
// the AND mask) and writes the XCursor binary format (magic "Xcur", ARGB top-down
// pixels) that X11/GTK/Chromium render system-wide.
//
// Usage: node cur2xcursor.js <input.cur|input.ani> <output> [nominalSize] [hotX hotY]
//   - .cur carries its hotspot in the ICO entry; .ani frames do NOT, so the
//     click point must be passed explicitly as the hotX/hotY arguments.
//   - nominal size defaults to the image width (32 for the WP7 pack).
//
// Examples:
//   node cur2xcursor.js Arrow.cur default            # hotspot read from the .cur
//   node cur2xcursor.js WP7CursorBG.ani default 32 2 5 # .ani: hotspot (2,5) pinned

const fs = require("fs");

// Resolve a cursor resource to its ICONDIR, returning {dv, count} or null.
// Accepts a Windows .cur (ICONDIR at offset 0) and an animated .ani — a RIFF
// "ACON" wrapper whose first "icon" chunk holds a self-contained ICONDIR.
function _iconDir(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    // .cur / .ico — ICONDIR right at the start
    if (dv.getUint16(0, true) === 0 && dv.getUint16(2, true) === 2) {
        return { dv, count: dv.getUint16(4, true) };
    }
    // .ani — RIFF "ACON" wrapper; the frames live as "icon" sub-chunks inside a
    // LIST ("fram") chunk. Walk the top level, then descend into any LIST.
    if (dv.getUint32(0, true) === 0x46464952 && dv.getUint32(8, true) === 0x4e4f4341) {
        let off = 12;
        const end = dv.byteLength;
        while (off + 8 <= end) {
            const id = dv.getUint32(off, true);
            const size = dv.getUint32(off + 4, true);
            if (id === 0x5453494c) {                    // "LIST" → "fram" frames
                const subEnd = off + 8 + size;
                let sub = off + 12;                     // skip the 4-byte form type
                while (sub + 8 <= subEnd) {
                    const sid = dv.getUint32(sub, true);
                    const ssize = dv.getUint32(sub + 4, true);
                    if (sid === 0x6e6f6369) {           // "icon" — first frame wins
                        const c = new DataView(dv.buffer.slice(sub + 8, sub + 8 + ssize));
                        if (c.getUint16(0, true) === 0 && c.getUint16(2, true) === 2) {
                            return { dv: c, count: c.getUint16(4, true) };
                        }
                    }
                    sub += 8 + ssize + (ssize & 1);
                }
            }
            off += 8 + size + (size & 1);               // RIFF chunks are word-aligned
        }
    }
    return null;
}

// Decode the first 32bpp DIB frame of an ICONDIR into top-down ARGB pixels.
function _decodeFrame(icon) {
    if (!icon || icon.count < 1) throw new Error("empty cursor resource");
    const off = 6;
    const w = icon.dv.getUint8(off) || 256;
    const h = icon.dv.getUint8(off + 1) || 256;
    const imgOff = icon.dv.getUint32(off + 12, true);
    const dv = icon.dv;
    if (imgOff + 40 > dv.byteLength) throw new Error("BITMAPINFOHEADER out of range");
    const base = imgOff;
    if (dv.getUint32(base, true) < 40) throw new Error("not a BITMAPINFOHEADER");
    const iw = dv.getInt32(base + 4, true);
    const ih = dv.getInt32(base + 8, true) / 2;         // height doubled for AND mask
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
    return { w: iw, h: ih, pixels };
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

const [, , input, output, nominalArg, hotXArg, hotYArg] = process.argv;
if (!input || !output) {
    console.error("usage: node cur2xcursor.js <in.cur|in.ani> <out> [nominalSize] [hotX hotY]");
    process.exit(1);
}

const buf = fs.readFileSync(input);
const dv0 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const isAni = dv0.getUint32(0, true) === 0x46464952 && dv0.getUint32(8, true) === 0x4e4f4341;
const icon = _iconDir(buf);
if (!icon) throw new Error(`${input}: not a .cur or .ani cursor resource`);

const frame = _decodeFrame(icon);

let xhot, yhot;
if (hotXArg != null && hotYArg != null) {
    xhot = parseInt(hotXArg, 10);
    yhot = parseInt(hotYArg, 10);
} else if (isAni) {
    console.error(`${input}: .ani frames carry no hotspot — pass hotX hotY (e.g. 32 2 5)`);
    process.exit(1);
} else {
    // .cur — hotspot lives in the ICO entry's planes/hotX + bitcount/hotY fields
    xhot = icon.dv.getUint16(6 + 4, true);
    yhot = icon.dv.getUint16(6 + 6, true);
}

const nominal = nominalArg ? parseInt(nominalArg, 10) : frame.w;
const out = buildXcursor({ ...frame, xhot, yhot }, nominal);
fs.writeFileSync(output, out);
console.error(`[cur2xcursor] ${input} ${frame.w}x${frame.h} hot(${xhot},${yhot}) → ${output} (${out.length}B, nominal ${nominal})`);
