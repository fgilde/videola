import { useMemo, useState, type ReactElement } from "react";

import {
  AUDIO_LAYOUTS,
  cmd,
  isSurround,
  on,
  type Command,
  type Effect,
  type EffectParamSnapshot,
  type EffectTarget,
  type Interp,
  type ParamValue,
  type Project,
  type Time,
  type Track,
} from "@videola/core";

import { useI18n, type Locale } from "../i18n/useI18n";
import { keyframeAt, ParamRow, shownValue } from "../inspector/ParamRow";
import type { EffectParamDescriptor } from "../inspector/Inspector";
import { AddEffect } from "../primitives/AddEffect";
import { IconButton } from "../primitives/Icon";
import { LevelMeter, type ReadLevel } from "./LevelMeter";
import { Reduction } from "./Reduction";
import "./Mixer.css";

/** What `readLevel` is asked for the master bus; every other key is a track id. */
export const MASTER_BUS = "master";

// Which inserts have a gain reduction to report. The two are the same native node held at different
// settings, and no other insert applies a gain that depends on what is going through it.
const REDUCES = new Set(["compressor", "limiter"]);

// The accepted maximum for a track gain, as the core states it in `track.setVolume`.
const MAX_GAIN = 4;

/**
 * What the mixer needs of an audio effect to put knobs on it. `AudioEffectManifest` from
 * @videola/engine satisfies this structurally, which is how the strip labels an equaliser without
 * this package depending on the engine -- the same arrangement the inspector has for video effects,
 * minus the input count, which only a compositor cares about.
 */
export interface MixerEffectDescriptor {
  id: string;
  name: Record<Locale, string>;
  params: readonly EffectParamDescriptor[];
}

export interface MixerProps {
  project: Project;
  /**
   * Programme loudness of the whole project in LUFS, or undefined while nothing has been measured.
   * Measuring means rendering the timeline, so it happens when it is asked for and not per frame.
   */
  loudness?: number;
  measuring?: boolean;
  /**
   * What every strip's meter is asked, with the bus id and the animation frame's own timestamp.
   * Left out, the strips have no meters -- which is the honest state of a mixer with no transport
   * behind it rather than a row of bars stuck at silence.
   */
  readLevel?: (bus: string, nowMs: number) => { peak: number; rms: number; hold: number } | undefined;
  /**
   * How hard one compressor is working, by effect id, in decibels below zero. Absent where the host has
   * no audio graph to ask: the bar is then not drawn, rather than drawn at zero.
   */
  readReduction?: (effect: string) => number | undefined;
  /**
   * False while the transport is stopped. The meters then paint silence and stop asking -- see
   * `LevelMeter`, where the loop that never ends turns out to be the expensive kind of never.
   */
  metering?: boolean;
  /** Where a keyframe written from a strip lands, and what the rows read their values at. */
  playhead?: Time;
  effects?: readonly MixerEffectDescriptor[];
  effectParamsAt?: (at: Time) => EffectParamSnapshot;
  dispatch: (command: Command, coalesceKey?: string) => void;
  onMeasure?: () => void;
  /**
   * The three actions that need decoded samples rather than the project alone -- so they are the
   * caller's, the same way the loudness reading is. The mixer knows where the buttons go and what
   * they are called; what a duck sounds like is the engine's business.
   */
  onNormalize?: (targetLufs: number) => void;
  normalizing?: boolean;
  onDuck?: (music: string, speech: string) => void;
  onCutSilence?: (track: string) => void;
  onMarkBeats?: (track: string) => void;
  onSeek?: (time: Time) => void;
}

/** The targets `LOUDNESS_TARGETS` names, as the rows of the picker -- value and catalogue key. */
const TARGETS: readonly { lufs: number; key: string }[] = [
  { lufs: -14, key: "streaming" },
  { lufs: -16, key: "podcast" },
  { lufs: -23, key: "broadcast" },
];

type Send = (command: Command, coalesceKey?: string) => void;

const NO_PARAMS: EffectParamSnapshot = new Map();

