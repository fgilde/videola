import { useMemo, type ReactElement } from "react";

import {
  cmd,
  frameHold,
  kenBurns,
  on,
  pictureInPicture,
  secondsToTime,
  speedRamp,
  stageFor,
  timeToSeconds,
  type Clip,
  type ClipId,
  type Command,
  type Effect,
  type EffectParamSnapshot,
  type Interp,
  type MediaAsset,
  type ParamValue,
  type Project,
  type ProjectSettings,
  type Time,
  type Transform,
  type TransformSnapshot,
  type Transition,
} from "@videola/core";

import { useI18n, type Locale } from "../i18n/useI18n";
import { AddEffect } from "../primitives/AddEffect";
import { POSITION_TRACK } from "../timeline/keyframes";
import { findClip } from "../timeline/useTimelineGestures";
import { keyframeAt, ParamRow, shownValue } from "./ParamRow";
import "./Inspector.css";

/**
 * What the inspector needs of an effect to show it. `EffectManifest` from `@videola/engine`
 * satisfies this structurally, and the compiler proves that at the wiring point -- which is how
 * the surface labels effects it knows nothing about without this package depending on the engine
 * and, through it, on a demuxer.
 */
export interface EffectDescriptor {
  id: string;
  name: Record<Locale, string>;
  inputs: 1 | 2;
  params: readonly EffectParamDescriptor[];
}

export interface EffectParamDescriptor {
  key: string;
  name: Record<Locale, string>;
  default: number;
  min: number;
  max: number;
}

export interface InspectorProps {
  project: Project;
  clip: ClipId | undefined;
  playhead: Time;
  effects: readonly EffectDescriptor[];
  effectParamsAt: (at: Time) => EffectParamSnapshot;
  /**
   * Where the core says the clip actually stands. `clip.transform` is the value at rest only; once
   * a field is keyframed it is the one thing on screen that is no longer true, and a slider reading
   * the static number while the picture is somewhere else is exactly the divergence the resolution
   * lives in the core to prevent.
   */
  transformsAt: (at: Time) => TransformSnapshot;
  /** Throws when the core refuses, like the timeline's. Nothing here is an ordinary refusal. */
  dispatch: (command: Command, coalesceKey?: string) => void;
  onSeek: (time: Time) => void;
}

type Send = (command: Command, coalesceKey?: string) => void;

export function Inspector({
  project,
  clip,
  playhead,
  effects,
  effectParamsAt,
  transformsAt,
  dispatch,
  onSeek,
}: InspectorProps): ReactElement {
  const { t } = useI18n();
  const found = clip === undefined ? undefined : findClip(project, clip);

  return (
    <aside className="v-inspector" aria-label={t("inspector.label")} data-testid="inspector">
      {found === undefined ? (
        <p className="v-inspector__empty">{t("inspector.empty")}</p>
      ) : (
        <>
          <Transform_
            clip={found.clip}
            project={project}
            playhead={playhead}
            transformsAt={transformsAt}
            send={dispatch}
            onSeek={onSeek}
          />
          <Playback clip={found.clip} send={dispatch} />
          <Presets clip={found.clip} project={project} playhead={playhead} send={dispatch} />
          <Transitions clip={found.clip} effects={effects} send={dispatch} />
          <Effects
            clip={found.clip}
            playhead={playhead}
            effects={effects}
            effectParamsAt={effectParamsAt}
            send={dispatch}
            onSeek={onSeek}
          />
        </>
      )}
    </aside>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }): ReactElement {
  return (
    <section className="v-inspector__group">
      <h3 className="v-inspector__title">{title}</h3>
      {children}
    </section>
  );
}

interface TransformField {
  key: "x" | "y" | "scaleX" | "scaleY" | "rotation" | "opacity";
  min: number;
  max: number;
}

