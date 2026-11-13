// Wizard copy reader.
//
// The Vue runtime (assets/js/i18n.js) is not loaded before the setup wizard:
// mounting it would start the legacy shell and clear identity on an
// uninstalled instance. This module reads the same two catalogs with the same
// locale preference so the wizard speaks one language, not a second one.
// It is a reader, not a translation engine: flat keys, {name} interpolation,
// English falls back to the Spanish source, and a miss never renders the key.

export type Translator = (key: string, params?: Record<string, string | number>) => string;

export const PLACEHOLDER_KEY = 'ui.i18n.text_unavailable';

const SOURCE_LOCALE = 'es';
const SUPPORTED = ['es', 'en'];
const STORAGE_KEY = 'itsm.locale';

type Catalog = Record<string, string>;

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const tag = value.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED.includes(tag) ? tag : null;
}

function preferred(): string {
  try {
    const stored = normalize(window.localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch { /* a blocked storage keeps the default */ }
  const declared = normalize(typeof document === 'undefined' ? null : document.documentElement.lang);
  if (declared) return declared;
  try {
    const navigatorTag = normalize(navigator.language);
    if (navigatorTag) return navigatorTag;
  } catch { /* no navigator: the source locale wins */ }
  return SOURCE_LOCALE;
}

async function catalog(tag: string): Promise<Catalog | null> {
  try {
    const url = new URL(`assets/i18n/${tag}.json`, document.baseURI).href;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return data && typeof data === 'object' ? data as Catalog : null;
  } catch {
    return null;
  }
}

let pending: Promise<Translator | null> | undefined;

export function loadTranslator(): Promise<Translator | null> {
  return pending ??= (async () => {
    const locale = preferred();
    const [primary, source] = await Promise.all([
      catalog(locale),
      locale === SOURCE_LOCALE ? Promise.resolve(null) : catalog(SOURCE_LOCALE),
    ]);
    const catalogs = [primary, source].filter((entry): entry is Catalog => entry !== null);
    if (catalogs.length === 0) return null;
    const fallback = catalogs.reduce<string | null>((found, entry) => found ?? entry[PLACEHOLDER_KEY] ?? null, null)
      ?? (locale === 'en' ? 'Text unavailable' : 'Texto no disponible');
    return (key, params) => {
      const message = catalogs.reduce<string | null>((found, entry) => {
        const value = entry[key];
        return found ?? (typeof value === 'string' ? value : null);
      }, null);
      if (message === null) return fallback;
      if (!params) return message;
      return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
        (name in params ? String(params[name]) : match));
    };
  })();
}
