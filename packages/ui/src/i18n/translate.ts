export type Catalog = Record<string, string>;
export type Vars = Record<string, string | number>;

export function translate(catalog: Catalog, key: string, vars?: Vars): string {
  const template = catalog[key];
  if (template === undefined) {
    return key;
  }
  return interpolate(selectPlural(template, vars), vars);
}

function selectPlural(template: string, vars?: Vars): string {
  const forms = template.split(" | ");
  if (forms.length < 2) {
    return template;
  }
  const count = vars?.count;
  const singular = forms[0] ?? template;
  const plural = forms[1] ?? singular;
  return typeof count === "number" && count === 1 ? singular : plural;
}

function interpolate(template: string, vars?: Vars): string {
  if (vars === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