// Anchor and crop are not here. Both are fractions of the source with no visible handle to grab,
// and a slider for a pivot point is worse than none -- they wait for an on-canvas gizmo.
function transformFields(settings: ProjectSettings): readonly TransformField[] {
  return [
    { key: "x", min: -settings.width, max: settings.width },
    { key: "y", min: -settings.height, max: settings.height },
    { key: "scaleX", min: 0, max: 4 },
    { key: "scaleY", min: 0, max: 4 },
    { key: "rotation", min: -180, max: 180 },
    { key: "opacity", min: 0, max: 1 },
  ];
}

// Named with a trailing underscore because `Transform` is the model type this section edits.
function Transform_({
  clip,
  project,
  playhead,
  transformsAt,
  send,
  onSeek,
}: {
  clip: Clip;
  project: Project;
  playhead: Time;
  transformsAt: (at: Time) => TransformSnapshot;
  send: Send;
  onSeek: (time: Time) => void;
}): ReactElement {
  const { t } = useI18n();
  const source = sourceSize(clip, project.library);
  const path = (clip.keyframes[POSITION_TRACK] ?? []).length > 0;
  const inside = playhead >= clip.start && playhead < clip.start + clip.duration;
  // The same window `Effects` asks in, for the same reason: the core answers for a moment the clip
  // covers, and working the interpolation out here instead would be the divergence between preview
  // and export that the core exists to prevent.
  const at = Math.min(Math.max(playhead, clip.start), clip.start + clip.duration - 1);
  // `clip` is in the dependencies because it is a fresh object on every state the core hands out.
  const resolved = useMemo(() => transformsAt(at).get(clip.id), [transformsAt, at, clip]);
  const set = (patch: Partial<Transform>, coalesceKey?: string): void =>
    send(cmd.clipSetTransform(clip.id, { ...clip.transform, ...patch }), coalesceKey);

  return (
    <Group title={t("inspector.transform")}>
      {path && <p className="v-inspector__note">{t("inspector.motionPath")}</p>}
      {transformFields(project.settings).map((field) => {
        const track = clip.keyframes[field.key] ?? [];
        // A path resolves last and overwrites both, so a switch on either of those two rows would
        // write a keyframe that never reaches a pixel. No switch at all is the honest answer; the
        // note above the group says why, and the lane shows the keys that are there.
        const overridden = path && (field.key === "x" || field.key === "y");
        return (
          <ParamRow
            key={field.key}
            label={t(`inspector.${field.key}`)}
            // What the core resolves, not what the clip holds at rest. The two differ on every
            // keyframed field, and the static one is the number no picture is drawn from.
            value={resolved?.[field.key] ?? clip.transform[field.key]}
            min={field.min}
            max={field.max}
            // A slider that moves a number the renderer never reads is worse than one that says it
            // is not in charge. Keyframed and the playhead elsewhere is the same case: the static
            // value is ignored once a track exists, so there is nothing it could truthfully do.
            disabled={overridden || (track.length > 0 && !inside)}
            onChange={(value, coalesceKey) =>
              send(
                track.length > 0
                  ? // Not a plain "linear": the upsert must not turn a held keyframe into a ramp.
                    cmd.keyframeAdd(
                      on.clip(clip.id),
                      null,
                      field.key,
                      playhead,
                      float(value),
                      keyframeAt(track, playhead)?.interp ?? "linear",
                    )
                  : cmd.clipSetTransform(clip.id, { ...clip.transform, [field.key]: value }),
                coalesceKey,
              )
            }

            keyframes={
              overridden
                ? undefined
                : {
                    at: playhead,
                    track,
                    settable: inside,
                    onAdd: () =>
                      send(
                        cmd.keyframeAdd(
                          on.clip(clip.id),
                          null,
                          field.key,
                          playhead,
                          float(resolved?.[field.key] ?? clip.transform[field.key]),
                        ),
                      ),
                    onRemove: () =>
                      send(cmd.keyframeRemove(on.clip(clip.id), null, field.key, playhead)),
                    onGoTo: onSeek,
                    onInterp: (interp) =>
                      send(
                        cmd.keyframeSetInterp(on.clip(clip.id), null, field.key, playhead, interp),
                      ),
                  }
            }
          />
        );
      })}
      <button
        type="button"
        className="v-button"
        // Fitting writes the four static fields, and every one of them that is keyframed -- or
        // replaced by a path -- is a field the renderer no longer reads. The same rule that leaves
        // the two path rows without a switch: no control that does nothing.
        disabled={source === undefined || placementIsAnimated(clip)}
        onClick={() => source !== undefined && set(fitted(source, project.settings))}
      >
        {t("inspector.fit")}
      </button>
    </Group>
  );
}

