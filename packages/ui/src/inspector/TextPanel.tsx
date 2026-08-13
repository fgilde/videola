import { useEffect, useState, type ReactElement } from "react";

import { cmd, textGenerator, type Clip, type Command, type JsonValue } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { ParamRow } from "./ParamRow";

/** What the renderer implements. A move outside this list falls back and the title stands still. */
const MOVES = ["none", "fade", "rise", "fall", "grow"] as const;
const ALIGNMENTS = ["left", "center", "right"] as const;
/** Three weights rather than a slider from 100 to 900: a font has the weights it has. */
const WEIGHTS = [400, 700, 800] as const;

type Style = Readonly<Record<string, JsonValue>>;

// The renderer's own defaults, repeated here for the one reason worth repeating a value: this panel
// has to show what the picture shows before anything has been set, and a control with no value is a
// control that reports "nothing" for a title that plainly has a size.
const FALLBACK = {
  fontSize: 0.09,
  fontWeight: 700,
  color: "#ffffff",
  align: "center",
  x: 0.5,
  y: 0.5,
  maxWidth: 0.8,
  animateIn: "none",
  animateInSeconds: 0.5,
  animateOut: "none",
  animateOutSeconds: 0.5,
  loop: "none",
  loopSeconds: 2,
} as const;

/**
 * A title: its words, its look, and how it arrives and leaves.
 *
 * The movement half is why this panel exists in this shape. Until it did, a template could ship a
 * rising title and nobody could make one, change one, or take one away — the presets were in the
 * renderer and in the shipped templates and nowhere a person could reach. Five moves in, five out, a
 * pulse, and the seconds each takes.
 *
 * Everything here writes the generator's `style` map through one command, so an undo takes back the
 * whole change rather than half a style. The words keep their own draft and commit on blur, because
 * a dispatch per keystroke is a patch per keystroke through the core; a slider coalesces on its own
 * key, so a drag is one undo step and not forty.
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

  const style: Style = generator.style ?? {};
  const numberOf = (key: keyof typeof FALLBACK): number => {
    const held = style[key];
    return typeof held === "number" ? held : (FALLBACK[key] as number);
  };
  const textOf = (key: keyof typeof FALLBACK): string => {
    const held = style[key];
    return typeof held === "string" ? held : (FALLBACK[key] as string);
  };
  const set = (patch: Style, coalesceKey?: string): void => {
    send(
      cmd.clipSetGenerator(clip.id, { ...generator, style: { ...style, ...patch } }),
      coalesceKey,
    );
  };
  const commit = (): void => {
    if (draft === content) return;
    send(cmd.clipSetGenerator(clip.id, { ...generator, content: draft }));
  };
  // One key per field per clip, so dragging the size and then the height are two undo steps and
  // dragging the size is one.
  const key = (field: string): string => `text-${field}-${clip.id}`;

  return (
    <section className="v-inspector__group" data-testid="text-panel">
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

        <div className="v-text__row">
          <label className="v-param__label" htmlFor={`text-color-${clip.id}`}>
            {t("text.color")}
          </label>
          <input
            id={`text-color-${clip.id}`}
            type="color"
            data-testid="text-color"
            value={hex(textOf("color"))}
            onChange={(event) => set({ color: event.target.value }, key("color"))}
          />
          <select
            aria-label={t("text.weight")}
            data-testid="text-weight"
            value={String(numberOf("fontWeight"))}
            onChange={(event) => set({ fontWeight: Number(event.target.value) })}
          >
            {WEIGHTS.map((weight) => (
              <option key={weight} value={weight}>
                {t(`text.weight.${weight}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("text.align")}
            data-testid="text-align"
            value={textOf("align")}
            onChange={(event) => set({ align: event.target.value })}
          >
            {ALIGNMENTS.map((align) => (
              <option key={align} value={align}>
                {t(`text.align.${align}`)}
              </option>
            ))}
          </select>
        </div>

        <ParamRow
          label={t("text.size")}
          value={numberOf("fontSize")}
          min={0.01}
          max={0.4}
          onChange={(value) => set({ fontSize: value }, key("size"))}
        />
        <ParamRow
          label={t("text.width")}
          value={numberOf("maxWidth")}
          min={0.1}
          max={1}
          onChange={(value) => set({ maxWidth: value }, key("width"))}
        />
        {/* Down the picture, like every other y in this program: 0 is the top edge. */}
        <ParamRow
          label={t("text.y")}
          value={numberOf("y")}
          min={0}
          max={1}
          onChange={(value) => set({ y: value }, key("y"))}
        />
      </div>

      <h3 className="v-inspector__title">{t("text.motion")}</h3>
      <div className="v-text">
        {/* The seconds are hidden while the move is "none", rather than disabled: a duration for an
            animation that does not happen is a question about nothing. */}
        <Move
          id={`in-${clip.id}`}
          label={t("text.animateIn")}
          testId="text-animate-in"
          value={textOf("animateIn")}
          seconds={numberOf("animateInSeconds")}
          onMove={(move) => set({ animateIn: move })}
          onSeconds={(seconds) => set({ animateInSeconds: seconds }, key("inSeconds"))}
          secondsLabel={t("text.seconds")}
          options={MOVES.map((move) => ({ value: move, label: t(`text.move.${move}`) }))}
        />
        <Move
          id={`out-${clip.id}`}
          label={t("text.animateOut")}
          testId="text-animate-out"
          value={textOf("animateOut")}
          seconds={numberOf("animateOutSeconds")}
          onMove={(move) => set({ animateOut: move })}
          onSeconds={(seconds) => set({ animateOutSeconds: seconds }, key("outSeconds"))}
          secondsLabel={t("text.seconds")}
          options={MOVES.map((move) => ({ value: move, label: t(`text.move.${move}`) }))}
        />
        <Move
          id={`loop-${clip.id}`}
          label={t("text.loop")}
          testId="text-loop"
          value={textOf("loop")}
          seconds={numberOf("loopSeconds")}
          onMove={(move) => set({ loop: move })}
          onSeconds={(seconds) => set({ loopSeconds: seconds }, key("loopSeconds"))}
          secondsLabel={t("text.loopSeconds")}
          options={[
            { value: "none", label: t("text.move.none") },
            { value: "pulse", label: t("text.loop.pulse") },
          ]}
        />
        <p className="v-inspector__note">{t("text.motionHint")}</p>
      </div>
    </section>
  );
}

function Move({
  id,
  label,
  testId,
  value,
  seconds,
  options,
  secondsLabel,
  onMove,
  onSeconds,
}: {
  id: string;
  label: string;
  testId: string;
  value: string;
  seconds: number;
  options: readonly { value: string; label: string }[];
  secondsLabel: string;
  onMove: (move: string) => void;
  onSeconds: (seconds: number, coalesceKey?: string) => void;
}): ReactElement {
  return (
    <>
      <div className="v-text__row">
        <label className="v-param__label" htmlFor={`text-move-${id}`}>
          {label}
        </label>
        <select
          id={`text-move-${id}`}
          data-testid={testId}
          value={value}
          onChange={(event) => onMove(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {value !== "none" && (
        <ParamRow label={secondsLabel} value={seconds} min={0.1} max={5} onChange={onSeconds} />
      )}
    </>
  );
}

// `<input type="color">` refuses anything but `#rrggbb`, and a style can hold `#rgb` or an alpha.
// Shown as the nearest six-digit colour rather than as black, which is what an empty value gives.
function hex(value: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short !== null) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/i.test(value) ? value : `#${value.replace(/^#/, "").slice(0, 6) || "ffffff"}`;
}
