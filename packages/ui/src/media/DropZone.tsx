import { useRef, useState, type DragEvent, type ReactElement, type ReactNode } from "react";

import { useI18n } from "../i18n/useI18n";
import "./DropZone.css";

export interface DropZoneProps {
  onFiles: (files: File[]) => void;
  children: ReactNode;
}

export function DropZone({ onFiles, children }: DropZoneProps): ReactElement {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  // dragleave fires whenever the pointer crosses into a child element, so the events have to be
  // counted rather than treated as a pair. Counting is also what survives a drag that leaves the
  // window over a child and comes back.
  const depth = useRef(0);

  const end = (): void => {
    depth.current = 0;
    setOver(false);
  };

  return (
    <div
      className="v-dropzone"
      onDragEnter={(event: DragEvent) => {
        if (!carriesFiles(event)) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event: DragEvent) => {
        if (!carriesFiles(event)) return;
        // Without this the browser navigates to the file instead of handing it over, and the
        // whole editor is replaced by a video player.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) end();
      }}
      onDrop={(event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        end();
        const files = [...event.dataTransfer.files];
        if (files.length > 0) onFiles(files);
      }}
    >
      {children}
      {over && <div className="v-dropzone__overlay">{t("media.dropHint")}</div>}
    </div>
  );
}

// A drag of selected text or of a clip inside the timeline carries no files and must pass
// through untouched, or every gesture in the editor lights up the drop overlay.
function carriesFiles(event: DragEvent): boolean {
  return [...event.dataTransfer.types].includes("Files");
}

// The button half of the same job. Kept next to the drop zone because the two are one feature:
// a file picker is what the drop zone is for anyone who cannot drag.
export function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}