export function Mixer({
  project,
  loudness,
  measuring,
  readLevel,
  readReduction,
  metering = true,
  playhead = 0,
  effects = [],
  effectParamsAt,
  dispatch,
  onMeasure,
  onNormalize,
  normalizing,
  onDuck,
  onCutSilence,
  onMarkBeats,
  onSeek,
}: MixerProps): ReactElement {
  const { t } = useI18n();
  const tracks = project.timeline.tracks;
  const surround = isSurround(project.settings.audioChannels ?? 2);
  // `project` is in the dependencies because the core hands out a fresh one per edit, while
  // `effectParamsAt` is bound to the document rather than to the state it is asked about.
  const resolved = useMemo(
    () => effectParamsAt?.(playhead) ?? NO_PARAMS,
    [effectParamsAt, playhead, project],
  );
  const chain = { offered: effects, resolved, playhead, send: dispatch, onSeek, readReduction, metering };
  const meter = (bus: string): ReadLevel | undefined =>
    readLevel === undefined ? undefined : (now) => readLevel(bus, now);

  return (
    <section className="v-mixer" aria-label={t("mixer.label")} data-testid="mixer">
      <div className="v-mixer__strips">
        {/* Left to right in the order the timeline stacks them from the top, so a strip sits above
            the track it belongs to rather than in the core's bottom-up order. */}
        {[...tracks].reverse().map((track) => (
          <Strip
            key={track.id}
            track={track}
            others={tracks.filter((other) => other.id !== track.id)}
            surround={surround}
            dispatch={dispatch}
            chain={chain}
            read={meter(track.id)}
            metering={metering}
            onDuck={onDuck}
            onCutSilence={onCutSilence}
            onMarkBeats={onMarkBeats}
          />
        ))}
        {/* Last, where a desk puts it: everything to its left feeds it. */}
        <MasterStrip
          project={project}
          dispatch={dispatch}
          chain={chain}
          loudness={loudness}
          measuring={measuring}
          onMeasure={onMeasure}
          onNormalize={onNormalize}
          normalizing={normalizing}
          read={meter(MASTER_BUS)}
          metering={metering}
        />
      </div>

      {tracks.length === 0 && <p className="v-mixer__empty">{t("empty.noTracks")}</p>}
    </section>
  );
}

function Strip({
  track,
  others,
  surround,
  dispatch,
  chain,
  read,
  metering,
  onDuck,
  onCutSilence,
  onMarkBeats,
}: {
  track: Track;
  others: readonly Track[];
  /** True where the project is laid out over more than two channels. */
  surround: boolean;
  dispatch: (command: Command, coalesceKey?: string) => void;
  chain: ChainContext;
  read?: ReadLevel;
  metering?: boolean;
  onDuck?: (music: string, speech: string) => void;
  onCutSilence?: (track: string) => void;
  onMarkBeats?: (track: string) => void;
}): ReactElement {
  const { t } = useI18n();

  return (
    <div className="v-mixer__strip" data-track-id={track.id}>
      {/* Meter beside the name and not under it: a row of its own is ten pixels plus a gap on
          every strip, the mixer row is sized to fit its strips, and the preview above pays for
          it -- measured at 223 px against a floor of 230 in the browser harness. */}
      <div className="v-mixer__head">
        <span className="v-mixer__name" style={{ borderLeftColor: track.colorHex }}>
          {track.name}
        </span>
        {read !== undefined && (
          <LevelMeter read={read} active={metering} label={t("mixer.level", { name: track.name })} />
        )}
      </div>
      <ParamRow
        label={t("mixer.volumeShort")}
        name={t("mixer.volume", { name: track.name })}
        value={track.volume}
        min={0}
        max={MAX_GAIN}
        onChange={(value, key) => dispatch(cmd.trackSetVolume(track.id, value), key)}
      />
      <ParamRow
        label={t("mixer.panShort")}
        name={t("mixer.pan", { name: track.name })}
        value={track.pan}
        min={-1}
        max={1}
        onChange={(value, key) => dispatch(cmd.trackSetPan(track.id, value), key)}
      />
      {surround && (
        <>
          <ParamRow
            label={t("mixer.rearShort")}
            name={t("mixer.rear", { name: track.name })}
            value={track.rear ?? 0}
            min={0}
            max={1}
            onChange={(value, key) =>
              dispatch(cmd.trackSetSurround(track.id, value, track.lfe ?? 0), key)
            }
          />
          <ParamRow
            label={t("mixer.lfeShort")}
            name={t("mixer.lfe", { name: track.name })}
            value={track.lfe ?? 0}
            min={0}
            max={1}
            onChange={(value, key) =>
              dispatch(cmd.trackSetSurround(track.id, track.rear ?? 0, value), key)
            }
          />
        </>
      )}
      <div className="v-mixer__flags">
        {/* Mute beats solo in the graph, so the two buttons are independent here as well: a track
            that is both stays silent, and pressing solo on it must not quietly clear its mute. */}
        <button
          type="button"
          className="v-button v-button--icon v-mixer__flag"
          aria-label={t("mixer.mute", { name: track.name })}
          aria-pressed={track.muted}
          onClick={() => dispatch(cmd.trackSetFlags(track.id, !track.muted))}
        >
          M
        </button>
        <button
          type="button"
          className="v-button v-button--icon v-mixer__flag"
          aria-label={t("mixer.solo", { name: track.name })}
          aria-pressed={track.solo}
          onClick={() => dispatch(cmd.trackSetFlags(track.id, null, !track.solo))}
        >
          S
        </button>
        <Tools track={track} others={others} onDuck={onDuck} onCutSilence={onCutSilence} onMarkBeats={onMarkBeats} />
      </div>
      <Chain {...chain} target={on.track(track.id)} authored={track.effects} />
    </div>
  );
}

