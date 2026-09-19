import { useEffect, useRef, useState, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { Icon } from "../primitives/Icon";
import "../export/ExportDialog.css";
import "./Mcp.css";

export interface McpProps {
  onClose: () => void;
}

const DOCS = "https://videola.app/guide/api-and-mcp";

const BUILD = "pnpm wasm && pnpm --filter videola-server build";

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
  { id: "other", path: ".cursor/mcp.json · .vscode/mcp.json" },
] as const;

/**
 * How to let an agent drive this editor.
 *
 * The server is already in the repository; what is missing for anyone who has not read the guide
 * is the four lines of configuration and where they go. So this is those four lines, a button that
 * puts them on the clipboard, and the three places they belong -- three steps, numbered, because
 * that is what it is.
 *
 * A native `<dialog>` for the focus trap and the Escape key, wearing the panel every other dialogue
 * in the application wears.
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
    <dialog className="v-export v-mcp" ref={ref} onClose={onClose} data-testid="mcp">
      <h2 className="v-export__title">{t("mcp.label")}</h2>
      <p className="v-export__note">{t("mcp.what")}</p>

      <div className="v-mcp__scroll">
        <ol className="v-mcp__steps">
          <Step number={1} title={t("mcp.build")}>
            <pre className="v-mcp__code">{BUILD}</pre>
          </Step>

          <Step number={2} title={t("mcp.write")}>
            <pre className="v-mcp__code" data-testid="mcp-config">
              {CONFIG}
            </pre>
            {/* Where the dialogue starts. Without it the browser hands the focus to the region
                that scrolls, which then wears the focus ring -- and the one thing anybody came
                here to press is the one thing that was not focused. */}
            <button
              type="button"
              className="v-button v-mcp__copy"
              onClick={copy}
              data-testid="mcp-copy"
              autoFocus
            >
              <Icon name={copied ? "check" : "copy"} />
              {copied ? t("mcp.copied") : t("mcp.copy")}
            </button>
          </Step>

          <Step number={3} title={t("mcp.where")}>
            <ul className="v-mcp__places">
              {PLACES.map((place) => (
                <li key={place.id}>
                  <span className="v-mcp__client">{t(`mcp.place.${place.id}`)}</span>
                  <code>{place.path}</code>
                </li>
              ))}
            </ul>
          </Step>
        </ol>

        <p className="v-mcp__note">{t("mcp.note")}</p>
      </div>

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

/** One of the three, with its number in a disc beside it -- the order is the instruction. */
function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <li className="v-mcp__step">
      <span className="v-mcp__number" aria-hidden="true">
        {number}
      </span>
      <div className="v-mcp__body">
        <h3 className="v-mcp__stepTitle">{title}</h3>
        {children}
      </div>
    </li>
  );
}
