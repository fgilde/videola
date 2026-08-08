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
import { localized, slotNeeds } from "./outline";

import "./TemplateGallery.css";

export interface TemplateWizardProps {
  template: Template;
  /// The material already chosen, by slot id. Importing is the application's job -- it hashes the
  /// file, puts it in storage and probes it, exactly as for a drag onto the editor -- so the wizard
  /// only ever hands a `File` up and reads the finished asset back down.
  media: Readonly<Record<string, MediaAsset>>;
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

  useEffect(() => {
    panel.current?.focus();
  }, []);

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
  const defaultText = localized(template.manifest.name, locale);
  const defaultColor = template.project.settings.background;

  const answered = (slot: Slot): boolean => {
    if (slot.kind === "media") return props.media[slot.id] !== undefined;
    if (slot.kind === "text") return (text[slot.id] ?? defaultText).trim() !== "";
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
        const value = (text[slot.id] ?? defaultText).trim();
        // An empty answer is left out rather than written: it would replace whatever the template
        // had with nothing, which is not the same as leaving the slot alone.
        if (value !== "") answers[slot.id] = { kind: "text", text: value };
      } else {
        answers[slot.id] = { kind: "color", color: color[slot.id] ?? defaultColor };
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
        <p className="v-templates__step" role="status">
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
          <select
            value={frameIndex}
            onChange={(event) => setFrameIndex(Number(event.target.value))}
          >
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
                  <p className="v-templates__chosen" data-chosen={slot.id}>
                    {props.media[slot.id]?.originalName}
                  </p>
                )}
              </>
            )}
            {slot.kind === "text" && (
              <input
                type="text"
                value={text[slot.id] ?? defaultText}
                onChange={(event) => setText({ ...text, [slot.id]: event.target.value })}
              />
            )}
            {slot.kind === "color" && (
              <input
                type="color"
                value={color[slot.id] ?? defaultColor}
                onChange={(event) => setColor({ ...color, [slot.id]: event.target.value })}
              />
            )}
          </fieldset>
        ))}

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
