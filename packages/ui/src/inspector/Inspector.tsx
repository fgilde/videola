import { useMemo, type ReactElement } from "react";

import {
  cmd,
  on,
  secondsToTime,
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
  type Transition,
} from "@videola/core";

import { useI18n, type Locale } from "../i18n/useI18n";
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
          <Transform_ clip={found.clip} project={project} send={dispatch} />
          <Playback clip={found.clip} send={dispatch} />
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
  send,
}: {
  clip: Clip;
  project: Project;
  send: Send;
}): ReactElement {
  const { t } = useI18n();
  const source = sourceSize(clip, project.library);
  const set = (patch: Partial<Transform>, coalesceKey?: string): void =>
    send(cmd.clipSetTransform(clip.id, { ...clip.transform, ...patch }), coalesceKey);

  return (
    <Group title={t("inspector.transform")}>
      {transformFields(project.settings).map((field) => (
        <ParamRow
          key={field.key}
          label={t(`inspector.${field.key}`)}
          value={clip.transform[field.key]}
          min={field.min}
          max={field.max}
          onChange={(value, coalesceKey) => set({ [field.key]: value }, coalesceKey)}
        />
      ))}
      <button
        type="button"
        className="v-button"
        disabled={source === undefined}
        onClick={() => source !== undefined && set(fitted(source, project.settings))}
      >
        {t("inspector.fit")}
      </button>
    </Group>
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
                value={shown(param, resolved.get(authored.id)?.get(param.key)?.value)}
                playhead={playhead}
                inside={inside}
                send={send}
                onSeek={onSeek}
              />
            ))}
          </div>
        );
      })}
      {addable.map((manifest) => (
        <button
          key={manifest.id}
          type="button"
          className="v-button"
          onClick={() => send(cmd.effectAdd(on.clip(clip.id), manifest.id))}
        >
          {t("inspector.addEffect", { name: manifest.name[locale] })}
        </button>
      ))}
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

const shown = shownValue;
