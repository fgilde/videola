import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { useI18n, type Locale } from "../i18n/useI18n";
import "./EffectBrowser.css";

/**
 * What the browser needs of an effect to offer it. `EffectManifest` from `@videola/engine` satisfies
 * this structurally, the same way `EffectDescriptor` does -- which is what keeps this package from
 * depending on the engine and, through it, on a demuxer.
 */
export interface EffectOffer {
  id: string;
  name: Record<Locale, string>;
  blurb: Record<Locale, string>;
  category: string;
  inputs: 1 | 2;
}

export interface EffectBrowserProps {
  offers: readonly EffectOffer[];
  /**
   * Narrows the shelf to one kind. Opened from the transition row it shows transitions, and from
   * the effect list the effects -- so that the button that opened it was telling the truth. Left
   * out, everything the build can draw is on offer.
   */
  only?: 1 | 2;
  /** Effect types the clip already carries, and the transition it already has. Both refuse a second. */
  taken: readonly string[];
  /**
   * One picture per effect id, keyed the way the offers are. Undefined while the tiles are still
   * being drawn; an id missing from a map that has arrived is an effect whose tile could not be
   * made, and it gets no picture rather than a grey box pretending to be one.
   */
  tiles: ReadonlyMap<string, string> | undefined;
  onAdd: (id: string) => void;
  onClose: () => void;
}

// The order categories are read in, from the most reached-for to the most specialised. Anything the
// registry grows that is not named here lands at the end rather than disappearing.
const ORDER = ["color", "detail", "key", "transition"];

export function EffectBrowser({
  offers,
  only,
  taken,
  tiles,
  onAdd,
  onClose,
}: EffectBrowserProps): ReactElement {
  const { t, locale } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    panel.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const groups = useMemo(() => {
    const shelf = only === undefined ? offers : offers.filter((offer) => offer.inputs === only);
    return grouped(matching(shelf, query, locale));
  }, [offers, only, query, locale]);
  const found = groups.reduce((count, group) => count + group.offers.length, 0);

  return (
    <div className="v-fx__scrim">
      <div
        ref={panel}
        className="v-fx"
        role="dialog"
        aria-modal="true"
        aria-label={t("fx.title")}
        tabIndex={-1}
        data-testid="effect-browser"
        // What the host handed over, so a shelf with no pictures says which of the three things
        // happened: the drawing never finished ("pending"), it finished with nothing, or it finished
        // with pictures whose keys do not match these offers. A grid of blank tiles cannot be told
        // apart from the outside, which is what made this hard to chase.
        data-tiles={tiles === undefined ? "pending" : String(tiles.size)}
      >
        <div className="v-fx__head">
          <h2 className="v-fx__title">{t("fx.title")}</h2>
          <input
            type="search"
            className="v-fx__search"
            aria-label={t("fx.search")}
            placeholder={t("fx.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="v-button" onClick={onClose}>
            {t("fx.close")}
          </button>
        </div>

        {found === 0 ? (
          <p className="v-fx__empty">{t("fx.noMatch", { query })}</p>
        ) : (
          groups.map((group) => (
            <section className="v-fx__group" key={group.category}>
              <h3 className="v-fx__category">{categoryName(t, group.category)}</h3>
              <ul className="v-fx__grid">
                {group.offers.map((offer) => (
                  <Tile
                    key={offer.id}
                    offer={offer}
                    picture={tiles?.get(offer.id)}
                    pending={tiles === undefined}
                    taken={taken.includes(offer.id)}
                    onAdd={onAdd}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function Tile({
  offer,
  picture,
  pending,
  taken,
  onAdd,
}: {
  offer: EffectOffer;
  picture: string | undefined;
  pending: boolean;
  taken: boolean;
  onAdd: (id: string) => void;
}): ReactElement {
  const { t, locale } = useI18n();
  return (
    <li className="v-fx__tile" data-effect-id={offer.id}>
      {/* The checkerboard is the point of the frame around the picture: a mask and a chroma key
          make holes, and over a flat panel a hole reads as a black rectangle the effect painted. */}
      <div className="v-fx__picture" data-pending={pending && picture === undefined ? "" : undefined}>
        {picture !== undefined && (
          <img
            className="v-fx__image"
            src={picture}
            // The tile is what the name and the sentence beside it already say; a second reading of
            // the same fact is noise to anyone listening to the page rather than looking at it.
            alt=""
            data-testid={`fx-tile-${offer.id}`}
          />
        )}
      </div>
      <h4 className="v-fx__name">{offer.name[locale]}</h4>
      <p className="v-fx__blurb">{offer.blurb[locale]}</p>
      <button
        type="button"
        className="v-button v-button--primary v-fx__add"
        disabled={taken}
        onClick={() => onAdd(offer.id)}
      >
        {taken ? t("fx.taken") : offer.inputs === 2 ? t("fx.useTransition") : t("fx.use")}
      </button>
    </li>
  );
}

interface Group {
  category: string;
  offers: readonly EffectOffer[];
}

function grouped(offers: readonly EffectOffer[]): Group[] {
  const groups = new Map<string, EffectOffer[]>();
  for (const offer of offers) {
    const bucket = groups.get(offer.category) ?? [];
    bucket.push(offer);
    groups.set(offer.category, bucket);
  }
  return [...groups]
    .map(([category, list]) => ({ category, offers: list }))
    .sort((one, other) => rank(one.category) - rank(other.category));
}

function rank(category: string): number {
  const at = ORDER.indexOf(category);
  return at === -1 ? ORDER.length : at;
}

/**
 * Over the name and the sentence under it, and over both languages rather than the one on screen:
 * somebody who knows an effect as "blur" should find it with the German surface up, and the word
 * that describes what it does is more often what is typed than the word it is called.
 */
function matching(
  offers: readonly EffectOffer[],
  query: string,
  locale: Locale,
): readonly EffectOffer[] {
  const wanted = query.trim().toLocaleLowerCase(locale);
  if (wanted === "") return offers;
  return offers.filter((offer) =>
    [offer.name.de, offer.name.en, offer.blurb.de, offer.blurb.en, offer.id].some((text) =>
      text.toLocaleLowerCase(locale).includes(wanted),
    ),
  );
}

// A category the build knows gets its own heading; anything else is shown under its own bare name
// rather than swallowed, so an effect added to the registry is never invisible here.
function categoryName(t: (key: string) => string, category: string): string {
  const named = t(`fx.category.${category}`);
  return named === `fx.category.${category}` ? category : named;
}