// Whether anything the fit button would write is already on the clock. `position` counts because it
// is what the two placement fields resolve from once it exists.
function placementIsAnimated(clip: Clip): boolean {
  return [POSITION_TRACK, "x", "y", "scaleX", "scaleY"].some(
    (key) => (clip.keyframes[key] ?? []).length > 0,
  );
}

interface Size {
  width: number;
  height: number;
}

// The draw list maps one source pixel onto one project pixel, so a clip that is not the project's
// size sits as a rectangle somewhere in the frame. This is what `clip.setTransform` exists for.
// The anchor defaults to the middle of the source, so x and y at zero centre what is scaled.
function fitted(source: Size, settings: ProjectSettings): Partial<Transform> {
  const scale = Math.min(settings.width / source.width, settings.height / source.height);
  return { x: 0, y: 0, scaleX: scale, scaleY: scale };
}

function sourceSize(clip: Clip, library: readonly MediaAsset[]): Size | undefined {
  const source = clip.source;
  if (source.kind !== "media") return undefined;
  const asset = library.find((entry) => entry.id === source.media);
  if (asset?.width == null || asset.height == null) return undefined;
  return { width: asset.width, height: asset.height };
}

function Playback({ clip, send }: { clip: Clip; send: Send }): ReactElement {
  const { t } = useI18n();
  // `preservePitch` is carried through rather than shown: sending the default would silently
  // undo a project that set it, and there is no second control worth a row for it yet.
  const speed = (rate: number, reverse: boolean): Command =>
    cmd.clipSetSpeed(clip.id, rate, reverse, clip.speed.preservePitch);

  return (
    <Group title={t("inspector.playback")}>
      <ParamRow
        label={t("inspector.volume")}
        value={clip.volume}
        min={0}
        max={2}
        onChange={(value, coalesceKey) => send(cmd.clipSetVolume(clip.id, value), coalesceKey)}
      />
      <ParamRow
        label={t("inspector.rate")}
        value={clip.speed.rate}
        min={0.1}
        max={4}
        onChange={(value, coalesceKey) => send(speed(value, clip.speed.reverse), coalesceKey)}
      />
      <div className="v-param">
        <span className="v-param__label">{t("inspector.reverse")}</span>
        <button
          type="button"
          className="v-button v-param__toggle"
          aria-pressed={clip.speed.reverse}
          onClick={() => send(speed(clip.speed.rate, !clip.speed.reverse))}
        >
          {t("inspector.reverse")}
        </button>
      </div>
    </Group>
  );
}

