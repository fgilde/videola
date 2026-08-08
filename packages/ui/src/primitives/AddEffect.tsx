import type { ReactElement } from "react";

import { useI18n, type Locale } from "../i18n/useI18n";

export interface EffectOffer {
  id: string;
  name: Record<Locale, string>;
}

/**
 * What is on offer is a list to pick from, not a stack of buttons. Nine video effects were nine
 * 44 px targets down a 300 px column and three more in every mixer strip -- which is what left the
 * strip taller than the band it lives in and the properties panel scrolling past its own sliders.
 * One control, whatever the registry grows to.
 */
export function AddEffect({
  offers,
  onAdd,
}: {
  offers: readonly EffectOffer[];
  onAdd: (id: string) => void;
}): ReactElement | null {
  const { t, locale } = useI18n();
  if (offers.length === 0) return null;

  return (
    <select
      className="v-addEffect"
      aria-label={t("inspector.addEffect")}
      // Held empty: the choice is an action, and a picker left showing the last effect added would
      // read as a setting that is now in force.
      value=""
      onChange={(event) => onAdd(event.target.value)}
    >
      <option value="" disabled>
        {t("inspector.addEffect")}
      </option>
      {offers.map((offer) => (
        <option key={offer.id} value={offer.id}>
          {offer.name[locale]}
        </option>
      ))}
    </select>
  );
}
