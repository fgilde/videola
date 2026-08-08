import { useMemo, type ReactElement } from "react";

import {
  cmd,
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
import "./Mixer.css";

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
  /** Where a keyframe written from a strip lands, and what the rows read their values at. */
  playhead?: Time;
  effects?: readonly MixerEffectDescriptor[];
  effectParamsAt?: (at: Time) => EffectParamSnapshot;
  dispatch: (command: Command, coalesceKey?: string) => void;
  onMeasure?: () => void;
  onSeek?: (time: Time) => void;
}

type Send = (command: Command, coalesceKey?: string) => void;

const NO_PARAMS: EffectParamSnapshot = new Map();

export function Mixer({
  project,
  loudness,
  measuring,
  playhead = 0,
  effects = [],
  effectParamsAt,
  dispatch,
  onMeasure,
  onSeek,
}: MixerProps): ReactElement {
  const { t } = useI18n();
  const tracks = project.timeline.tracks;
  // `project` is in the dependencies because the core hands out a fresh one per edit, while
  // `effectParamsAt` is bound to the document rather than to the state it is asked about.
  const resolved = useMemo(
    () => effectParamsAt?.(playhead) ?? NO_PARAMS,
    [effectParamsAt, playhead, project],
  );
  const chain = { offered: effects, resolved, playhead, send: dispatch, onSeek };

  return (
    <section className="v-mixer" aria-label={t("mixer.label")} data-testid="mixer">
      <div className="v-mixer__strips">
        {/* Left to right in the order the timeline stacks them from the top, so a strip sits above
            the track it belongs to rather than in the core's bottom-up order. */}
        {[...tracks].reverse().map((track) => (
          <Strip key={track.id} track={track} dispatch={dispatch} chain={chain} />
        ))}
        {/* Last, where a desk puts it: everything to its left feeds it. */}
        <MasterStrip
          project={project}
          dispatch={dispatch}
          chain={chain}
          loudness={loudness}
          measuring={measuring}
          onMeasure={onMeasure}
        />
      </div>

      {tracks.length === 0 && <p className="v-mixer__empty">{t("empty.noTracks")}</p>}
    </section>
  );
}

function Strip({
  track,
  dispatch,
  chain,
}: {
  track: Track;
  dispatch: (command: Command, coalesceKey?: string) => void;
  chain: ChainContext;
}): ReactElement {
  const { t } = useI18n();

  return (
    <div className="v-mixer__strip" data-track-id={track.id}>
      <span className="v-mixer__name" style={{ borderLeftColor: track.colorHex }}>
        {track.name}
      </span>
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
      </div>
      <Chain {...chain} target={on.track(track.id)} authored={track.effects} />
    </div>
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
}: {
  project: Project;
  dispatch: Send;
  chain: ChainContext;
  loudness?: number;
  measuring?: boolean;
  onMeasure?: () => void;
}): ReactElement {
  const { t } = useI18n();
  const name = t("mixer.master");

  return (
    <div className="v-mixer__strip v-mixer__strip--master" data-testid="mixer-master">
      <span className="v-mixer__name">{name}</span>
      <ParamRow
        label={t("mixer.volumeShort")}
        name={t("mixer.volume", { name })}
        value={project.master.volume}
        min={0}
        max={MAX_GAIN}
        onChange={(value, key) => dispatch(cmd.projectSetMasterVolume(value), key)}
      />
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
      <Chain {...chain} target={on.project} authored={project.master.effects} />
    </div>
  );
}

interface ChainContext {
  offered: readonly MixerEffectDescriptor[];
  resolved: EffectParamSnapshot;
  playhead: Time;
  send: Send;
  onSeek?: (time: Time) => void;
}

// One insert chain, for a track bus or for the master. The two differ only in what they are pointed
// at, which is the whole reason `EffectTarget` exists.
function Chain({
  offered,
  resolved,
  playhead,
  send,
  onSeek,
  target,
  authored,
}: ChainContext & { target: EffectTarget; authored: readonly Effect[] }): ReactElement | null {
  const { locale } = useI18n();
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
