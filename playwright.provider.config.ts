import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /(provider-hardening|pulse-engine|i18n-contract|quality-math|terminal-v3|opportunity-model)\.spec\.ts/,
  timeout: 45_000,
  reporter: [["list"]]
});
