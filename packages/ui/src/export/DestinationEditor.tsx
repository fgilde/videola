import { useEffect, useRef, useState, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { Icon, type IconName } from "../primitives/Icon";
import "./DestinationsDialog.css";

export type DestinationKind =
  | "youtube"
  | "vimeo"
  | "peertube"
  | "mastodon"
  | "bluesky"
  | "telegram"
  | "facebook"
  | "webhook";

export interface DestinationField {
  key: string;
  /** Write-only: shown empty on an edit, and left alone when it is sent back empty. */
  secret: boolean;
}

/** The kinds, in the order somebody would scan them: the two everybody knows, then the open ones. */
export const KINDS: readonly DestinationKind[] = [
  "youtube",
  "vimeo",
  "peertube",
  "mastodon",
  "bluesky",
  "telegram",
  "facebook",
  "webhook",
];

/** One mark per kind. The paths are in the icon set, under Simple Icons' CC0 licence. */
export const GLYPH: Record<DestinationKind, IconName> = {
  youtube: "youtube",
  vimeo: "vimeo",
  peertube: "peertube",
  mastodon: "mastodon",
  bluesky: "bluesky",
  telegram: "telegram",
  facebook: "facebook",
  webhook: "hook",
};

/**
 * What each kind cannot work without, and what it takes beside that, in the order somebody fills
 * them in: where it is, who you are, and what it should do with a video once it is there.
 */
export const FIELDS: Record<DestinationKind, readonly DestinationField[]> = {
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
  peertube: [
    { key: "instance", secret: false },
    { key: "accessToken", secret: true },
    { key: "channelId", secret: false },
    { key: "privacy", secret: false },
  ],
  mastodon: [
    { key: "instance", secret: false },
    { key: "accessToken", secret: true },
    { key: "visibility", secret: false },
  ],
  bluesky: [
    { key: "handle", secret: false },
    { key: "appPassword", secret: true },
    { key: "service", secret: false },
  ],
  telegram: [
    { key: "botToken", secret: true },
    { key: "chatId", secret: false },
  ],
  facebook: [
    { key: "pageId", secret: false },
    { key: "pageToken", secret: true },
    { key: "published", secret: false },
  ],
  webhook: [{ key: "url", secret: true }],
};

export interface DestinationDraft {
  kind: DestinationKind;
  name: string;
  secrets: Record<string, string>;
  settings: Record<string, string>;
}

export interface DestinationEditorProps {
  /** Absent for a new one; present to change the one somebody picked. */
  editing?: {
    id: string;
    kind: DestinationKind;
    name: string;
    settings: Readonly<Record<string, string>>;
    holds: readonly string[];
  };
  /** Whether the server can run a YouTube sign-in at all. */
  canSignIn?: boolean;
  signingIn?: boolean;
  busy?: boolean;
  error?: string;
  onSignIn?: (name: string) => void;
  onSave: (draft: DestinationDraft) => void;
  onClose: () => void;
}

/**
 * One destination, added or changed.
 *
 * Its own dialogue rather than a third block under the list, because the two are different
 * questions: "where do my videos go" is a list to look at, and "set this one up" is a form with a
 * kind, a name and a handful of fields that depend on it. Putting both in one panel is what made
 * the old one a wall of boxes where the interesting line -- the list -- was the shortest.
 *
 * A secret is never read back, so a field for one is empty even when the destination holds it, and
 * empty means "leave it". The row underneath says what is held, because "did I paste the token?"
 * is a real question with no other answer.
 */
export function DestinationEditor(props: DestinationEditorProps): ReactElement {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<DestinationKind>(props.editing?.kind ?? "youtube");
  const [name, setName] = useState(props.editing?.name ?? "");
  const [values, setValues] = useState<Record<string, string>>({ ...props.editing?.settings });

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const fields = FIELDS[kind];
  const held = props.editing?.holds ?? [];
  // On an edit, a secret that is already there needs nothing typed; on a new one, every secret does.
  const ready =
    name.trim() !== "" &&
    fields.every(
      (field) =>
        !field.secret || held.includes(field.key) || (values[field.key] ?? "").trim() !== "",
    );

  return (
    <div className="v-export__scrim">
      <div
        ref={panel}
        className="v-export v-desteditor"
        role="dialog"
        aria-modal="true"
        aria-label={t(props.editing === undefined ? "destinations.add" : "destinations.edit")}
        tabIndex={-1}
        data-testid="destination-editor"
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onClose();
        }}
      >
        <h2 className="v-export__title">
          {t(props.editing === undefined ? "destinations.add" : "destinations.edit")}
        </h2>

        {/* The kind is fixed once a destination exists: changing it would be a different account,
            different fields and the same row -- which is a new destination wearing an old name. */}
        {props.editing === undefined && (
          <div className="v-dest__kinds" role="group" aria-label={t("destinations.kind")}>
            {KINDS.map((entry) => (
              <button
                key={entry}
                type="button"
                className="v-dest__kind"
                data-kind={entry}
                aria-pressed={kind === entry}
                onClick={() => {
                  setKind(entry);
                  setValues({});
                }}
              >
                <Icon name={GLYPH[entry]} />
                <span>{t(`destinations.kind.${entry}`)}</span>
              </button>
            ))}
          </div>
        )}

        <p className="v-export__note">{t(`destinations.help.${kind}`)}</p>

        {/* The whole point of the sign-in: three values from two pages of a console are what stopped
            anybody from ever setting a channel up. */}
        {kind === "youtube" && props.editing === undefined && (
          <div className="v-dest__signin">
            {props.canSignIn === true ? (
              <>
                <button
                  type="button"
                  className="v-button v-button--primary"
                  data-testid="destination-signin"
                  disabled={props.signingIn === true || props.busy === true}
                  onClick={() => props.onSignIn?.(name.trim() === "" ? "YouTube" : name.trim())}
                >
                  {t("destinations.signIn")}
                </button>
                <p className="v-export__note">
                  {props.signingIn === true
                    ? t("destinations.signInWaiting")
                    : t("destinations.signInNote")}
                </p>
              </>
            ) : (
              <p className="v-export__note" data-testid="destination-no-client">
                {t("destinations.signInMissing")}
              </p>
            )}
          </div>
        )}

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
              placeholder={
                field.secret && held.includes(field.key) ? t("destinations.kept") : undefined
              }
              data-field={field.key}
              onChange={(event) =>
                setValues((was) => ({ ...was, [field.key]: event.target.value }))
              }
            />
          </label>
        ))}

        {props.error !== undefined && (
          <p className="v-export__note" role="alert" data-testid="destination-error">
            {props.error}
          </p>
        )}

        <div className="v-export__actions">
          <button
            type="button"
            className="v-button v-button--primary"
            data-testid="destination-save"
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
              props.onSave({ kind, name: name.trim(), secrets, settings });
            }}
          >
            {t("destinations.save")}
          </button>
          <span className="v-templates__spacer" />
          <button type="button" className="v-button" onClick={props.onClose}>
            {t("destinations.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
