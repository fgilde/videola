import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import {
  FLICKS_PER_SECOND,
  type Frame,
  type MediaAsset,
  type Slot,
  type SlotAnswer,
  type Template,
} from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { Poster } from "./TemplateGallery";
import { localized, slotNeeds } from "./outline";

import "./TemplateGallery.css";

export interface TemplateWizardProps {
  template: Template;
  /// The material already chosen, by slot id. Importing is the application's job -- it hashes the
  /// file, puts it in storage and probes it, exactly as for a drag onto the editor -- so the wizard
  /// only ever hands a `File` up and reads the finished asset back down.
  media: Readonly<Record<string, MediaAsset>>;
  /// A picture of each imported medium, by media id. The application already decodes these for the
  /// library; showing the same one here is what turns "shot.mp4" into something a person recognises
  /// as the right file.
  thumbnails?: ReadonlyMap<string, string>;
  /// The template's own rendered still, the same one its gallery card carries.
  poster?: string;
  error?: string;
  busy?: boolean;
  onPickMedia: (slotId: string, file: File) => void;
  onFinish: (answers: Readonly<Record<string, SlotAnswer>>, frame: Frame) => void;
  onBack: () => void;
  onClose: () => void;
}

export function TemplateWizard(props: TemplateWizardProps): ReactElement {
  const { t, locale, formatNumber } = useI18n();
  const { template } = props;
  const steps = template.manifest.steps;
  const [step, setStep] = useState(0);
  const [text, setText] = useState<Record<string, string>>({});
  const [color, setColor] = useState<Record<string, string>>({});
  const [frameIndex, setFrameIndex] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  // Moving on replaces every field on the screen. Without this the caret stays on a button that now
  // belongs to a different question, and a screen reader is never told the panel changed.
  useEffect(() => {
    if (step > 0) heading.current?.focus();
  }, [step]);

  const slots = useMemo(
    () => new Map(template.manifest.slots.map((slot) => [slot.id, slot])),
    [template],
  );
  const current = (steps[step]?.slots ?? [])
    .map((id) => slots.get(id))
    .filter((slot): slot is Slot => slot !== undefined);

  const frames = template.manifest.aspectRatios;
  const frame = frames[frameIndex] ?? {
    width: template.project.settings.width,
    height: template.project.settings.height,
  };
  // A text slot falls back to whatever the template shipped with, which for a slot bound to a text
  // generator is the line its designer chose -- so leaving a field alone gives the design, not a
  // hole. Only a slot with nothing behind it falls back to the template's name.
  const defaultText = (slot: Slot): string =>
    shippedText(template, slot) ?? localized(template.manifest.name, locale);
  const defaultColor = template.project.settings.background;

  const valueOf = (slot: Slot): string =>
    slot.kind === "text"
      ? (text[slot.id] ?? defaultText(slot))
      : (color[slot.id] ?? defaultColor);

  const answered = (slot: Slot): boolean => {
    if (slot.kind === "media") return props.media[slot.id] !== undefined;
    if (slot.kind === "text") return valueOf(slot).trim() !== "";
    return true;
  };
  const complete = current.every((slot) => !slot.required || answered(slot));
  const last = step === steps.length - 1;

  const finish = (): void => {
    const answers: Record<string, SlotAnswer> = {};
    for (const slot of template.manifest.slots) {
      if (slot.kind === "media") {
        const asset = props.media[slot.id];
        if (asset !== undefined) answers[slot.id] = { kind: "media", asset };
      } else if (slot.kind === "text") {
        const value = valueOf(slot).trim();
        // An empty answer is left out rather than written: it would replace whatever the template
        // had with nothing, which is not the same as leaving the slot alone.
        if (value !== "") answers[slot.id] = { kind: "text", text: value };
      } else {
        answers[slot.id] = { kind: "color", color: valueOf(slot) };
      }
    }
    props.onFinish(answers, frame);
  };

  return (
    <div className="v-templates__scrim">
      <div
        ref={panel}
        className="v-templates v-templates--wizard"
        role="dialog"
        aria-modal="true"
        aria-label={localized(template.manifest.name, locale)}
        tabIndex={-1}
        data-testid="template-wizard"
      >
        <h2 className="v-templates__title">{localized(template.manifest.name, locale)}</h2>

        {/* The picture stays on the screen for the whole flow. Someone filling in six fields has
            otherwise no reminder of what they are filling them in for. */}
        <div className="v-templates__poster">
          <Poster template={template} url={props.poster} />
        </div>

        {/* Every step at once rather than "3 of 5": how much is left is the question the number is
            standing in for, and the rail answers it without arithmetic. */}
        <ol className="v-templates__rail" data-testid="template-rail">
          {steps.map((entry, index) => (
            <li
              key={entry.title.en}
              className="v-templates__railstep"
              data-state={index === step ? "here" : index < step ? "done" : "ahead"}
            >
              {localized(entry.title, locale)}
            </li>
          ))}
        </ol>
        <p className="v-templates__step" role="status" tabIndex={-1} ref={heading}>
          {t("template.stepOf", { step: step + 1, total: steps.length })} ·{" "}
          {localized(steps[step]?.title ?? template.manifest.name, locale)}
        </p>
        {props.error !== undefined && (
          <p className="v-templates__note" role="alert">
            {t(props.error)}
          </p>
        )}

        <label className="v-templates__row">
          {t("template.format")}
          <select value={frameIndex} onChange={(event) => setFrameIndex(Number(event.target.value))}>
            {frames.map((entry, index) => (
              <option key={`${entry.width}x${entry.height}`} value={index}>
                {`${entry.width} × ${entry.height}`}
              </option>
            ))}
          </select>
        </label>

        {current.map((slot) => (
          <fieldset className="v-templates__slot" key={slot.id} data-slot-id={slot.id}>
            <legend>
              {localized(slot.label, locale)}
              {!slot.required && <span className="v-templates__tag">{t("template.optional")}</span>}
            </legend>
            <p className="v-templates__hint">{localized(slot.hint, locale)}</p>
            {slot.kind === "media" && (
              <>
                <p className="v-templates__hint">
                  {t("template.needs", {
                    seconds: formatNumber(
                      Math.round((slotNeeds(template, slot) / FLICKS_PER_SECOND) * 10) / 10,
                    ),
                  })}
                </p>
                <div className="v-templates__pick">
                  <label className="v-button">
                    {props.media[slot.id] === undefined
                      ? t("template.pickMedia")
                      : t("template.replaceMedia")}
                    <input
                      type="file"
                      accept="video/*,image/*"
                      className="v-templates__file"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file !== undefined) props.onPickMedia(slot.id, file);
                      }}
                    />
                  </label>
                  {props.media[slot.id] !== undefined && (
                    <span className="v-templates__chosen" data-chosen={slot.id}>
                      <Chosen
                        asset={props.media[slot.id]}
                        thumbnails={props.thumbnails}
                        seconds={(value: number) => formatNumber(Math.round(value * 10) / 10)}
                      />
                    </span>
                  )}
                </div>
              </>
            )}
            {slot.kind === "text" && (
              <input
                type="text"
                value={valueOf(slot)}
                onChange={(event) => setText({ ...text, [slot.id]: event.target.value })}
              />
            )}
            {slot.kind === "color" && (
              <input
                type="color"
                value={valueOf(slot)}
                onChange={(event) => setColor({ ...color, [slot.id]: event.target.value })}
              />
            )}
          </fieldset>
        ))}

        {/* The last panel says what is about to be made, every answer in one place. A wizard that
            asks six questions across three panels and then acts on all of them is otherwise asking
            for a decision nobody has been shown. */}
        {last && (
          <div className="v-templates__summary" data-testid="template-summary">
            <h3 className="v-templates__subtitle">{t("template.summary")}</h3>
            <dl className="v-templates__answers">
              <div>
                <dt>{t("template.format")}</dt>
                <dd>{`${frame.width} × ${frame.height}`}</dd>
              </div>
              {template.manifest.slots.map((slot) => (
                <div key={slot.id} data-answer={slot.id}>
                  <dt>{localized(slot.label, locale)}</dt>
                  <dd>
                    {slot.kind === "media"
                      ? (props.media[slot.id]?.originalName ?? t("template.notChosen"))
                      : valueOf(slot)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div className="v-templates__actions">
          <button
            className="v-button"
            onClick={() => (step === 0 ? props.onBack() : setStep(step - 1))}
          >
            {t("template.back")}
          </button>
          <span className="v-templates__spacer" />
          <button className="v-button" onClick={props.onClose}>
            {t("template.cancel")}
          </button>
          <button
            className="v-button v-button--primary"
            disabled={!complete || props.busy === true}
            onClick={() => (last ? finish() : setStep(step + 1))}
          >
            {last ? t("template.finish") : t("template.next")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chosen({
  asset,
  thumbnails,
  seconds,
}: {
  asset?: MediaAsset;
  thumbnails?: ReadonlyMap<string, string>;
  seconds: (value: number) => string;
}): ReactElement | null {
  if (asset === undefined) return null;
  const picture = thumbnails?.get(asset.id);
  return (
    <>
      {picture !== undefined && (
        <img className="v-templates__thumb" src={picture} alt="" width={64} height={36} />
      )}
      <span>
        {asset.originalName}
        {asset.duration != null && ` · ${seconds(asset.duration / FLICKS_PER_SECOND)} s`}
      </span>
    </>
  );
}

// The words a text slot's own generator already carries. A slot writing into two places takes the
// first generator it finds; a slot bound only to the project's name has none, and says so by
// returning undefined.
function shippedText(template: Template, slot: Slot): string | undefined {
  for (const binding of slot.bindings) {
    if (binding.target !== "generatorText") continue;
    for (const track of template.project.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.id !== binding.clip) continue;
        if (clip.source.kind === "generator" && clip.source.generator.type === "text") {
          return clip.source.generator.content;
        }
      }
    }
  }
  return undefined;
}
