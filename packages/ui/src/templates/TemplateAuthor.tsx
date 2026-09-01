import { useMemo, useRef, useState, type ReactElement } from "react";

import { textGenerator, type ClipId, type Project } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import "./TemplateGallery.css";

export interface TemplateAuthorProps {
  project: Project;
  /** The clips that are questions, and the name the template goes out under. */
  onSave: (marked: readonly ClipId[], name: string) => void;
  onClose: () => void;
}

interface Element {
  clip: ClipId;
  kind: "media" | "text" | "colour";
  /** What it is on the timeline: a file name, the words it says, the colour it paints. */
  label: string;
}

/**
 * Turning this project into a template: which parts are the question, and which travel with it.
 *
 * The one decision this dialogue exists to take, and the reason "save as template" was not enough on
 * its own: a template is half recipe and half ingredients. The intro, the logo, the watermark and the
 * end card are the recipe — they are the same every time it is cooked, and a template that asked for
 * its own intro on every use would not be a template. The shot in the middle is the ingredient, and
 * the person using it brings their own.
 *
 * Checked means "the person using this brings it". Unchecked means "it is part of the template", and
 * for a medium that includes its bytes: the file travels inside the `.videolat`.
 *
 * Media start checked and titles do too, because that is what somebody making a template out of a
 * finished edit almost always means; colour fields start unchecked, because a colour that becomes a
 * question is a question about a design nobody asked to change.
 */
export function TemplateAuthor({ project, onSave, onClose }: TemplateAuthorProps): ReactElement {
  const { t, locale } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const elements = useMemo(() => elementsOf(project, locale), [project, locale]);
  const [asked, setAsked] = useState<ReadonlySet<string>>(
    () => new Set(elements.filter((entry) => entry.kind !== "colour").map((entry) => entry.clip)),
  );
  const [name, setName] = useState(project.meta.title);

  const toggle = (clip: string): void =>
    setAsked((held) => {
      const next = new Set(held);
      if (next.has(clip)) next.delete(clip);
      else next.add(clip);
      return next;
    });

  return (
    <div className="v-templates__scrim">
      <div
        ref={panel}
        className="v-templates v-templates--author"
        role="dialog"
        aria-modal="true"
        aria-label={t("author.title")}
        tabIndex={-1}
        data-testid="template-author"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <h2 className="v-templates__title">{t("author.title")}</h2>
        <p className="v-templates__blurb">{t("author.intro")}</p>

        <label className="v-author__name">
          <span className="v-param__label">{t("author.name")}</span>
          <input
            type="text"
            value={name}
            data-testid="author-name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        {elements.length === 0 ? (
          <p className="v-templates__blurb">{t("author.nothing")}</p>
        ) : (
          <ul className="v-author__list">
            {elements.map((element) => (
              <li key={element.clip}>
                <label className="v-author__row" data-kind={element.kind}>
                  <input
                    type="checkbox"
                    checked={asked.has(element.clip)}
                    data-clip={element.clip}
                    onChange={() => toggle(element.clip)}
                  />
                  <span className="v-author__kind">{t(`author.kind.${element.kind}`)}</span>
                  <span className="v-author__label">{element.label}</span>
                  <span className="v-author__state">
                    {asked.has(element.clip) ? t("author.asked") : t("author.kept")}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <p className="v-templates__blurb">{t("author.hint")}</p>

        <div className="v-templates__actions">
          <button className="v-button" onClick={onClose}>
            {t("template.cancel")}
          </button>
          <span className="v-templates__spacer" />
          <button
            className="v-button v-button--primary"
            data-testid="author-save"
            onClick={() => onSave([...asked], name.trim())}
          >
            {t("author.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Everything in this project that could be a question, in the order the timeline stacks it.
 *
 * A clip that is neither a medium nor a generator -- a compound, a nested timeline -- is left out:
 * there is no slot kind that could stand in for one, so offering it would be offering a switch that
 * does nothing.
 */
export function elementsOf(project: Project, locale: "de" | "en"): Element[] {
  const names = new Map(project.library.map((asset) => [asset.id, asset.originalName]));
  const found: Element[] = [];
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.source.kind === "media") {
        found.push({
          clip: clip.id,
          kind: "media",
          label: names.get(clip.source.media) ?? clip.label ?? clip.id,
        });
        continue;
      }
      if (clip.source.kind !== "generator") continue;
      const words = textGenerator(clip);
      if (words !== undefined) {
        found.push({ clip: clip.id, kind: "text", label: firstLine(words.content) });
        continue;
      }
      const generator = clip.source.generator;
      if (generator.type === "solid" || generator.type === "gradient") {
        found.push({
          clip: clip.id,
          kind: "colour",
          label: generator.type === "solid" ? generator.color : `${generator.from} → ${generator.to}`,
        });
      }
    }
  }
  // Nothing locale-dependent today; the parameter is here because a label that names a kind will be,
  // and a caller that already passes it does not have to change then.
  void locale;
  return found;
}

function firstLine(content: string): string {
  const line = content.split("\n")[0] ?? "";
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}
