import { useEffect, useRef, type ReactElement } from "react";

import { FLICKS_PER_SECOND, type Template } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { localized, templateBlocks, templateDuration } from "./outline";

import "./TemplateGallery.css";

export interface TemplateGalleryProps {
  templates: readonly Template[];
  error?: string;
  onChoose: (template: Template) => void;
  onOpenTemplate: (file: File) => void;
  onSaveCurrent?: () => void;
  onClose: () => void;
}

export function TemplateGallery(props: TemplateGalleryProps): ReactElement {
  const { t, locale, formatNumber } = useI18n();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  return (
    <div className="v-templates__scrim">
      <div
        ref={panel}
        className="v-templates"
        role="dialog"
        aria-modal="true"
        aria-label={t("template.galleryTitle")}
        tabIndex={-1}
        data-testid="template-gallery"
      >
        <h2 className="v-templates__title">{t("template.galleryTitle")}</h2>
        {props.error !== undefined && (
          <p className="v-templates__note" role="alert">
            {t(props.error)}
          </p>
        )}

        <ul className="v-templates__grid">
          {props.templates.map((template) => (
            <li className="v-template" key={template.manifest.id} data-template-id={template.manifest.id}>
              <Outline template={template} />
              <h3 className="v-template__name">{localized(template.manifest.name, locale)}</h3>
              <p className="v-template__blurb">{localized(template.manifest.description, locale)}</p>
              <p className="v-template__facts">
                <span className="v-template__tag">{template.manifest.category}</span>
                <span>
                  {t("template.seconds", {
                    seconds: formatNumber(
                      Math.round((templateDuration(template) / FLICKS_PER_SECOND) * 10) / 10,
                    ),
                  })}
                </span>
                <span>{t("template.slotCount", { count: template.manifest.slots.length })}</span>
              </p>
              <button className="v-button v-button--primary" onClick={() => props.onChoose(template)}>
                {t("template.use")}
              </button>
            </li>
          ))}
        </ul>

        <div className="v-templates__actions">
          {/* A real file input rather than a scripted picker: the browser already has this dialog,
              it carries the accept filter for free, and it is the one shape a test in a real
              browser can hand a file to. */}
          <label className="v-button">
            {t("template.openFile")}
            <input
              type="file"
              accept=".videolat"
              className="v-templates__file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file !== undefined) props.onOpenTemplate(file);
              }}
            />
          </label>
          {props.onSaveCurrent !== undefined && (
            <button className="v-button" onClick={props.onSaveCurrent}>
              {t("template.saveCurrent")}
            </button>
          )}
          <span className="v-templates__spacer" />
          <button className="v-button" onClick={props.onClose}>
            {t("template.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

// One row per track, bottom track first, so the strip reads the way the timeline does. A dissolve
// is drawn where it happens: the overlap between two blocks is the dissolve.
function Outline({ template }: { template: Template }): ReactElement {
  const tracks = template.project.timeline.tracks.length;
  const blocks = templateBlocks(template);
  return (
    <div className="v-template__outline" aria-hidden="true">
      {Array.from({ length: tracks }, (_, index) => (
        <div className="v-template__lane" key={index}>
          {blocks
            .filter((block) => block.track === tracks - 1 - index)
            .map((block) => (
              <span
                key={block.clip}
                className="v-template__block"
                data-dissolve={block.dissolve ? "" : undefined}
                style={{ left: `${block.left * 100}%`, width: `${block.width * 100}%` }}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
