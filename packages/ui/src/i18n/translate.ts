export type Catalog = Record<string, string>;
export type Vars = Record<string, string | number> & { count?: number };
export type NumberFormatter = (value: number) => string;

export function translate(catalog: Catalog, key: string, vars?: Vars, formatNumber?: NumberFormatter): string {
  const template = catalog[key];
  if (template === undefined) {
    return key;
  }
  return interpolate(selectPlural(template, vars), vars, formatNumber);
}

// ponytail: singular/plural only, which is all "de" and "en" need. A language with more
// plural categories needs Intl.PluralRules with named forms instead - the "a | b" catalogue
// syntax leaves room to grow into that. Splitting on " | " also means a translated string
// that genuinely contains that sequence (e.g. a menu label "Datei | Bearbeiten") would be
// misread as plural forms; no catalogue entry hits this today.
function selectPlural(template: string, vars?: Vars): string {
  const forms = template.split(" | ");
  if (forms.length < 2) {
    return template;
  }
  const count = vars?.count;
  const singular = forms[0] ?? template;
  const plural = forms[1] ?? singular;
  return count === 1 ? singular : plural;
}

function interpolate(template: string, vars?: Vars, formatNumber?: NumberFormatter): string {
  if (vars === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      return match;
    }
    return typeof value === "number" && formatNumber ? formatNumber(value) : String(value);
  });
}
