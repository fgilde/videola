import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

// Chrome writes --screenshot at the size of the window it opened, and headless Chrome still
// reserves the browser's own furniture inside it: a window of 1440x900 lays the page out in 744.
// Every desktop picture in the guide carried a hundred and fifty pixels of black under the editor,
// which reads as a layout that ran out of room rather than as a window with a title bar.
//
// Cutting rows off the bottom is the one crop a PNG takes without being re-encoded pixel by pixel.
// Each scanline is filtered against the one above it, so the rows that stay keep every byte they
// had; only the rows after the cut go, and the header learns the new height.
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function crcTable() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
}

const TABLE = crcTable();

function crc(bytes) {
  let c = -1;
  for (const byte of bytes) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

function chunks(png) {
  const found = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    found.push({ type: png.toString("ascii", at + 4, at + 8), body: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return found;
}

/**
 * Cut a PNG down to its first `height` rows, in place. Returns what it did, so a caller that asked
 * for more rows than the file has says so rather than quietly writing the file back unchanged.
 */
export function cropHeight(path, height) {
  const png = readFileSync(path);
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error(`not a PNG: ${path}`);
  const parts = chunks(png);
  const header = parts.find((part) => part.type === "IHDR");
  if (header === undefined) throw new Error(`no IHDR: ${path}`);
  const width = header.body.readUInt32BE(0);
  const was = header.body.readUInt32BE(4);
  const depth = header.body.readUInt8(8);
  const colour = header.body.readUInt8(9);
  const interlace = header.body.readUInt8(12);
  // Interlaced rows are not in picture order, so a prefix of them is not a top crop. Chrome does
  // not write interlaced PNGs; this is here so that the day it does, the harness says so.
  if (interlace !== 0) throw new Error(`interlaced PNG cannot be cropped by rows: ${path}`);
  if (depth !== 8) throw new Error(`only 8 bits per channel, got ${depth}: ${path}`);
  if (height >= was) return { cropped: false, width, height: was };

  const stride = 1 + width * CHANNELS[colour];
  const raw = inflateSync(Buffer.concat(parts.filter((part) => part.type === "IDAT").map((part) => part.body)));
  const kept = raw.subarray(0, stride * height);
  const ihdr = Buffer.from(header.body);
  ihdr.writeUInt32BE(height, 4);

  const rebuilt = [SIGNATURE, chunk("IHDR", ihdr)];
  for (const part of parts) {
    if (part.type === "IHDR" || part.type === "IDAT" || part.type === "IEND") continue;
    rebuilt.push(chunk(part.type, part.body));
  }
  rebuilt.push(chunk("IDAT", deflateSync(kept)), chunk("IEND", Buffer.alloc(0)));
  writeFileSync(path, Buffer.concat(rebuilt));
  return { cropped: true, width, height };
}
