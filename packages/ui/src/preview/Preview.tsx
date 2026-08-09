import { useLayoutEffect, useRef, type CSSProperties, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import "./Preview.css";

export interface PreviewProps {
  width: number;
  height: number;
  /**
   * How much of the screen's own resolution the drawing buffer is given: 1 is every pixel, 0.5 is
   * half in each direction and so a quarter of the work. The element keeps its size and CSS
   * stretches the smaller buffer back over it, so the picture only gets softer -- the cheapest
   * thing there is to trade for a preview that keeps up on a big project. The export never sees
   * it: it renders into a context of its own at the size it was asked for.
   */
  resolution?: number;
  /** The element, once it exists, and `null` when it goes away. Called once per element. */
  onCanvas: (canvas: HTMLCanvasElement | null) => void;
  /** The drawing buffer was resized, which empties it. Whoever draws has to draw again. */
  onResize?: () => void;
}

export function Preview({
  width,
  height,
  resolution = 1,
  onCanvas,
  onResize,
}: PreviewProps): ReactElement {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The callbacks are read through refs so a parent that passes an inline arrow does not tear
  // down the GL context on every render. The context belongs to the element, not to the props.
  const attach = useRef(onCanvas);
  attach.current = onCanvas;
  const redraw = useRef(onResize);
  redraw.current = onResize;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    attach.current(canvas);
    return () => attach.current(null);
  }, []);

  // ponytail: window resize only, the same limit the timeline's viewport has. A splitter that
  // resizes the preview pane without resizing the window would need a ResizeObserver.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const fit = (): void => {
      // The buffer is sized in device pixels and the element in CSS pixels, so a HiDPI screen
      // gets the resolution it has. The compositor reads the buffer size per call, so nothing
      // needs telling -- but assigning it clears the buffer, and that does.
      const ratio = (window.devicePixelRatio || 1) * resolution;
      const buffer = {
        width: Math.max(1, Math.round(canvas.clientWidth * ratio)),
        height: Math.max(1, Math.round(canvas.clientHeight * ratio)),
      };
      if (canvas.width === buffer.width && canvas.height === buffer.height) return;
      canvas.width = buffer.width;
      canvas.height = buffer.height;
      redraw.current?.();
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [width, height, resolution]);

  return (
    <div className="v-preview" data-testid="preview">
      <canvas
        ref={canvasRef}
        className="v-preview__canvas"
        role="img"
        aria-label={t("preview.label")}
        style={
          {
            aspectRatio: `${width} / ${height}`,
            "--v-preview-aspect": `${width / height}`,
          } as CSSProperties
        }
      />
    </div>
  );
}
