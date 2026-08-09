import { useEffect, useRef, useState } from "react";

import { createProjectBackend, templatePreview } from "@videola/core";
import { renderStills } from "@videola/engine";

import type { Template } from "@videola/core";

// The longest edge a card is drawn at. A gallery card is a few centimetres wide; rendering it at
// the project's own 1920x1080 would cost eight times the pixels for a picture nobody sees at that
// size. Every measurement in the text generator is a fraction of the frame, so a title reads the
// same at 384 as at 1920 -- that is what makes shrinking the render honest rather than a different
// picture.
const POSTER_EDGE = 384;

/**
 * One rendered still per template, as object URLs, keyed by template id.
 *
 * Why render at all, rather than paint a card: a painted card is a promise with nothing behind it.
 * It can show a look the renderer would never produce, and nobody would find out until after they
 * had chosen. These go through `Template::preview` -- the same `bake` a real answer goes through --
 * and then through the same compositor the editor draws with. If a card is wrong, the template is
 * wrong.
 *
 * What it costs: one small picture per template, rendered one at a time in gallery order while the
 * dialog is already open and usable. A preview project holds nothing but generators, so there is no
 * decoding, no storage read and no network; `renderStills` builds and disposes its own WebGL
 * context per call, so exactly one is alive at a time. Nine of them is a few hundred milliseconds
 * of GPU work that nothing is waiting on.
 *
 * ponytail: renders every template in the catalogue. A remote catalogue of hundreds would want an
 * IntersectionObserver so only cards on screen are drawn -- the loop below is already one at a
 * time and in order, so that is a filter on `templates`, not a rewrite.
 */
export function useTemplatePosters(
  templates: readonly Template[],
): ReadonlyMap<string, string> {
  const [posters, setPosters] = useState<ReadonlyMap<string, string>>(new Map());
  // Which templates have been through `poster` already, whether or not a picture came out. Without
  // the failures in here, a build with no WebGL would retry every template on every render.
  const seen = useRef(new Set<string>());
  const live = useRef<ReadonlyMap<string, string>>(posters);
  live.current = posters;
  // Keyed on the ids rather than the array: the catalogue is fetched once but React hands this a
  // fresh array on every state change of the dialog around it.
  const ids = templates.map((entry) => entry.manifest.id).join(" ");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const template of templates) {
        if (cancelled) return;
        const id = template.manifest.id;
        if (seen.current.has(id)) continue;
        seen.current.add(id);
        const made = await poster(template);
        if (made === undefined) continue;
        setPosters((current) => new Map(current).set(id, made));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ids` is the identity of `templates`
  }, [ids]);

  // Only when the tab goes away. A template id is stable for the life of the build, so a URL under
  // one never points at a different picture.
  useEffect(() => {
    return () => {
      for (const url of live.current.values()) URL.revokeObjectURL(url);
    };
  }, []);

  return posters;
}

async function poster(template: Template): Promise<string | undefined> {
  try {
    const project = await templatePreview(template);
    const { width, height } = fit(project.settings.width, project.settings.height);
    const backend = await createProjectBackend(project);
    const at = template.manifest.posterAt ?? 0;
    const [picture] = await renderStills({
      project,
      sourceTimes: backend.sourceTimesAt,
      effectParams: backend.effectParamsAt,
      transforms: backend.transformsAt,
      times: [at],
      width,
      height,
    });
    return picture === undefined ? undefined : URL.createObjectURL(picture);
  } catch {
    // No WebGL, or a template this build cannot draw. The card falls back to the outline of the
    // timeline it will build, which is a smaller claim but still a true one.
    return undefined;
  }
}

// The template's own shape, shrunk to fit a square of `POSTER_EDGE`. An upright template gets an
// upright card, which is half of what someone is choosing between.
function fit(width: number, height: number): { width: number; height: number } {
  const scale = POSTER_EDGE / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
