import type { SiteLangType } from "~~/types/main";

export const SUPPORTED_SITE_LOCALES = [
  "zh-CN",
  "en",
  "ja-JP",
  "ko-KR",
] as const satisfies readonly SiteLangType[];

export const FALLBACK_SITE_LOCALE: SiteLangType = "ja-JP";
export const LOCALE_PREFERENCE_STORAGE_KEY = "site-status:locale-preference";
export const LEGACY_STATUS_STORAGE_KEY = "status";

const LOCALE_PREFERENCE_VERSION = 1 as const;

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NavigatorLocaleSource {
  readonly languages?: readonly unknown[];
  readonly language?: unknown;
}

interface LocalePreferenceRecord {
  version: typeof LOCALE_PREFERENCE_VERSION;
  locale: SiteLangType;
}

export const isSiteLocale = (value: unknown): value is SiteLangType =>
  typeof value === "string" &&
  SUPPORTED_SITE_LOCALES.some((locale) => locale === value);

export const mapBrowserLanguage = (
  language: unknown,
): SiteLangType | undefined => {
  if (typeof language !== "string") return undefined;
  const prefix = language.trim().toLowerCase().split(/[-_]/)[0];
  if (prefix === "zh") return "zh-CN";
  if (prefix === "en") return "en";
  if (prefix === "ja") return "ja-JP";
  if (prefix === "ko") return "ko-KR";
  return undefined;
};

export const detectBrowserLocale = (
  navigatorSource?: NavigatorLocaleSource,
): SiteLangType => {
  let languages: readonly unknown[] | undefined;
  try {
    if (Array.isArray(navigatorSource?.languages)) {
      languages = navigatorSource.languages;
    }
  } catch {
    languages = undefined;
  }

  if (languages?.length) {
    for (const language of languages) {
      const locale = mapBrowserLanguage(language);
      if (locale) return locale;
    }
    return FALLBACK_SITE_LOCALE;
  }

  try {
    return (
      mapBrowserLanguage(navigatorSource?.language) ?? FALLBACK_SITE_LOCALE
    );
  } catch {
    return FALLBACK_SITE_LOCALE;
  }
};

export const getExplicitLocaleFromPath = (
  path: string | undefined,
): SiteLangType | undefined => {
  if (!path) return undefined;
  const firstSegment = path.split(/[?#]/, 1)[0]?.split("/").filter(Boolean)[0];
  if (!firstSegment) return undefined;
  return SUPPORTED_SITE_LOCALES.find(
    (locale) => locale.toLowerCase() === firstSegment.toLowerCase(),
  );
};

export const readManualLocalePreference = (
  storage?: LocaleStorage,
): SiteLangType | undefined => {
  if (!storage) return undefined;
  try {
    const stored = storage.getItem(LOCALE_PREFERENCE_STORAGE_KEY);
    if (!stored) return undefined;
    const record: unknown = JSON.parse(stored);
    if (
      typeof record === "object" &&
      record !== null &&
      "version" in record &&
      record.version === LOCALE_PREFERENCE_VERSION &&
      "locale" in record &&
      isSiteLocale(record.locale)
    ) {
      return record.locale;
    }
  } catch {
    // Storage can be blocked or contain malformed data. Detection still works.
  }
  return undefined;
};

export const writeManualLocalePreference = (
  storage: LocaleStorage | undefined,
  locale: SiteLangType,
): boolean => {
  if (!storage) return false;
  const record: LocalePreferenceRecord = {
    version: LOCALE_PREFERENCE_VERSION,
    locale,
  };
  try {
    storage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
};

const readLegacyLocale = (
  storage?: LocaleStorage,
): SiteLangType | undefined => {
  if (!storage) return undefined;
  try {
    const stored = storage.getItem(LEGACY_STATUS_STORAGE_KEY);
    if (!stored) return undefined;
    const state: unknown = JSON.parse(stored);
    if (
      typeof state === "object" &&
      state !== null &&
      "siteLang" in state &&
      isSiteLocale(state.siteLang)
    ) {
      return state.siteLang;
    }
  } catch {
    // Ignore legacy storage that cannot be read or validated.
  }
  return undefined;
};

export const readOrMigrateManualLocalePreference = (
  storage?: LocaleStorage,
): SiteLangType | undefined => {
  const preference = readManualLocalePreference(storage);
  if (preference) return preference;

  const legacyLocale = readLegacyLocale(storage);
  // The old store wrote its default zh-CN after unrelated store mutations, so
  // only non-default values can be safely identified as explicit selections.
  if (!legacyLocale || legacyLocale === "zh-CN") return undefined;
  writeManualLocalePreference(storage, legacyLocale);
  return legacyLocale;
};

export const resolveInitialLocale = (options: {
  path?: string;
  storage?: LocaleStorage;
  navigator?: NavigatorLocaleSource;
}): SiteLangType =>
  getExplicitLocaleFromPath(options.path) ??
  readOrMigrateManualLocalePreference(options.storage) ??
  detectBrowserLocale(options.navigator);

export const getClientLocaleStorage = (): LocaleStorage | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

export const applyLocaleIfNeeded = (
  currentLocale: unknown,
  nextLocale: SiteLangType,
  apply: (locale: SiteLangType) => void,
): boolean => {
  if (currentLocale === nextLocale) return false;
  apply(nextLocale);
  return true;
};

export const applyManualLocale = async (options: {
  locale: unknown;
  currentLocale: unknown;
  storage?: LocaleStorage;
  setLocale: (locale: SiteLangType) => Promise<unknown>;
}): Promise<SiteLangType | undefined> => {
  if (!isSiteLocale(options.locale)) return undefined;
  writeManualLocalePreference(options.storage, options.locale);
  if (options.currentLocale !== options.locale) {
    await options.setLocale(options.locale);
  }
  return options.locale;
};
