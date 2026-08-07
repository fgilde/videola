// Test code. This file is never re-exported from `index.ts` and cannot reach a bundle.
//
// The alternative was committing a real MP4. A generated one is a few hundred bytes instead of a
// few kilobytes, and it is the only way to pin the numbers that matter here: a media timescale of
// 30000 with a sample delta of 1001 is what makes the NTSC frame rate come back out as 30000/1001
// and not as 29.97, and a hand-picked sync sample list is what makes the keyframe snapping
// testable at all. Nothing decodes these bytes -- the sample payload is filler, because probing
// and packet selection read the sample tables and never the pictures.

type Bin = Uint8Array<ArrayBuffer>;

const AVC_PROFILE = 0x42;
const AVC_COMPAT = 0x00;
const AVC_LEVEL = 0x0a;
const SAMPLE_BYTES = 4;

export interface Mp4FixtureOptions {
  timescale: number;
  sampleDelta: number;
  sampleCount: number;
  width: number;
  height: number;
  keyframeEvery: number;
}

export const NTSC_FIXTURE: Mp4FixtureOptions = {
  timescale: 30000,
  sampleDelta: 1001,
  sampleCount: 30,
  width: 320,
  height: 176,
  keyframeEvery: 15,
};

export function tinyMp4(options: Mp4FixtureOptions = NTSC_FIXTURE): Blob {
  const ftyp = fileTypeBox();
  const mdatSize = 8 + options.sampleCount * SAMPLE_BYTES;
  // stco carries an absolute file offset, so the movie box has to be measured before it can be
  // written with the right one. Its length does not depend on the value, only on the field.
  const probe = movieBox(options, 0);
  const dataOffset = ftyp.length + probe.length + 8;
  return new Blob([ftyp, movieBox(options, dataOffset), mediaDataBox(mdatSize)], {
    type: "video/mp4",
  });
}

export function fixtureFrameSeconds(options: Mp4FixtureOptions, index: number): number {
  return (index * options.sampleDelta) / options.timescale;
}

class Bytes {
  #parts: Bin[] = [];

  u8(value: number): this {
    return this.push(new Uint8Array([value & 0xff]));
  }

  u16(value: number): this {
    return this.push(new Uint8Array([(value >>> 8) & 0xff, value & 0xff]));
  }

  u32(value: number): this {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value >>> 0);
    return this.push(out);
  }

  i16(value: number): this {
    const out = new Uint8Array(2);
    new DataView(out.buffer).setInt16(0, value);
    return this.push(out);
  }

  ascii(text: string): this {
    return this.push(new Uint8Array([...text].map((c) => c.charCodeAt(0))));
  }

  zeros(count: number): this {
    return this.push(new Uint8Array(count));
  }

  push(bytes: Bin): this {
    this.#parts.push(bytes);
    return this;
  }

  done(): Bin {
    const total = this.#parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of this.#parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

function box(type: string, ...payload: Bin[]): Bin {
  const size = payload.reduce((sum, part) => sum + part.length, 8);
  return new Bytes().u32(size).ascii(type).push(concat(payload)).done();
}

function fullBox(type: string, version: number, flags: number, ...payload: Bin[]): Bin {
  return box(type, new Bytes().u8(version).u8(flags >>> 16).u16(flags & 0xffff).done(), ...payload);
}

function concat(parts: Bin[]): Bin {
  const bytes = new Bytes();
  for (const part of parts) bytes.push(part);
  return bytes.done();
}

function fileTypeBox(): Bin {
  return box(
    "ftyp",
    new Bytes()
      .ascii("isom")
      .u32(512)
      .ascii("isom")
      .ascii("iso2")
      .ascii("avc1")
      .ascii("mp41")
      .done(),
  );
}

function mediaDataBox(size: number): Bin {
  return new Bytes().u32(size).ascii("mdat").zeros(size - 8).done();
}

function movieBox(options: Mp4FixtureOptions, dataOffset: number): Bin {
  const ticks = options.sampleCount * options.sampleDelta;
  const movieDuration = Math.round((ticks / options.timescale) * 1000);
  return box("moov", movieHeaderBox(movieDuration), trackBox(options, movieDuration, dataOffset));
}

function movieHeaderBox(duration: number): Bin {
  return fullBox(
    "mvhd",
    0,
    0,
    new Bytes()
      .u32(0)
      .u32(0)
      .u32(1000)
      .u32(duration)
      .u32(0x00010000)
      .u16(0x0100)
      .zeros(10)
      .push(unityMatrix())
      .zeros(24)
      .u32(2)
      .done(),
  );
}

function trackBox(options: Mp4FixtureOptions, movieDuration: number, dataOffset: number): Bin {
  return box("trak", trackHeaderBox(options, movieDuration), mediaBox(options, dataOffset));
}

function trackHeaderBox(options: Mp4FixtureOptions, movieDuration: number): Bin {
  return fullBox(
    "tkhd",
    0,
    3,
    new Bytes()
      .u32(0)
      .u32(0)
      .u32(1)
      .u32(0)
      .u32(movieDuration)
      .zeros(8)
      .u16(0)
      .u16(0)
      .u16(0)
      .u16(0)
      .push(unityMatrix())
      .u32(options.width << 16)
      .u32(options.height << 16)
      .done(),
  );
}

function unityMatrix(): Bin {
  return new Bytes()
    .u32(0x00010000)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0x00010000)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0x40000000)
    .done();
}

