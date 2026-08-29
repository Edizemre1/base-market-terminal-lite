import { expect, test } from "@playwright/test";
import { installVerifiedWalletStub } from "./helpers/walletStub";

test.describe("wallet picker and terminal localization", () => {
  test("shows an honest install state without opening an external page", async ({ page }) => {
    await page.goto("/terminal?data=mock");
    await page.getByTestId("connect-wallet-button").click();
    await expect(page.getByTestId("wallet-picker")).toBeVisible();
    await expect(page.getByText(/No installed EVM wallet|Yüklü EVM cüzdanı/)).toBeVisible();
    await expect(page.getByTestId("get-wallet-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  test("discovers a verified wallet but requests the account only after selection", async ({ page }) => {
    await installVerifiedWalletStub(page);
    await page.goto("/terminal?data=mock");
    await page.getByTestId("connect-wallet-button").click();
    await expect(page.getByTestId("wallet-provider-legacy:injected")).toContainText("MetaMask");
    expect(await page.evaluate(() => (window as Window & { __walletHarness?: { requests: unknown[] } }).__walletHarness?.requests.length)).toBe(0);
    await page.getByTestId("wallet-provider-legacy:injected").click();
    await expect(page.getByTestId("connect-wallet-button")).toContainText("0x1111...1111");
  });

  test("switches the complete new surface between English and Turkish", async ({ page, context }) => {
    await context.addCookies([{ name: "mergen_locale", value: "en", domain: "127.0.0.1", path: "/" }]);
    await page.goto("/terminal?data=mock");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("opportunity-lane-new")).toContainText("New on Base");
    await expect(page.getByTestId("trade-dock")).toContainText("Trade Dock");
    await page.getByRole("button", { name: "tr" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
    await expect(page.getByTestId("opportunity-lane-new")).toContainText("Base'te Yeni");
    await expect(page.getByTestId("trade-dock")).toContainText("İşlem Alanı");
  });

  test("keeps keyboard escape and focus return on the wallet picker", async ({ page }) => {
    await page.goto("/terminal?data=mock");
    const trigger = page.getByTestId("connect-wallet-button");
    await trigger.focus();
    await trigger.press("Enter");
    await expect(page.getByTestId("wallet-picker")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("wallet-picker")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
