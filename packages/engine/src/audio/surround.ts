/**
 * Where a track's signal goes when the mix is laid out over more than two channels.
 *
 * The channel order is WAVE order and is stated once here: **L, R, C, LFE, Ls, Rs**. Every consumer in
 * this project — the offline context, the encoder, the meters — counts channels in that order, and a
 * second opinion about which index is the centre would be a mix that sounds right in one program and
 * wrong in the next.
 */
export const SURROUND_51 = 6;

/** The index of each channel in a 5.1 layout, so nothing downstream counts on its fingers. */
export const CHANNEL = { left: 0, right: 1, centre: 2, lfe: 3, rearLeft: 4, rearRight: 5 } as const;

// The roster itself lives in the core, beside the model it belongs to: `AUDIO_LAYOUTS` there and
// `AUDIO_LAYOUTS` in Rust are the same two numbers, and a third copy here is a third thing to keep in
// step. Re-exported so a caller that has the renderer does not need both packages for one list.
export { AUDIO_LAYOUTS as LAYOUTS, isSurround } from "@videola/core";

/**
 * A point in the surround field, as the gains it becomes.
 *
 * `pan` runs -1 (hard left) to 1 (hard right) and is the same number a stereo mix uses, so a project
 * switched from stereo to 5.1 keeps the placement it already had. `rear` runs 0 (front) to 1 (behind
 * the listener). Between them they are a position rather than two knobs, and this is the one place
 * that position becomes numbers.
 *
 * **Constant power in both directions.** Each axis is a quarter-circle sine/cosine law, so a track
 * swept from left to right or from front to back keeps the same loudness the whole way. A linear law
 * dips by 3 dB in the middle of every sweep, which is heard as the sound receding as it passes the
 * centre — the reason no desk uses one.
 *
 * **The centre speaker gets what is centred.** A hard-panned track has nothing in it; a track at
 * pan 0 is in it and not spread across L and R. That is what a centre channel is for, and it is the
 * difference between a dialogue track that sits on the screen and one that follows the listener as
 * they move off the middle seat.
 */
export function surroundGains(pan: number, rear: number): Float32Array {
  const gains = new Float32Array(SURROUND_51);
  const x = Math.min(Math.max(pan, -1), 1);
  const back = Math.min(Math.max(rear, 0), 1);
  const front = Math.cos((back * Math.PI) / 2);
  const behind = Math.sin((back * Math.PI) / 2);
  // Pairwise between the two speakers a position stands between, which is the standard way to pan a
  // multichannel layout and the only way the power stays put: mixing three amplitudes at once loses
  // half of it halfway, because amplitudes add and power is their square.
  //
  // Front: left to centre over the left half, centre to right over the right half.
  const frontAngle = ((x < 0 ? x + 1 : x) * Math.PI) / 2;
  if (x < 0) {
    gains[CHANNEL.left] = front * Math.cos(frontAngle);
    gains[CHANNEL.centre] = front * Math.sin(frontAngle);
  } else {
    gains[CHANNEL.centre] = front * Math.cos(frontAngle);
    gains[CHANNEL.right] = front * Math.sin(frontAngle);
  }
  // Behind there is no centre speaker, so the rear pair is one span from left to right.
  const rearAngle = ((x + 1) * Math.PI) / 4;
  gains[CHANNEL.rearLeft] = behind * Math.cos(rearAngle);
  gains[CHANNEL.rearRight] = behind * Math.sin(rearAngle);
  return gains;
}

/**
 * Where the two channels of a stereo track are placed.
 *
 * Not summed to mono and then placed: a stereo bed placed as a point would lose the width somebody
 * recorded, and a music track is the commonest thing on a surround timeline. Each channel is placed
 * half a pan-width to its own side, so a track left where it was — pan 0, front — sends its left
 * channel to the left speaker and its right to the right, exactly as a stereo mix does.
 *
 * Panned hard right and pushed fully back, both channels arrive at the right surround, which is what
 * a point source behind the listener is: no width at the far edge, because there is nowhere to spread.
 */
export function stereoSpread(pan: number, rear: number): readonly Float32Array[] {
  // A whole pan-width apart, not half: under a pairwise law the left speaker *is* pan -1, so a bed
  // left alone has to place its left channel there to come out of the front pair unchanged. Both
  // offsets clamp inside `surroundGains`, which is why a bed narrows as it approaches an edge and
  // becomes a point at it -- there is nothing beyond the last speaker to spread into.
  return [surroundGains(pan - 1, rear), surroundGains(pan + 1, rear)];
}

/**
 * The cutoff of the low-pass in front of the LFE send, in hertz.
 *
 * 120 Hz is what the specification for a 5.1 mix asks of that channel, and it is the reason an LFE
 * send is a send rather than a position: what goes there is a band, not a place.
 */
export const LFE_CUTOFF_HZ = 120;
