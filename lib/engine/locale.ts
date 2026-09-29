import { allLocales, type LocaleDefinition } from "@faker-js/faker";

/**
 * Server-side locale resolution for generation jobs. Kept out of
 * tabular-engine.ts because `allLocales` bundles every locale, and the engine
 * also runs in the browser for live previews.
 */

const LOCALES = allLocales as Record<string, LocaleDefinition>;

/** "de-DE" / "de_de" → "de_DE"; the key format Faker uses. */
function normalizeLocaleCode(code: string): string {
  const [lang, ...rest] = code.trim().replace(/-/g, "_").split("_");
  return [lang.toLowerCase(), ...rest.map((part) => part.toUpperCase())].join("_");
}

function findLocaleKey(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = normalizeLocaleCode(code);
  if (normalized in LOCALES) return normalized;
  // "de_XX" → "de" when the region isn't available
  const lang = normalized.split("_")[0];
  return lang in LOCALES ? lang : null;
}

export function isSupportedLocale(code: string): boolean {
  return findLocaleKey(code) !== null;
}

/**
 * Faker locale chain for a job locale code, e.g. "de_AT" → [de_AT, de, en, base].
 * Regional locales only define a few fields, so the parent language fills the
 * rest; English is the final fallback (also for unknown codes).
 */
export function resolveFakerLocale(code: string | null | undefined): LocaleDefinition[] {
  const key = findLocaleKey(code);
  const chain = new Set<string>();
  if (key) {
    chain.add(key);
    chain.add(key.split("_")[0]);
  }
  chain.add("en");
  chain.add("base");
  return [...chain].filter((k) => k in LOCALES).map((k) => LOCALES[k]);
}