// The two actions that are about one track and about the samples under it. They sit on the strip
// rather than in the timeline's clip menu because both are decisions about a whole bus -- a bed
// ducks as one thing however many clips it was cut into, and a voice track's pauses are the pauses
// between its phrases and not between its clips.
//
// On the mute and solo line rather than on a line of their own, and that is a measurement rather
// than a preference: a fifth row per strip grew the mixer by sixty pixels, the editor's mixer row
// is sized to fit its strips, and the preview above lost exactly that. The browser harness caught
// it -- the picture fell to 223 px against a floor of 230.
//
// Ducking is a picker because it needs a second track named and there is no sensible guess: the
// strip is the music and the choice is which voice it gets out of the way of. Cutting silence is a
// symbol because the row has no width left for its name -- scissors and not a bin, which beside a
// track name would read as "delete the track".
function Tools({
  track,
  others,
  onDuck,
  onCutSilence,
  onMarkBeats,
}: {
  track: Track;
  others: readonly Track[];
  onDuck?: (music: string, speech: string) => void;
  onCutSilence?: (track: string) => void;
  onMarkBeats?: (track: string) => void;
}): ReactElement | null {
  const { t } = useI18n();
  if (onDuck === undefined && onCutSilence === undefined && onMarkBeats === undefined) return null;

  return (
    <>
      {onDuck !== undefined && others.length > 0 && (
        <select
          className="v-mixer__duck"
          aria-label={t("mixer.duckOf", { name: track.name })}
          value=""
          onChange={(event) => {
            if (event.target.value !== "") onDuck(track.id, event.target.value);
          }}
        >
          <option value="">{t("mixer.duck")}</option>
          {others.map((other) => (
            <option key={other.id} value={other.id}>
              {other.name}
            </option>
          ))}
        </select>
      )}
      {onCutSilence !== undefined && (
        <IconButton
          icon="scissors"
          label={t("mixer.cutSilenceOf", { name: track.name })}
          onClick={() => onCutSilence(track.id)}
        />
      )}
      {/* Markers and not cuts: where the beat falls is a suggestion to cut against, and a hundred
          cuts nobody asked for are a hundred clips to take back one at a time. */}
      {onMarkBeats !== undefined && (
        <IconButton
          icon="metronome"
          label={t("mixer.markBeatsOf", { name: track.name })}
          onClick={() => onMarkBeats(track.id)}
        />
      )}
    </>
  );
}

