import { useRef, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { useDismiss } from "../useDismiss";
import type { ClipMenu } from "./useTimelineGestures";

export interface ContextMenuProps {
  menu: ClipMenu;
  canSplit: boolean;
  onSplit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function ContextMenu({ menu, canSplit, onSplit, onDelete, onClose }: ContextMenuProps): ReactElement {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);

  return (
    <div
      ref={ref}
      className="v-timeline__menu"
      role="menu"
      aria-label={t("timeline.clipMenu")}
      style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
    >
      <button type="button" role="menuitem" disabled={!canSplit} onClick={onSplit}>
        {t("timeline.split")}
      </button>
      <button type="button" role="menuitem" onClick={onDelete}>
        {t("timeline.deleteClip")}
      </button>
    </div>
  );
}
