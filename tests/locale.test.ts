import assert from "node:assert/strict";
import test from "node:test";
import {
  FALLBACK_SITE_LOCALE,
  LEGACY_STATUS_STORAGE_KEY,
  LOCALE_PREFERENCE_STORAGE_KEY,
  applyLocaleIfNeeded,
  applyManualLocale,
  detectBrowserLocale,
  getExplicitLocaleFromPath,
  isSiteLocale,
  readManualLocalePreference,
  resolveInitialLocale,
  type LocaleStorage,
} from "../app/utils/locale";

class MemoryStorage implements LocaleStorage {
  private readonly values = new Map<string, string>();
  writes = 0;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.writes++;
    this.values.set(key, value);
  }

  seed(key: string, value: string) {
    this.values.set(key, value);
  }
}

const resolveFromBrowser = (
  languages: readonly unknown[] | undefined,
  language?: unknown,
) => resolveInitialLocale({ navigator: { languages, language } });

for (const [languages, expected] of [
  [["zh-CN"], "zh-CN"],
  [["zh-TW"], "zh-CN"],
  [["en-US"], "en"],
  [["ja-JP"], "ja-JP"],
  [["ko-KR"], "ko-KR"],
  [["fr-FR", "en-US"], "en"],
  [["de-DE"], "ja-JP"],
] as const) {
  test(`browser languages ${languages.join(",")} resolve to ${expected}`, () => {
    assert.equal(resolveFromBrowser(languages), expected);
  });
}

test("navigator.language is used when navigator.languages is unavailable", () => {
  assert.equal(resolveFromBrowser(undefined, "en-GB"), "en");
});

for (const [preference, browser] of [
  ["en", "zh-CN"],
  ["ko-KR", "ja-JP"],
] as const) {
  test(`manual ${preference} overrides browser ${browser}`, async () => {
    const storage = new MemoryStorage();
    await applyManualLocale({
      locale: preference,
      currentLocale: FALLBACK_SITE_LOCALE,
      storage,
      setLocale: async () => {},
    });

    assert.equal(
      resolveInitialLocale({ storage, navigator: { languages: [browser] } }),
      preference,
    );
  });
}

test("manual selections are saved, updated, and survive reload and browser changes", async () => {
  const storage = new MemoryStorage();
  const applied: string[] = [];

  await applyManualLocale({
    locale: "en",
    currentLocale: "zh-CN",
    storage,
    setLocale: async (locale) => applied.push(locale),
  });
  assert.equal(readManualLocalePreference(storage), "en");

  await applyManualLocale({
    locale: "ja-JP",
    currentLocale: "en",
    storage,
    setLocale: async (locale) => applied.push(locale),
  });
  assert.equal(readManualLocalePreference(storage), "ja-JP");
  assert.deepEqual(applied, ["en", "ja-JP"]);

  assert.equal(
    resolveInitialLocale({
      storage,
      navigator: { languages: ["zh-CN"] },
    }),
    "ja-JP",
  );
  assert.equal(
    resolveInitialLocale({
      storage,
      navigator: { languages: ["ko-KR"] },
    }),
    "ja-JP",
  );
});

test("automatic detection never creates a manual preference", () => {
  const storage = new MemoryStorage();

  assert.equal(
    resolveInitialLocale({
      storage,
      navigator: { languages: ["en-US"] },
    }),
    "en",
  );
  assert.equal(storage.getItem(LOCALE_PREFERENCE_STORAGE_KEY), null);
  assert.equal(storage.writes, 0);
});

test("browser changes are followed when no manual preference exists", () => {
  const storage = new MemoryStorage();

  assert.equal(
    resolveInitialLocale({
      storage,
      navigator: { languages: ["en-US"] },
    }),
    "en",
  );
  assert.equal(
    resolveInitialLocale({
      storage,
      navigator: { languages: ["ja-JP"] },
    }),
    "ja-JP",
  );
});

test("invalid preference storage is ignored", () => {
  const storage = new MemoryStorage();
  storage.seed(
    LOCALE_PREFERENCE_STORAGE_KEY,
    JSON.stringify({ version: 1, locale: "xx" }),
  );

  assert.equal(
    resolveInitialLocale({
      storage,
      navigator: { languages: ["ko-KR"] },
    }),
    "ko-KR",
  );
});

test("unavailable localStorage does not prevent browser detection or selection", async () => {
  const storage: LocaleStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const applied: string[] = [];

  assert.equal(
    resolveInitialLocale({
      storage,
      navigator: { languages: ["en-US"] },
    }),
    "en",
  );
  await applyManualLocale({
    locale: "ko-KR",
    currentLocale: "en",
    storage,
    setLocale: async (locale) => applied.push(locale),
  });
  assert.deepEqual(applied, ["ko-KR"]);
});

test("invalid and empty navigator.languages entries are skipped safely", () => {
  assert.equal(
    detectBrowserLocale({ languages: [null, "", 42, "fr-FR", "zh-HK"] }),
    "zh-CN",
  );
  assert.equal(detectBrowserLocale({ languages: [null, "", 42] }), "ja-JP");
});

test("explicit locale URLs take precedence without changing preferences", async () => {
  const storage = new MemoryStorage();
  await applyManualLocale({
    locale: "en",
    currentLocale: "ja-JP",
    storage,
    setLocale: async () => {},
  });

  assert.equal(getExplicitLocaleFromPath("/zh-CN/"), "zh-CN");
  assert.equal(
    resolveInitialLocale({
      path: "/zh-CN/",
      storage,
      navigator: { languages: ["ko-KR"] },
    }),
    "zh-CN",
  );
  assert.equal(readManualLocalePreference(storage), "en");
});

test("legacy non-default choices migrate but ambiguous zh-CN does not", () => {
  const manualStorage = new MemoryStorage();
  manualStorage.seed(
    LEGACY_STATUS_STORAGE_KEY,
    JSON.stringify({ siteLang: "ko-KR" }),
  );
  assert.equal(
    resolveInitialLocale({
      storage: manualStorage,
      navigator: { languages: ["en-US"] },
    }),
    "ko-KR",
  );
  assert.equal(readManualLocalePreference(manualStorage), "ko-KR");

  const ambiguousStorage = new MemoryStorage();
  ambiguousStorage.seed(
    LEGACY_STATUS_STORAGE_KEY,
    JSON.stringify({ siteLang: "zh-CN" }),
  );
  assert.equal(
    resolveInitialLocale({
      storage: ambiguousStorage,
      navigator: { languages: ["en-US"] },
    }),
    "en",
  );
  assert.equal(readManualLocalePreference(ambiguousStorage), undefined);
});

test("runtime locale application is skipped when already selected", () => {
  const applied: string[] = [];

  assert.equal(
    applyLocaleIfNeeded("en", "en", (value) => applied.push(value)),
    false,
  );
  assert.equal(
    applyLocaleIfNeeded("ja-JP", "en", (value) => applied.push(value)),
    true,
  );
  assert.deepEqual(applied, ["en"]);
});

test("every supported runtime locale is a valid html lang and selector value", () => {
  for (const locale of ["zh-CN", "en", "ja-JP", "ko-KR"] as const) {
    assert.equal(isSiteLocale(locale), true);
  }
  assert.equal(isSiteLocale("en-US"), false);
});
