import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { en, tr, translate } from "../../src/i18n/dictionaries";

test.describe("typed TR/EN dictionary contract", () => {
  test("has an exact Turkish value for every English key", () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(tr)) {
      expect(value, key).toBeTruthy();
      expect(value, key).not.toBe(key);
    }
  });

  test("interpolates natural copy without exposing translation keys", () => {
    expect(translate("tr", "market.newUpdates", { count: 7 })).toBe("7 yeni piyasa güncellemesi");
    expect(translate("tr", "common.updatedAgo", { time: "12 sn" })).toBe("12 sn önce güncellendi");
    expect(translate("en", "wallet.error.cancelled")).toBe("Wallet connection was cancelled.");
  });

  test("locale formatters preserve numeric values while localizing presentation", () => {
    const value = 1_234_567.89;
    const enValue = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
    const trValue = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);
    expect(enValue).toBe("1,234,567.89");
    expect(trValue).toBe("1.234.567,89");
    expect(Number.parseFloat(String(value))).toBe(value);
  });

  test("reports unused static keys and keeps dynamic key families explicit", async ({}, testInfo) => {
    const source = readSourceTree(path.resolve(process.cwd(), "src"));
    const unused = Object.keys(en).filter((key) => !source.includes(`"${key}"`) && !source.includes(`'${key}'`));
    await testInfo.attach("unused-translation-keys.json", {
      body: Buffer.from(JSON.stringify({ count: unused.length, keys: unused }, null, 2)),
      contentType: "application/json"
    });
    const dynamicPrefixes = ["market.category.", "market.categoryDescription.", "details.signal.", "signal."];
    for (const prefix of dynamicPrefixes) expect(Object.keys(en).some((key) => key.startsWith(prefix)), prefix).toBeTruthy();
  });
});

function readSourceTree(directory: string): string {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return readSourceTree(target);
    if (target.endsWith(path.join("i18n", "dictionaries.ts"))) return "";
    return /\.(?:ts|tsx)$/.test(entry.name) ? readFileSync(target, "utf8") : "";
  }).join("\n");
}
