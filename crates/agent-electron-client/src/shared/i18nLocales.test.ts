import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LOCALE_FILES = [
  "en-US.json",
  "zh-CN.json",
  "zh-TW.json",
  "zh-HK.json",
] as const;
const LOCALES_DIR = path.resolve(process.cwd(), "src/shared/locales");

type LocaleName = (typeof LOCALE_FILES)[number];
type LocaleMap = Record<string, string>;

function loadLocale(name: LocaleName): LocaleMap {
  const filePath = path.join(LOCALES_DIR, name);
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as LocaleMap;
}

function extractPlaceholders(template: string): string[] {
  return (template.match(/\{[^}]*\}/g) || []).sort();
}

describe("i18n locale consistency", () => {
  const localeMaps = Object.fromEntries(
    LOCALE_FILES.map((name) => [name, loadLocale(name)]),
  ) as Record<LocaleName, LocaleMap>;

  it("all locale files should have the exact same key set", () => {
    const baselineKeys = new Set(Object.keys(localeMaps["en-US.json"]));

    for (const localeName of LOCALE_FILES.slice(1)) {
      const currentKeys = new Set(Object.keys(localeMaps[localeName]));
      const missing = [...baselineKeys].filter((k) => !currentKeys.has(k));
      const extra = [...currentKeys].filter((k) => !baselineKeys.has(k));

      expect(
        { localeName, missing, extra },
        `${localeName} keys mismatch with en-US.json`,
      ).toEqual({ localeName, missing: [], extra: [] });
    }
  });

  it("all i18n keys should match renderer key format", () => {
    const keyRegex =
      /^(Claw|PC|Mobile)\.[A-Z][A-Za-z0-9]*\.([A-Za-z0-9]+\.)*[A-Za-z][A-Za-z0-9]*$/;

    const invalidKeys = Object.keys(localeMaps["en-US.json"]).filter(
      (key) => !keyRegex.test(key),
    );

    expect(invalidKeys).toEqual([]);
  });

  it("placeholder tokens should stay consistent across locales", () => {
    const baseline = localeMaps["en-US.json"];

    for (const key of Object.keys(baseline)) {
      const basePlaceholders = extractPlaceholders(String(baseline[key] || ""));

      for (const localeName of LOCALE_FILES.slice(1)) {
        const localized = localeMaps[localeName][key];
        const localizedPlaceholders = extractPlaceholders(
          String(localized || ""),
        );

        expect(
          { key, localeName, basePlaceholders, localizedPlaceholders },
          `placeholder mismatch for ${key} in ${localeName}`,
        ).toEqual({
          key,
          localeName,
          basePlaceholders,
          localizedPlaceholders: basePlaceholders,
        });
      }
    }
  });
});
