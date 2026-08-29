import { expect, test, type Page } from "@playwright/test";

const ACCOUNT_ONE = "0x1111111111111111111111111111111111111111";
const ACCOUNT_TWO = "0x2222222222222222222222222222222222222222";

test.describe("read-only EIP-1193 wallet connection", () => {
  test("shows a clear install state when no provider exists", async ({ page }) => {
    await page.goto("/?data=mock");
    await expect(page.getByText("Install a compatible wallet to connect.")).toBeVisible();
    await expect(page.getByTestId("review-swap-button")).toBeDisabled();
  });

  test("connects only after a click, reads Base account context and never sends a transaction", async ({ page }) => {
    await installWalletStub(page, { chainId: "0x2105" });
    await page.goto("/?data=mock");

    await expect(page.getByTestId("wallet-address")).toHaveCount(0);
    expect(await walletRequests(page)).not.toContain("eth_requestAccounts");

    await page.getByTestId("wallet-panel-connect").click();
    await expect(page.getByTestId("wallet-address")).toHaveText("0x1111...1111");
    await expect(page.getByTestId("swap-preview-panel")).toContainText("Base Mainnet");
    await expect(page.getByTestId("swap-preview-panel")).toContainText("1 ETH");

    const methods = await walletRequests(page);
    expect(methods).toContain("eth_requestAccounts");
    expect(methods).toContain("eth_getBalance");
    expect(methods).not.toContain("eth_sendTransaction");
    expect(methods.some((method) => /approval|swap/i.test(method))).toBeFalsy();
    await expect(page.getByTestId("review-swap-button")).toBeDisabled();
  });

  test("reports a rejected connection cleanly", async ({ page }) => {
    await installWalletStub(page, { chainId: "0x2105", rejectConnection: true });
    await page.goto("/?data=mock");
    await page.getByTestId("wallet-panel-connect").click();

    await expect(page.getByTestId("wallet-error")).toContainText("rejected");
    await expect(page.getByTestId("wallet-address")).toHaveCount(0);
  });

  test("shows the wrong network and switches to Base only on the manual action", async ({ page }) => {
    await installWalletStub(page, { chainId: "0x1" });
    await page.goto("/?data=mock");
    await page.getByTestId("wallet-panel-connect").click();

    await expect(page.getByTestId("wrong-network-warning")).toBeVisible();
    expect(await walletRequests(page)).not.toContain("wallet_switchEthereumChain");

    await page.getByRole("button", { name: "Switch to Base" }).click();
    await expect(page.getByTestId("swap-preview-panel")).toContainText("Base Mainnet");
    expect(await walletRequests(page)).toContain("wallet_switchEthereumChain");
  });

  test("handles account, chain and disconnect events without opening transaction capability", async ({ page }) => {
    await installWalletStub(page, { chainId: "0x2105" });
    await page.goto("/?data=mock");
    await page.getByTestId("wallet-panel-connect").click();

    await emitWalletEvent(page, "accountsChanged", [ACCOUNT_TWO]);
    await expect(page.getByTestId("wallet-address")).toHaveText("0x2222...2222");

    await emitWalletEvent(page, "chainChanged", "0x1");
    await expect(page.getByTestId("wrong-network-warning")).toBeVisible();

    await emitWalletEvent(page, "disconnect", { code: 4900 });
    await expect(page.getByTestId("wallet-address")).toHaveCount(0);
    await expect(page.getByTestId("wallet-panel-connect")).toBeVisible();
    expect(await walletRequests(page)).not.toContain("eth_sendTransaction");
  });
});

async function installWalletStub(
  page: Page,
  options: { chainId: string; rejectConnection?: boolean }
) {
  await page.addInitScript(
    ({ account, chainId, rejectConnection }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const requests: string[] = [];
      let activeChainId = chainId;
      let accounts: string[] = [];

      const emit = (event: string, value: unknown) => {
        for (const listener of listeners.get(event) ?? []) listener(value);
      };
      const provider = {
        request: async ({ method }: { method: string; params?: unknown }) => {
          requests.push(method);
          if (method === "eth_accounts") return accounts;
          if (method === "eth_requestAccounts") {
            if (rejectConnection) throw Object.assign(new Error("User rejected"), { code: 4001 });
            accounts = [account];
            return accounts;
          }
          if (method === "eth_chainId") return activeChainId;
          if (method === "eth_getBalance") return "0xde0b6b3a7640000";
          if (method === "wallet_switchEthereumChain") {
            activeChainId = "0x2105";
            emit("chainChanged", activeChainId);
            return null;
          }
          if (method === "wallet_addEthereumChain") return null;
          throw new Error(`Unexpected wallet method: ${method}`);
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          const current = listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
          current.add(listener);
          listeners.set(event, current);
        },
        removeListener: (event: string, listener: (...args: unknown[]) => void) => {
          listeners.get(event)?.delete(listener);
        }
      };
      const walletWindow = window as Window & {
        ethereum?: typeof provider;
        __walletHarness?: { requests: string[]; emit: typeof emit };
      };
      walletWindow.ethereum = provider;
      walletWindow.__walletHarness = { requests, emit };
    },
    { account: ACCOUNT_ONE, ...options }
  );
}

async function walletRequests(page: Page) {
  return page.evaluate(() => {
    const walletWindow = window as Window & { __walletHarness?: { requests: string[] } };
    return walletWindow.__walletHarness?.requests ?? [];
  });
}

async function emitWalletEvent(page: Page, event: string, value: unknown) {
  await page.evaluate(
    ({ eventName, eventValue }) => {
      const walletWindow = window as Window & {
        __walletHarness?: { emit: (event: string, value: unknown) => void };
      };
      walletWindow.__walletHarness?.emit(eventName, eventValue);
    },
    { eventName: event, eventValue: value }
  );
}
