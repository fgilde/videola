import { useEffect, useRef, useState, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import "./HandOffDialog.css";

export type DestinationKind = "youtube" | "vimeo" | "webhook";

export interface DestinationSummary {
  id: string;
  kind: DestinationKind;
  name: string;
  note?: string;
  holds: readonly string[];
}

export interface NewDestinationDraft {
  kind: DestinationKind;
  name: string;
  secrets: Record<string, string>;
  settings: Record<string, string>;
}

export interface DestinationsDialogProps {
  /** Where the server is and what it was given as a token. Empty until somebody says. */
  url: string;
  token: string;
  destinations: readonly DestinationSummary[];
  /** What went wrong last, in the server's own words. */
  error?: string;
  busy?: boolean;
  onConnect: (url: string, token: string) => void;
  onAdd: (draft: NewDestinationDraft) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

/** What each kind cannot work without, in the order somebody would paste them. */
const FIELDS: Record<DestinationKind, readonly { key: string; secret: boolean }[]> = {
  youtube: [
    { key: "clientId", secret: true },
    { key: "clientSecret", secret: true },
    { key: "refreshToken", secret: true },
    { key: "privacyStatus", secret: false },
  ],
  vimeo: [
    { key: "accessToken", secret: true },
    { key: "privacy", secret: false },
  ],
  webhook: [{ key: "url", secret: true }],
};

/**
 * Where finished videos go, and what it takes to send them there.
 *
 * Two halves, and they are in this order because the first is a precondition of the second: which
 * server holds the destinations, and then the destinations themselves. An editor in a browser cannot
 * upload to YouTube on its own -- that needs a client secret, and a secret in a browser is not a
 * secret -- so this panel is a remote control for a Videola server that can.
 *
 * A secret is written and never read: the server says a destination holds a refresh token and never
 * what it is, so the fields are empty when a destination already exists and what is shown instead is
 * the list of what it holds. Rotating one means writing it again.
 */
export function DestinationsDialog(props: DestinationsDialogProps): ReactElement {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState(props.url);
  const [token, setToken] = useState(props.token);
  const [kind, setKind] = useState<DestinationKind>("youtube");
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const fields = FIELDS[kind];
  const ready = name.trim() !== "" && fields.every((field) => !field.secret || (values[field.key] ?? "") !== "");

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
          if (event.key === "Escape") props.onClose();
        }}
      >
        <h2 className="v-export__title">{t("destinations.title")}</h2>
        <p className="v-export__note">{t("destinations.intro")}</p>

        <section className="v-dest__block">
          <h3 className="v-dest__heading">{t("destinations.server")}</h3>
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
        </section>

        {props.error !== undefined && (
          <p className="v-export__note" role="alert" data-testid="destination-error">
            {props.error}
          </p>
        )}

        <section className="v-dest__block">
          <h3 className="v-dest__heading">{t("destinations.known")}</h3>
          {props.destinations.length === 0 ? (
            <p className="v-export__note">{t("destinations.none")}</p>
          ) : (
            <ul className="v-handoff__list">
              {props.destinations.map((destination) => (
                <li key={destination.id} className="v-dest__row" data-destination={destination.id}>
                  <span className="v-handoff__name">
                    {destination.name}
                    <span className="v-handoff__ext">{destination.kind}</span>
                  </span>
                  {/* What it holds, never what they are: the server does not say, and neither does
                      this. Shown at all because "did I paste the refresh token?" is a real question. */}
                  <span className="v-handoff__opens">
                    {t("destinations.holds", { keys: destination.holds.join(", ") })}
                  </span>
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
        </section>

        <section className="v-dest__block">
          <h3 className="v-dest__heading">{t("destinations.add")}</h3>
          <label className="v-dest__field">
            <span>{t("destinations.kind")}</span>
            <select
              value={kind}
              data-testid="destination-kind"
              onChange={(event) => {
                setKind(event.target.value as DestinationKind);
                setValues({});
              }}
            >
              {(["youtube", "vimeo", "webhook"] as const).map((entry) => (
                <option key={entry} value={entry}>
                  {t(`destinations.kind.${entry}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="v-dest__field">
            <span>{t("destinations.name")}</span>
            <input
              type="text"
              value={name}
              data-testid="destination-name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {fields.map((field) => (
            <label className="v-dest__field" key={field.key}>
              <span>{t(`destinations.field.${field.key}`)}</span>
              <input
                type={field.secret ? "password" : "text"}
                value={values[field.key] ?? ""}
                data-field={field.key}
                onChange={(event) =>
                  setValues((held) => ({ ...held, [field.key]: event.target.value }))
                }
              />
            </label>
          ))}
          <p className="v-export__note">{t(`destinations.help.${kind}`)}</p>
          <button
            type="button"
            className="v-button v-button--primary"
            data-testid="destination-add"
            disabled={!ready || props.busy === true}
            onClick={() => {
              const secrets: Record<string, string> = {};
              const settings: Record<string, string> = {};
              for (const field of fields) {
                const value = (values[field.key] ?? "").trim();
                if (value === "") continue;
                if (field.secret) secrets[field.key] = value;
                else settings[field.key] = value;
              }
              props.onAdd({ kind, name: name.trim(), secrets, settings });
              setName("");
              setValues({});
            }}
          >
            {t("destinations.save")}
          </button>
        </section>

        <div className="v-export__actions">
          <button type="button" className="v-button" onClick={props.onClose}>
            {t("destinations.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