// Every entry is a list of commands sent under one key, which is the whole of what a preset is here
// (see packages/core/src/presets.ts). One key means one press of undo; the inverse comes from
// `json_patch::diff` like every other edit's. An entry whose list comes back empty is disabled
// rather than shown doing nothing -- `frameHold` refuses a reversed clip and a playhead outside the
// clip, and that refusal is what the button reads to decide.
function Presets({
  clip,
  project,
  playhead,
  send,
}: {
  clip: Clip;
  project: Project;
  playhead: Time;
  send: Send;
}): ReactElement {
  const { t } = useI18n();
  const stage = stageFor(project, clip);
  // A picture in picture is a picture over another one, so it needs somewhere above to stand. The
  // track order is the stacking order; without one higher up the clip stays where it is and only
  // shrinks, which is still the honest half of the preset.
  const index = project.timeline.tracks.findIndex((track) =>
    track.clips.some((candidate) => candidate.id === clip.id),
  );
  const above = project.timeline.tracks
    .slice(index + 1)
    .find((track) => track.kind === "video")?.id;

  const entries: [string, Command[]][] = [
    ["freeze", frameHold(clip, playhead)],
    ["slowIn", speedRamp(clip, "slowIn")],
    ["slowOut", speedRamp(clip, "slowOut")],
    ["slowMiddle", speedRamp(clip, "slowMiddle")],
    ["kenBurnsIn", kenBurns(clip, stage, "in")],
    ["kenBurnsOut", kenBurns(clip, stage, "out")],
    ["pip", pictureInPicture(clip, stage, "bottomRight", above)],
  ];

  return (
    <Group title={t("inspector.presets")}>
      <div className="v-inspector__presets">
        {entries.map(([name, commands]) => (
          <button
            key={name}
            type="button"
            className="v-button v-inspector__preset"
            disabled={commands.length === 0}
            onClick={() => {
              const key = `preset:${name}:${(presetSequence += 1)}`;
              for (const command of commands) send(command, key);
            }}
          >
            {t(`inspector.preset.${name}`)}
          </button>
        ))}
      </div>
    </Group>
  );
}

// A fresh key per press, so two runs of the same preset are two undo steps rather than one merged
// into the other. The same counter trick the timeline's own multi-clip actions use.
let presetSequence = 0;

const DEFAULT_TRANSITION_SECONDS = 1;

function Transitions({
  clip,
  effects,
  send,
}: {
  clip: Clip;
  effects: readonly EffectDescriptor[];
  send: Send;
}): ReactElement {
  const { t, locale } = useI18n();
  // A cleared transition is `undefined` rather than `null`: the field carries skip_serializing_if
  // and simply is not there.
  const current = clip.transitionIn ?? undefined;
  const offered = effects.filter((manifest) => manifest.inputs === 2);

  return (
    <Group title={t("inspector.transition")}>
      <div className="v-param">
        <span className="v-param__label">{t("inspector.transition")}</span>
        <select
          className="v-param__select"
          aria-label={t("inspector.transition")}
          value={current?.transitionType ?? ""}
          onChange={(event) =>
            send(cmd.clipSetTransition(clip.id, chosen(event.target.value, current)))
          }
        >
          <option value="">{t("inspector.transitionNone")}</option>
          {offered.map((manifest) => (
            <option key={manifest.id} value={manifest.id}>
              {manifest.name[locale]}
            </option>
          ))}
        </select>
      </div>
      {current !== undefined && (
        <ParamRow
          label={t("inspector.transitionDuration")}
          value={timeToSeconds(current.duration)}
          min={0.1}
          max={5}
          onChange={(value, coalesceKey) =>
            send(
              cmd.clipSetTransition(clip.id, { ...current, duration: secondsToTime(value) }),
              coalesceKey,
            )
          }
        />
      )}
    </Group>
  );
}

// Aligned to `in` and nowhere else: the window of a centred or trailing transition reaches back
// before the clip starts, where the clip is not drawn at all, so half the dissolve would never be
// seen. Playing those out needs handles, and no command in M1 creates them.
function chosen(type: string, current: Transition | undefined): Transition | null {
  if (type === "") return null;
  return {
    transitionType: type,
    duration: current?.duration ?? secondsToTime(DEFAULT_TRANSITION_SECONDS),
    alignment: "in",
    params: current?.params ?? {},
  };
}

