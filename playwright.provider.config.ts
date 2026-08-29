import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /(provider-hardening|pulse-engine)\.spec\.ts/,
  timeout: 45_000,
  reporter: [["list"]]
});
