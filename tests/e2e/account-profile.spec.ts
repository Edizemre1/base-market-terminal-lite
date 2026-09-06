import { expect, test, type Page } from "@playwright/test";
import { installVerifiedWalletStub } from "./helpers/walletStub";

const canonicalProfile = {
  version: 1,
  subject: "123e4567-e89b-42d3-a456-426614174000",
  email: "member@example.com",
  displayName: "Mergen Member",
  memberSince: "2025-01-02T03:04:05.000Z",
  lastSignInAt: "2026-08-30T10:00:00.000Z",
  membership: "pro"
} as const;

test.describe("canonical Mergen account consumer", () => {
  test("fresh anonymous load performs no account or wallet request", async ({ page }) => {
    const accountRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/account/")) accountRequests.push(request.url());
    });
    await installVerifiedWalletStub(page);
    await page.goto("/terminal?data=mock");
    await expect(page.getByTestId("mergen-account-button")).toHaveAttribute("data-account-state", "anonymous");
    await expect(page.getByTestId("connect-wallet-button")).not.toHaveAttribute("data-wallet-status", "connected");
    await page.getByTestId("mergen-account-button").click();
    await expect(page.getByTestId("mergen-profile")).toHaveAttribute("data-account-state", "sign_in_required");
    expect(accountRequests).toEqual([]);
    expect(await walletMethods(page)).toEqual([]);
  });

  test("persisted wallet preference cannot manufacture a Mergen identity", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("mergen-pulse:wallet-provider:v2", JSON.stringify({ id: "legacy:injected", name: "MetaMask", compatibility: "verified" }));
      localStorage.setItem("mergen-pulse:wallet-address", "0x9999999999999999999999999999999999999999");
      localStorage.setItem("mergen-pulse:wallet-connected", "true");
    });
    await installVerifiedWalletStub(page);
    await page.goto("/terminal?data=mock");
    await expect(page.getByTestId("connect-wallet-button")).toHaveAttribute("data-wallet-status", "reconnect_required");
    await expect(page.getByTestId("mergen-account-button")).toHaveAttribute("data-account-state", "anonymous");
    await expect(page.getByTestId("mergen-account-button")).toContainText(/Sign in to Mergen|Mergen'e giriş yap/);
  });

  test("renders only the exact canonical profile and replaces another primary overlay", async ({ page, context }) => {
    await installAuthenticatedSession(page, context);
    await page.goto("/terminal?data=mock");
    await expect(page.getByTestId("mergen-account-button")).toHaveAttribute("data-account-state", "profile_ready");
    await expect(page.getByTestId("connect-wallet-button")).not.toHaveAttribute("data-wallet-status", "connected");
    await page.getByTestId("matrix-row-pepe-weth").getByRole("button", { name: /Inspect|incele/ }).click();
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "market_inspector");
    await page.getByTestId("mergen-account-button").evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "mergen_profile");
    await expect(page.getByTestId("context-inspector")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const drawer = page.getByTestId("mergen-profile");
    await expect(drawer).toContainText("Mergen Member");
    await expect(drawer).toContainText("member@example.com");
    await expect(drawer).toContainText("Mergen Pro");
    await expect(drawer).not.toContainText(/handle|linked wallet/i);
    await expect(drawer).toContainText(/Mergen account and active wallet are separate|Mergen hesabın ve aktif cüzdanın ayrıdır/i);
    await page.getByRole("button", { name: "Close profile" }).click();
    await page.getByTestId("locale-switcher").getByRole("button", { name: "tr", exact: true }).click();
    await page.getByTestId("mergen-account-button").click();
    await expect(page.getByTestId("mergen-profile")).toContainText("Profilim");
    await expect(page.getByTestId("mergen-profile")).toContainText("Üyelik tarihi");
  });

  test("expired session clears personal profile data", async ({ page, context }) => {
    await context.addCookies([{ name: "mergen_base_account_hint", value: "1", url: "http://127.0.0.1:3000" }]);
    await page.route("**/api/account/session", (route) => route.fulfill({ status: 401, json: { state: "session_expired" } }));
    await page.goto("/terminal?data=mock");
    await expect(page.getByTestId("mergen-account-button")).toHaveAttribute("data-account-state", "session_expired");
    await page.getByTestId("mergen-account-button").click();
    await expect(page.getByTestId("mergen-profile")).toContainText(/Session expired|Oturum süresi doldu/);
    await expect(page.getByTestId("mergen-profile")).not.toContainText("member@example.com");
  });

  test("wallet connection stays separate and logout makes no wallet transaction or disconnect request", async ({ page, context }) => {
    let logoutPosts = 0;
    await installVerifiedWalletStub(page);
    await installAuthenticatedSession(page, context);
    await page.route("**/api/account/logout*", async (route) => {
      logoutPosts += 1;
      await route.fulfill({
        status: 303,
        headers: {
          location: "/terminal?data=mock&account=logged_out",
          "set-cookie": "mergen_base_account_hint=; Max-Age=0; Path=/; SameSite=Lax"
        }
      });
    });
    await page.goto("/terminal?data=mock");
    await page.getByTestId("connect-wallet-button").click();
    await page.getByTestId("wallet-provider-legacy:injected").click();
    await expect(page.getByTestId("connect-wallet-button")).toHaveAttribute("data-wallet-status", "connected");
    await expect(page.getByTestId("mergen-account-button")).toHaveAttribute("data-account-state", "profile_ready");
    await page.getByTestId("mergen-account-button").click();
    await page.getByTestId("mergen-sign-out").click();
    await expect.poll(() => logoutPosts).toBe(1);
    await expect(page.getByTestId("mergen-account-button")).toHaveAttribute("data-account-state", "logged_out");
    expect(await walletMethods(page)).not.toContain("eth_sendTransaction");
    expect(await walletMethods(page)).not.toContain("wallet_disconnect");
  });
});

async function installAuthenticatedSession(page: Page, context: import("@playwright/test").BrowserContext) {
  await context.addCookies([{ name: "mergen_base_account_hint", value: "1", url: "http://127.0.0.1:3000" }]);
  await page.route("**/api/account/session", (route) => route.fulfill({ status: 200, json: { state: "profile_ready", profile: canonicalProfile } }));
}

async function walletMethods(page: Page) {
  return page.evaluate(() => ((window as Window & { __walletHarness?: { requests: Array<{ method: string }> } }).__walletHarness?.requests ?? []).map((request) => request.method));
}