function mediaBox(options: Mp4FixtureOptions, dataOffset: number): Bin {
  return box(
    "mdia",
    mediaHeaderBox(options),
    handlerBox(),
    box("minf", videoMediaHeaderBox(), dataInformationBox(), sampleTableBox(options, dataOffset)),
  );
}

function mediaHeaderBox(options: Mp4FixtureOptions): Bin {
  return fullBox(
    "mdhd",
    0,
    0,
    new Bytes()
      .u32(0)
      .u32(0)
      .u32(options.timescale)
      .u32(options.sampleCount * options.sampleDelta)
      .u16(0x55c4)
      .u16(0)
      .done(),
  );
}

function handlerBox(): Bin {
  return fullBox(
    "hdlr",
    0,
    0,
    new Bytes().u32(0).ascii("vide").zeros(12).ascii("VideoHandler").u8(0).done(),
  );
}

function videoMediaHeaderBox(): Bin {
  return fullBox("vmhd", 0, 1, new Bytes().u16(0).u16(0).u16(0).u16(0).done());
}

function dataInformationBox(): Bin {
  return box("dinf", fullBox("dref", 0, 0, new Bytes().u32(1).done(), fullBox("url ", 0, 1)));
}

function sampleTableBox(options: Mp4FixtureOptions, dataOffset: number): Bin {
  return box(
    "stbl",
    sampleDescriptionBox(options),
    timeToSampleBox(options),
    syncSampleBox(options),
    sampleToChunkBox(options),
    sampleSizeBox(options),
    chunkOffsetBox(dataOffset),
  );
}

function sampleDescriptionBox(options: Mp4FixtureOptions): Bin {
  return fullBox("stsd", 0, 0, new Bytes().u32(1).done(), visualSampleEntry(options));
}

function visualSampleEntry(options: Mp4FixtureOptions): Bin {
  return box(
    "avc1",
    new Bytes()
      .zeros(6)
      .u16(1)
      .zeros(16)
      .u16(options.width)
      .u16(options.height)
      .u32(0x00480000)
      .u32(0x00480000)
      .u32(0)
      .u16(1)
      .zeros(32)
      .u16(0x0018)
      .i16(-1)
      .done(),
    avcConfigurationBox(),
  );
}

// A well-formed AVCDecoderConfigurationRecord whose parameter sets are filler. mediabunny copies
// the record verbatim into `VideoDecoderConfig.description` and reads the codec string out of
// bytes 1..4, so the shape is what is under test here, not the bitstream.
function avcConfigurationBox(): Bin {
  const sps = new Uint8Array([0x67, AVC_PROFILE, AVC_COMPAT, AVC_LEVEL, 0x00]);
  const pps = new Uint8Array([0x68, 0xce, 0x3c, 0x80]);
  return box(
    "avcC",
    new Bytes()
      .u8(1)
      .u8(AVC_PROFILE)
      .u8(AVC_COMPAT)
      .u8(AVC_LEVEL)
      .u8(0xff)
      .u8(0xe1)
      .u16(sps.length)
      .push(sps)
      .u8(1)
      .u16(pps.length)
      .push(pps)
      .done(),
  );
}

function timeToSampleBox(options: Mp4FixtureOptions): Bin {
  return fullBox(
    "stts",
    0,
    0,
    new Bytes().u32(1).u32(options.sampleCount).u32(options.sampleDelta).done(),
  );
}

function syncSampleBox(options: Mp4FixtureOptions): Bin {
  const bytes = new Bytes();
  const numbers = syncSampleNumbers(options);
  bytes.u32(numbers.length);
  for (const number of numbers) bytes.u32(number);
  return fullBox("stss", 0, 0, bytes.done());
}

export function syncSampleNumbers(options: Mp4FixtureOptions): number[] {
  const numbers: number[] = [];
  for (let index = 0; index < options.sampleCount; index += options.keyframeEvery) {
    numbers.push(index + 1);
  }
  return numbers;
}

function sampleToChunkBox(options: Mp4FixtureOptions): Bin {
  return fullBox(
    "stsc",
    0,
    0,
    new Bytes().u32(1).u32(1).u32(options.sampleCount).u32(1).done(),
  );
}

function sampleSizeBox(options: Mp4FixtureOptions): Bin {
  return fullBox("stsz", 0, 0, new Bytes().u32(SAMPLE_BYTES).u32(options.sampleCount).done());
}

function chunkOffsetBox(dataOffset: number): Bin {
  return fullBox("stco", 0, 0, new Bytes().u32(1).u32(dataOffset).done());
}