function Effects({
  clip,
  playhead,
  effects,
  effectParamsAt,
  send,
  onSeek,
}: {
  clip: Clip;
  playhead: Time;
  effects: readonly EffectDescriptor[];
  effectParamsAt: (at: Time) => EffectParamSnapshot;
  send: Send;
  onSeek: (time: Time) => void;
}): ReactElement {
  const { t, locale } = useI18n();
  const inside = playhead >= clip.start && playhead < clip.start + clip.duration;
  // The core answers for a moment the clip covers, so with the playhead elsewhere the question is
  // asked at the nearest edge instead. Falling back to the static value would be wrong for a
  // keyframed parameter, and working the interpolation out here is the divergence between preview
  // and export that the core exists to prevent.
  const at = Math.min(Math.max(playhead, clip.start), clip.start + clip.duration - 1);
  // `clip` is in the dependencies because it is a fresh object on every project state the core
  // hands out, and `effectParamsAt` is bound to the document rather than to the state.
  const resolved = useMemo(() => effectParamsAt(at), [effectParamsAt, at, clip]);
  const addable = effects.filter(
    (manifest) =>
      manifest.inputs === 1 &&
      !clip.effects.some((authored) => authored.effectType === manifest.id),
  );

  return (
    <Group title={t("inspector.effects")}>
      {clip.effects.map((authored) => {
        const manifest = effects.find((candidate) => candidate.id === authored.effectType);
        // An effect type this build cannot draw gets no row: a slider that moves nothing is
        // worse than the honest absence of one.
        if (manifest === undefined) return null;
        return (
          <div key={authored.id} className="v-inspector__effect">
            <h4 className="v-inspector__effectName">{manifest.name[locale]}</h4>
            {manifest.params.map((param) => (
              <EffectParam
                key={param.key}
                clip={clip.id}
                effect={authored}
                param={param}
                value={shownValue(param, resolved.get(authored.id)?.get(param.key)?.value)}
                playhead={playhead}
                inside={inside}
                send={send}
                onSeek={onSeek}
              />
            ))}
          </div>
        );
      })}
      <AddEffect
        offers={addable}
        onAdd={(id) => send(cmd.effectAdd(on.clip(clip.id), id))}
      />
    </Group>
  );
}

// One parameter of one effect. Split out because `Effects` decides *which* rows exist and this
// decides what one row does -- and because five levels of nested arrows in a map is where a
// wrong `clip.id` hides.
function EffectParam({
  clip,
  effect,
  param,
  value,
  playhead,
  inside,
  send,
  onSeek,
}: {
  clip: ClipId;
  effect: Effect;
  param: EffectParamDescriptor;
  value: number;
  playhead: Time;
  inside: boolean;
  send: Send;
  onSeek: (time: Time) => void;
}): ReactElement {
  const { locale } = useI18n();
  const track = effect.keyframes[param.key] ?? [];
  const keyframed = track.length > 0;
  const set = (next: number, interp: Interp = "linear"): Command =>
    cmd.keyframeAdd(on.clip(clip), effect.effectType, param.key, playhead, float(next), interp);

  return (
    <ParamRow
      label={param.name[locale]}
      value={value}
      min={param.min}
      max={param.max}
      // A keyframed parameter can only be written at a moment the clip covers, and its static
      // value is ignored once a track exists -- so with the playhead elsewhere the slider has
      // nothing it could truthfully do.
      disabled={keyframed && !inside}
      onChange={(next, coalesceKey) =>
        send(
          keyframed
            ? // Not a plain "linear": the upsert must not turn a held keyframe into a ramp.
              set(next, keyframeAt(track, playhead)?.interp ?? "linear")
            : cmd.effectSetParam(on.clip(clip), effect.effectType, param.key, float(next)),
          coalesceKey,
        )
      }
      keyframes={{
        at: playhead,
        track,
        settable: inside,
        onAdd: () => send(set(value)),
        onRemove: () => send(cmd.keyframeRemove(on.clip(clip), effect.effectType, param.key, playhead)),
        onGoTo: onSeek,
        onInterp: (interp) =>
          send(cmd.keyframeSetInterp(on.clip(clip), effect.effectType, param.key, playhead, interp)),
      }}
    />
  );
}

function float(value: number): ParamValue {
  return { kind: "float", value };
}
