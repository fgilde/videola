import { useEffect, useState, type ReactElement } from "react";

import { cmd, textGenerator, type Clip, type Command } from "@videola/core";

import { useI18n } from "../i18n/useI18n";

/**
 * The words of a title or a subtitle, and the only place they can be changed at all.
 *
 * A `textarea` rather than an `<input type="text">`, because the generator honours a hard line
 * break and a text input silently drops one -- a two-line subtitle typed into an input comes back
 * as one line the moment the field is redrawn, which is exactly how it was lost once already.
 *
 * The field holds its own draft and sends on blur or on the button rather than on every keystroke.
 * A dispatch per character would be a patch per character through the whole core; the coalesce key
 * would collapse the undo entries but not the work. Editing words is not a drag.
 */
export function TextPanel({
  clip,
  send,
}: {
  clip: Clip;
  send: (command: Command, coalesceKey?: string) => void;
}): ReactElement | null {
  const { t } = useI18n();
  const generator = textGenerator(clip);
  const content = generator?.content ?? "";
  const [draft, setDraft] = useState(content);

  // A different clip, or the same clip changed by an undo, has to reach the field. Keyed on the
  // words themselves rather than on the clip id: an undo of a retype leaves the id alone and is
  // precisely the case a `clip.id` dependency would miss.
  useEffect(() => setDraft(content), [content, clip.id]);

  if (generator === undefined) return null;

  const commit = (): void => {
    if (draft === content) return;
    send(cmd.clipSetGenerator(clip.id, { ...generator, content: draft }));
  };

  return (
    <section className="v-inspector__group">
      <h3 className="v-inspector__title">{t("text.label")}</h3>
      <div className="v-text">
        <label className="v-param__label" htmlFor={`text-${clip.id}`}>
          {t("text.content")}
        </label>
        <textarea
          id={`text-${clip.id}`}
          className="v-text__area"
          data-testid="text-content"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
        />
        <p className="v-inspector__note">{t("text.contentHint")}</p>
        <button type="button" className="v-button" disabled={draft === content} onClick={commit}>
          {t("text.apply")}
        </button>
      </div>
    </section>
  );
}
