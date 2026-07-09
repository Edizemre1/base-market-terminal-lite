import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /provider-hardening\.spec\.ts/,
  timeout: 45_000,
  reporter: [["list"]]
});
