import { expect, test } from "@playwright/test";

test.describe("terminal quality regression", () => {
  test("serves canonical views with localized titles and one h1", async ({ page, context }) => {
    for (const locale of ["en", "tr"] as const) {
      await context.addCookies([{ name: "mergen_locale", value: locale, domain: "127.0.0.1", path: "/" }]);
      for (const [route, title] of [["/terminal?data=mock", locale === "tr" ? "Terminal" : "Terminal"], ["/terminal?data=mock&view=markets", locale === "tr" ? "Piyasalar" : "Markets"], ["/terminal?data=mock&view=watchlist", locale === "tr" ? "İzleme Listesi" : "Watchlist"], ["/terminal?data=mock&view=portfolio", locale === "tr" ? "Portföy" : "Portfolio"], ["/terminal?data=mock&view=alerts", locale === "tr" ? "Alarmlar" : "Alerts"]] as const) {
        await page.goto(route);
        await expect(page).toHaveTitle(`${title} | Mergen.finance`);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      }
    }
  });

  test("preserves one canonical market identity from matrix to inspector and dock", async ({ page }) => {
    await page.goto("/terminal?data=mock&view=markets");
    const row = page.getByTestId("matrix-row-blob-usdc");
    const key = await row.getAttribute("data-market-key");
    const poolAddress = key?.split(":pool:")[1];
    expect(poolAddress).toBeTruthy();
    await row.getByRole("button").first().click();
    await expect.poll(() => new URL(page.url()).searchParams.get("pair")).toBe(poolAddress);
    await expect(page.getByTestId("context-inspector")).toHaveAttribute("data-market-key", key!);
    await expect(page.getByTestId("trade-dock")).toHaveCount(0);
    await page.getByTestId("context-inspector").getByRole("button", { name: /Check quote|Teklif kontrol et/, exact: true }).click();
    await expect(page.getByTestId("trade-dock")).toContainText("BLOB / USDC");
  });

  test("recovers from corrupt storage without a hydration or console error", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("mergen-terminal:market-board:v4", "{bad");
      localStorage.setItem("base-terminal-lite:pinned-pairs", "not-json");
    });
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/terminal?data=mock");
    await expect(page.getByTestId("market-matrix")).toBeVisible();
    await expect(page.getByTestId("market-result-count")).toContainText("24");
    expect(errors).toEqual([]);
  });

  test("keeps the selected pair when a refreshed snapshot omits it", async ({ page, request }) => {
    const snapshot = await (await request.get("/api/market-snapshot?data=mock")).json();
    await page.goto("/terminal?data=mock&pair=blob-usdc");
    const nextTimestamp = new Date(Date.now() + 10_000).toISOString();
    const omitted = {
      ...snapshot,
      version: "next",
      receivedAt: nextTimestamp,
      generatedAt: nextTimestamp,
      sourceUpdatedAt: nextTimestamp,
      allPairs: snapshot.allPairs.filter((pair: { id: string }) => pair.id !== "blob-usdc")
    };
    await page.route("**/api/market-snapshot?data=mock", (route) => route.fulfill({ json: omitted }));
    await page.getByTestId("refresh-terminal").click();
    await expect(page.getByTestId("selected-pair-title")).toHaveText("BLOB");
  });

  test("serves app assets and secondary pages without 500 responses", async ({ page, request }) => {
    const serverErrors: string[] = [];
    page.on("response", (response) => { if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`); });
    for (const route of ["/terminal?data=mock", "/dashboard?data=mock", "/swap?data=mock", "/status?data=mock", "/docs", "/settings"]) {
      await page.goto(route);
      await expect(page.getByTestId("terminal-topbar")).toBeVisible();
      if (route.startsWith("/dashboard") || route.startsWith("/swap")) await expect(page).toHaveURL(/\/terminal\?data=mock/);
    }
    expect((await request.get("/brand/mergen-mark.svg")).ok()).toBeTruthy();
    expect((await request.get("/favicon.ico")).ok()).toBeTruthy();
    expect(serverErrors).toEqual([]);
  });
});
