import { useEffect, useState } from "react";

import {
  detectLayoutMode,
  readViewport,
  type LayoutMode,
  type LayoutPreference,
} from "./detectLayoutMode";

export function useLayoutMode(preference: LayoutPreference): LayoutMode {
  const [detected, setDetected] = useState<LayoutMode>(() => detectLayoutMode(readViewport()));

  useEffect(() => {
    const update = () => setDetected(detectLayoutMode(readViewport()));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return preference === "auto" ? detected : preference;
}