// The last strip, and the only one with no clips under it. Its fader is the project's, which is why
// it dispatches a project command rather than a track one -- and its chain is the mastering chain,
// the last thing the mix passes through before it leaves.
//
// The programme loudness lives here as well. It is a measurement of what leaves the master and of
// nothing else, and as a bar under the strips it was a row of its own across the whole editor for
// one button and one number.
function MasterStrip({
  project,
  dispatch,
  chain,
  loudness,
  measuring,
  onMeasure,
  onNormalize,
  normalizing,
  read,
  metering,
}: {
  project: Project;
  dispatch: Send;
  chain: ChainContext;
  loudness?: number;
  measuring?: boolean;
  onMeasure?: () => void;
  onNormalize?: (targetLufs: number) => void;
  normalizing?: boolean;
  read?: ReadLevel;
  metering?: boolean;
}): ReactElement {
  const { t } = useI18n();
  const name = t("mixer.master");

  return (
    <div className="v-mixer__strip v-mixer__strip--master" data-testid="mixer-master">
      <div className="v-mixer__head">
        <span className="v-mixer__name">{name}</span>
        {read !== undefined && (
          <LevelMeter read={read} active={metering} label={t("mixer.level", { name })} />
        )}
      </div>
      <ParamRow
        label={t("mixer.volumeShort")}
        name={t("mixer.volume", { name })}
        value={project.master.volume}
        min={0}
        max={MAX_GAIN}
        onChange={(value, key) => dispatch(cmd.projectSetMasterVolume(value), key)}
      />
      {/* Where the mix is laid out, on the strip the mix leaves through. A select rather than a switch
          because it is an answer to one question and the list will grow -- and it says how many
          channels each answer is, because that is the number the export and the meters count in. */}
      <label className="v-mixer__layout">
        <span className="v-mixer__layoutLabel">{t("mixer.layout")}</span>
        <select
          aria-label={t("mixer.layout")}
          value={project.settings.audioChannels ?? 2}
          onChange={(event) =>
            dispatch(
              cmd.projectSetSettings({
                ...project.settings,
                audioChannels: Number(event.target.value),
              }),
            )
          }
        >
          {AUDIO_LAYOUTS.map((channels) => (
            <option key={channels} value={channels}>
              {t(`mixer.layout.${channels}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="v-mixer__loudness">
        <button
          type="button"
          className="v-button"
          disabled={measuring === true || onMeasure === undefined}
          onClick={() => onMeasure?.()}
        >
          {t(measuring === true ? "mixer.measuring" : "mixer.measure")}
        </button>
        <output className="v-mixer__reading" data-testid="mixer-loudness">
          {formatLufs(loudness, t)}
        </output>
      </div>
      {onNormalize !== undefined && <Normalize onNormalize={onNormalize} busy={normalizing} />}
      <Chain {...chain} target={on.project} authored={project.master.effects} />
    </div>
  );
}

// Picker and button rather than a button per target: three of them across a strip 220 pixels wide
// would each be four characters and a guess. The target is remembered in the strip and not in the
// project, because it is a fact about where the file is going rather than about the film.
//
// What comes back after this is a fresh reading in the readout above, and it is a reading and not
// the target: the master fader sits behind the mastering chain, so the correction is a plain gain
// over it -- but the loudness gates are level-dependent all the same, and the number shown is
// always one that was measured.
function Normalize({
  onNormalize,
  busy,
}: {
  onNormalize: (targetLufs: number) => void;
  busy?: boolean;
}): ReactElement {
  const { t } = useI18n();
  const [target, setTarget] = useState(TARGETS[0]!.lufs);

  return (
    <div className="v-mixer__normalize">
      <select
        className="v-mixer__target"
        aria-label={t("mixer.target")}
        value={target}
        onChange={(event) => setTarget(Number(event.target.value))}
      >
        {TARGETS.map((entry) => (
          <option key={entry.key} value={entry.lufs}>
            {t(`mixer.target.${entry.key}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="v-button"
        disabled={busy === true}
        onClick={() => onNormalize(target)}
      >
        {t(busy === true ? "mixer.normalizing" : "mixer.normalize")}
      </button>
    </div>
  );
}

interface ChainContext {
  offered: readonly MixerEffectDescriptor[];
  resolved: EffectParamSnapshot;
  playhead: Time;
  send: Send;
  onSeek?: (time: Time) => void;
  /**
   * How hard a compressor is working, by effect id. Absent where the host has no graph to ask -- the
   * bar is then not drawn at all rather than drawn at zero, which would be a reading.
   */
  readReduction?: (effect: string) => number | undefined;
  metering?: boolean;
}

// One insert chain, for a track bus or for the master. The two differ only in what they are pointed
// at, which is the whole reason `EffectTarget` exists.
function Chain({
  offered,
  resolved,
  playhead,
  send,
  onSeek,
  readReduction,
  metering,
  target,
  authored,
}: ChainContext & { target: EffectTarget; authored: readonly Effect[] }): ReactElement | null {
  const { t, locale } = useI18n();
  const addable = offered.filter(
    (manifest) => !authored.some((entry) => entry.effectType === manifest.id),
  );
  if (offered.length === 0) return null;

  return (
    <div className="v-mixer__chain">
      {authored.map((entry) => {
        const manifest = offered.find((candidate) => candidate.id === entry.effectType);
        // An effect this build cannot make a sound with -- a blur someone dropped on a bus, or a
        // type from a newer version. The graph passes it through, and a slider that moved nothing
        // would be worse than the honest absence of one.
        if (manifest === undefined) return null;
        return (
          <div key={entry.id} className="v-mixer__effect">
            <h4 className="v-mixer__effectName">{manifest.name[locale]}</h4>
            {/* Only for a node that has an answer: `reduction` belongs to the compressor and the
                limiter, and a bar under an equaliser would be a reading of nothing. */}
            {readReduction !== undefined && REDUCES.has(manifest.id) && (
              <Reduction
                read={() => readReduction(entry.id)}
                active={metering}
                label={t("mixer.reduction", { name: manifest.name[locale] })}
              />
            )}
            {manifest.params.map((param) => (
              <ChainParam
                key={param.key}
                target={target}
                effect={entry}
                param={param}
                value={shownValue(param, resolved.get(entry.id)?.get(param.key)?.value)}
                playhead={playhead}
                send={send}
                onSeek={onSeek}
              />
            ))}
          </div>
        );
      })}
      <AddEffect offers={addable} onAdd={(id) => send(cmd.effectAdd(target, id))} />
    </div>
  );
}

// One knob. Unlike a clip's, a bus parameter is settable wherever the playhead stands: a track and
// a mastering chain have no window to fall outside of, which is exactly what `effectParamsAt`
// already says by answering for them at every moment.
function ChainParam({
  target,
  effect,
  param,
  value,
  playhead,
  send,
  onSeek,
}: {
  target: EffectTarget;
  effect: Effect;
  param: EffectParamDescriptor;
  value: number;
  playhead: Time;
  send: Send;
  onSeek?: (time: Time) => void;
}): ReactElement {
  const { locale } = useI18n();
  const track = effect.keyframes[param.key] ?? [];
  const keyframed = track.length > 0;
  const set = (next: number, interp: Interp = "linear"): Command =>
    cmd.keyframeAdd(target, effect.effectType, param.key, playhead, float(next), interp);

  return (
    <ParamRow
      label={param.name[locale]}
      value={value}
      min={param.min}
      max={param.max}
      onChange={(next, coalesceKey) =>
        send(
          keyframed
            ? // Not a plain "linear": the upsert must not turn a held keyframe into a ramp.
              set(next, keyframeAt(track, playhead)?.interp ?? "linear")
            : cmd.effectSetParam(target, effect.effectType, param.key, float(next)),
          coalesceKey,
        )
      }
      // Without somewhere to seek to, the strip's arrows would be three buttons that do nothing.
      keyframes={
        onSeek === undefined
          ? undefined
          : {
              at: playhead,
              track,
              settable: true,
              onAdd: () => send(set(value)),
              onRemove: () =>
                send(cmd.keyframeRemove(target, effect.effectType, param.key, playhead)),
              onGoTo: onSeek,
              onInterp: (interp) =>
                send(cmd.keyframeSetInterp(target, effect.effectType, param.key, playhead, interp)),
            }
      }
    />
  );
}

function float(value: number): ParamValue {
  return { kind: "float", value };
}

// A silent programme has no loudness, and -Infinity LUFS on screen reads as a broken readout rather
// than as silence. Nothing measured yet and nothing to measure are different states and say so.
function formatLufs(
  loudness: number | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (loudness === undefined) return t("mixer.unmeasured");
  if (!Number.isFinite(loudness)) return t("mixer.silent");
  return t("mixer.lufs", { value: loudness.toFixed(1) });
}
