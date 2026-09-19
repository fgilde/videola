import { useEffect, useRef, useState, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { Icon } from "../primitives/Icon";
import "./Mcp.css";

export interface McpProps {
  onClose: () => void;
}

const DOCS = "https://videola.app/guide/api-and-mcp";

const CONFIG = `{
  "mcpServers": {
    "videola": {
      "command": "node",
      "args": ["/path/to/videola/apps/server/dist/mcp.mjs"],
      "env": { "VIDEOLA_STORAGE_ROOT": "/path/to/my/videos" }
    }
  }
}`;

// Where the three clients people actually use keep that file. Literal paths rather than translated
// ones: a path is a path, and a translated one is a path that does not exist.
const PLACES = [
  { id: "desktop", path: "%APPDATA%\\Claude\\claude_desktop_config.json" },
  { id: "code", path: "claude mcp add videola -- node /path/to/videola/apps/server/dist/mcp.mjs" },
  { id: "other", path: ".cursor/mcp.json, .vscode/mcp.json, …" },
] as const;

/**
 * How to let an agent drive this editor.
 *
 * The server is already in the repository; what is missing for anyone who has not read the guide is
 * the four lines of configuration and where they go. So this dialogue is those four lines, a button
 * that puts them on the clipboard, and the three places they belong.
 */
export function Mcp({ onClose }: McpProps): ReactElement {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // The label goes back by itself: a button that stays on "copied" is a button nobody trusts the
  // second time.
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = (): void => {
    void navigator.clipboard?.writeText(CONFIG).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <dialog className="v-mcp" ref={ref} onClose={onClose} data-testid="mcp">
      <header className="v-mcp__head">
        <h2>{t("mcp.label")}</h2>
        <p>{t("mcp.what")}</p>
      </header>

      <ol className="v-mcp__steps">
        <li>
          {t("mcp.build")}
          <code>pnpm wasm &amp;&amp; pnpm --filter videola-server build</code>
        </li>
        <li>
          {t("mcp.write")}
          <pre data-testid="mcp-config">{CONFIG}</pre>
          <button type="button" className="v-button" onClick={copy} data-testid="mcp-copy">
            {copied ? t("mcp.copied") : t("mcp.copy")}
          </button>
        </li>
        <li>
          {t("mcp.where")}
          <dl className="v-mcp__places">
            {PLACES.map((place) => (
              <div key={place.id}>
                <dt>{t(`mcp.place.${place.id}`)}</dt>
                <dd>{place.path}</dd>
              </div>
            ))}
          </dl>
        </li>
      </ol>

      <p className="v-mcp__note">{t("mcp.note")}</p>

      <footer className="v-mcp__foot">
        <a href={DOCS} target="_blank" rel="noreferrer">
          <span>{t("mcp.docs")}</span>
          <Icon name="chevronRight" />
        </a>
        <button type="button" className="v-button" onClick={() => ref.current?.close()}>
          {t("about.close")}
        </button>
      </footer>
    </dialog>
  );
}
