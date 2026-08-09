import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { FLICKS_PER_SECOND, type Template } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import {
  categoriesOf,
  localized,
  templateBlocks,
  templateDuration,
  templateFrame,
} from "./outline";

import "./TemplateGallery.css";

const ALL = "all";

export interface TemplateGalleryProps {
  templates: readonly Template[];
  /// One rendered still per template, by template id. Absent for a template whose picture is not
  /// ready yet, or for a build with no WebGL -- the card falls back to the outline of the timeline
  /// it will build, which is a smaller claim but still a true one.
  posters?: Readonly<Record<string, string>>;
  error?: string;
  onChoose: (template: Template) => void;
  onOpenTemplate: (file: File) => void;
  onSaveCurrent?: () => void;
  onClose: () => void;
}

export function TemplateGallery(props: TemplateGalleryProps): ReactElement {
  const { t, locale, formatNumber } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState(ALL);

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

  const categories = useMemo(() => categoriesOf(props.templates), [props.templates]);
  const shown = props.templates.filter(
    (template) => category === ALL || template.manifest.category === category,
  );

  // A category the catalogue carries but this build has no word for still needs a chip, so the
  // template under it can be found. The raw key is a worse label than a translation and a far
  // better one than nothing.
  const categoryLabel = (key: string): string => {
    const translated = t(`template.category.${key}`);
    return translated === `template.category.${key}` ? key : translated;
  };

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
        <p className="v-templates__lede">{t("template.galleryLede")}</p>
        {props.error !== undefined && (
          <p className="v-templates__note" role="alert">
            {t(props.error)}
          </p>
        )}

        <div className="v-templates__filters" role="group" aria-label={t("template.filterLabel")}>
          {[ALL, ...categories].map((key) => (
            <button
              key={key}
              type="button"
              className="v-chip"
              aria-pressed={category === key}
              data-category={key}
              onClick={() => setCategory(key)}
            >
              {key === ALL ? t("template.category.all") : categoryLabel(key)}
            </button>
          ))}
        </div>

        <ul className="v-templates__grid">
          {shown.map((template) => (
            <li key={template.manifest.id}>
              {/* The card is the control. A picture with a button under it makes the largest,
                  most obvious thing on the screen the one part that does nothing, and on a phone
                  it hands a 44 px target to something the thumb is already over. */}
              <button
                type="button"
                className="v-template"
                data-template-id={template.manifest.id}
                onClick={() => props.onChoose(template)}
              >
                <Poster template={template} url={props.posters?.[template.manifest.id]} />
                <span className="v-template__name">
                  {localized(template.manifest.name, locale)}
                </span>
                <span className="v-template__blurb">
                  {localized(template.manifest.description, locale)}
                </span>
                <span className="v-template__facts">
                  <span className="v-template__tag">
                    {categoryLabel(template.manifest.category)}
                  </span>
                  <span>
                    {t("template.seconds", {
                      seconds: formatNumber(
                        Math.round((templateDuration(template) / FLICKS_PER_SECOND) * 10) / 10,
                      ),
                    })}
                  </span>
                  <span>{t("template.slotCount", { count: template.manifest.slots.length })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {shown.length === 0 && (
          <p className="v-templates__note" data-testid="template-none">
            {t("template.noneHere")}
          </p>
        )}

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

/**
 * The rendered still, or the outline of the timeline while it is not there yet.
 *
 * The box keeps the template's own aspect ratio either way, so a card does not change size when
 * its picture arrives -- a grid that reflows under the pointer is how a click lands on the wrong
 * template.
 */
export function Poster({ template, url }: { template: Template; url?: string }): ReactElement {
  const frame = templateFrame(template);
  return (
    <span
      className="v-template__poster"
      data-poster={url === undefined ? undefined : ""}
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
    >
      {url === undefined ? (
        <Outline template={template} />
      ) : (
        // Empty alt: the name and the description are right beside it, and a screen reader reading
        // a description of the picture as well would say the same thing twice.
        <img className="v-template__still" src={url} alt="" />
      )}
    </span>
  );
}

// One row per track, bottom track first, so the strip reads the way the timeline does. A transition
// is drawn where it happens: the overlap between two blocks is the transition.
function Outline({ template }: { template: Template }): ReactElement {
  const tracks = template.project.timeline.tracks.length;
  const blocks = templateBlocks(template);
  return (
    <span className="v-template__outline" aria-hidden="true">
      {Array.from({ length: tracks }, (_, index) => (
        <span className="v-template__lane" key={index}>
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
        </span>
      ))}
    </span>
  );
}
