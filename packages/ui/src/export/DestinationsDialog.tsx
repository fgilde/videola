import { useEffect, useRef, useState, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { Icon } from "../primitives/Icon";
import {
  DestinationEditor,
  GLYPH,
  type DestinationDraft,
  type DestinationKind,
} from "./DestinationEditor";
import "./HandOffDialog.css";
import "./DestinationsDialog.css";

export type { DestinationKind } from "./DestinationEditor";
export type NewDestinationDraft = DestinationDraft;

export interface DestinationSummary {
  id: string;
  kind: DestinationKind;
  name: string;
  note?: string;
  holds: readonly string[];
  /** What is safe to show: the channel a sign-in named, an instance, a privacy setting. */
  settings?: Readonly<Record<string, string>>;
}

export interface DestinationsDialogProps {
  /** Where the server is and what it was given as a token. Empty until somebody says. */
  url: string;
  token: string;
  destinations: readonly DestinationSummary[];
  /** What went wrong last, in the server's own words. */
  error?: string;
  busy?: boolean;
  /** Whether this server holds an OAuth client, and can therefore offer a sign-in at all. */
  canSignIn?: boolean;
  /** True while a browser tab is open on the account's consent page. */
  signingIn?: boolean;
  onSignIn?: (name: string) => void;
  onConnect: (url: string, token: string) => void;
  onAdd: (draft: NewDestinationDraft) => void;
  onChange?: (id: string, draft: NewDestinationDraft) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

/**
 * Where finished videos go.
 *
 * A list, and a button that opens the form. It used to be three blocks stacked in one panel -- the
 * server, the list, and a form with every field of every kind under it -- so the one line worth
 * reading, which is "these are my channels", was the shortest thing on screen and the longest was a
 * wall of boxes for a destination nobody was setting up at that moment.
 *
 * The server block is first and folds itself away once it is answered: an editor in a browser
 * cannot upload to a channel on its own -- that needs a secret, and a secret in a browser is not one
 * -- so which server holds them is a precondition, asked once and then out of the way.
 */
export function DestinationsDialog(props: DestinationsDialogProps): ReactElement {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState(props.url);
  const [token, setToken] = useState(props.token);
  const [editing, setEditing] = useState<DestinationSummary | "new">();

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const connected = props.destinations.length > 0;

  return (
    <div className="v-export__scrim">
      <div
        ref={panel}
        className="v-export v-handoff"
        role="dialog"
        aria-modal="true"
        aria-label={t("destinations.title")}
        tabIndex={-1}
        data-testid="destinations"
        onKeyDown={(event) => {
          if (event.key === "Escape" && editing === undefined) props.onClose();
        }}
      >
        <h2 className="v-export__title">{t("destinations.title")}</h2>
        <p className="v-export__note">{t("destinations.intro")}</p>

        <details className="v-dest__server" open={!connected}>
          <summary>{t("destinations.server")}</summary>
          <label className="v-dest__field">
            <span>{t("destinations.url")}</span>
            <input
              type="url"
              value={url}
              placeholder={t("destinations.urlHint")}
              data-testid="destination-url"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="v-dest__field">
            <span>{t("destinations.token")}</span>
            <input
              type="password"
              value={token}
              data-testid="destination-token"
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="v-button"
            data-testid="destination-connect"
            disabled={props.busy === true}
            onClick={() => props.onConnect(url.trim(), token.trim())}
          >
            {t("destinations.connect")}
          </button>
        </details>

        {props.error !== undefined && editing === undefined && (
          <p className="v-export__note" role="alert" data-testid="destination-error">
            {props.error}
          </p>
        )}

        {props.destinations.length === 0 ? (
          <p className="v-export__note">{t("destinations.none")}</p>
        ) : (
          <ul className="v-dest__list">
            {props.destinations.map((destination) => (
              <li key={destination.id} className="v-dest__row" data-destination={destination.id}>
                <span className="v-dest__glyph" aria-hidden="true">
                  <Icon name={GLYPH[destination.kind]} />
                </span>
                <span className="v-dest__what">
                  <span className="v-dest__name">{destination.name}</span>
                  {/* What it is and where it goes, in one quiet line: the kind, and whatever the
                      destination knows about itself -- a channel a sign-in named, an instance
                      somebody typed. */}
                  <span className="v-dest__where">
                    {[t(`destinations.kind.${destination.kind}`), whereOf(destination)]
                      .filter((part) => part !== undefined && part !== "")
                      .join(" · ")}
                  </span>
                </span>
                <button
                  type="button"
                  className="v-button"
                  data-edit={destination.id}
                  onClick={() => setEditing(destination)}
                >
                  {t("destinations.editOne")}
                </button>
                <button
                  type="button"
                  className="v-button"
                  data-remove={destination.id}
                  onClick={() => props.onRemove(destination.id)}
                >
                  {t("destinations.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="v-export__actions">
          <button
            type="button"
            className="v-button v-button--primary"
            data-testid="destination-new"
            onClick={() => setEditing("new")}
          >
            {t("destinations.add")}
          </button>
          <span className="v-templates__spacer" />
          <button type="button" className="v-button" onClick={props.onClose}>
            {t("destinations.close")}
          </button>
        </div>
      </div>

      {editing !== undefined && (
        <DestinationEditor
          {...(editing === "new"
            ? {}
            : {
                editing: {
                  id: editing.id,
                  kind: editing.kind,
                  name: editing.name,
                  settings: editing.settings ?? {},
                  holds: editing.holds,
                },
              })}
          canSignIn={props.canSignIn}
          signingIn={props.signingIn}
          busy={props.busy}
          error={props.error}
          onSignIn={props.onSignIn}
          onSave={(draft) => {
            if (editing === "new") props.onAdd(draft);
            else props.onChange?.(editing.id, draft);
            setEditing(undefined);
          }}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

// The one thing a row can say about itself beyond its kind. Which setting that is depends on the
// kind, and a row that showed all of them would be the wall of text the list replaced.
function whereOf(destination: DestinationSummary): string | undefined {
  const settings = destination.settings ?? {};
  return settings.channel ?? settings.instance ?? settings.handle ?? settings.pageId;
}
