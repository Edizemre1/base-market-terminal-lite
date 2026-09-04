import type { Page } from "@playwright/test";

export async function installVerifiedWalletStub(page: Page, options: { chainId?: string; rejectConnection?: boolean; allowanceRaw?: string } = {}) {
  await page.addInitScript(({ account, initialChain, reject, initialAllowance }) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const requests: Array<{ method: string; params?: unknown }> = [];
    let chainId = initialChain;
    let accounts: string[] = [];
    let allowance = BigInt(initialAllowance);
    let transactionCount = 0;
    const emit = (event: string, value: unknown) => { for (const listener of listeners.get(event) ?? []) listener(value); };
    const provider = {
      isMetaMask: true,
      request: async ({ method, params }: { method: string; params?: unknown }) => {
        requests.push({ method, params });
        if (method === "eth_accounts") return accounts;
        if (method === "eth_requestAccounts") { if (reject) throw Object.assign(new Error("Rejected"), { code: 4001 }); accounts = [account]; emit("accountsChanged", accounts); return accounts; }
        if (method === "eth_chainId") return chainId;
        if (method === "eth_getBalance") return "0xde0b6b3a7640000";
        if (method === "wallet_switchEthereumChain") { chainId = "0x2105"; emit("chainChanged", chainId); return null; }
        if (method === "eth_call") {
          const call = Array.isArray(params) ? params[0] as { data?: string } : undefined;
          if (call?.data?.startsWith("0xdd62ed3e")) return `0x${allowance.toString(16)}`;
          if (call?.data?.startsWith("0x70a08231")) return "0xde0b6b3a7640000";
          return "0x";
        }
        if (method === "eth_estimateGas") return "0x186a0";
        if (method === "eth_sendTransaction") {
          transactionCount += 1;
          const tx = Array.isArray(params) ? params[0] as { data?: string } : undefined;
          if (tx?.data?.startsWith("0x095ea7b3")) allowance = BigInt(`0x${tx.data.slice(-64)}`);
          return `0x${transactionCount.toString(16).padStart(64, "0")}`;
        }
        if (method === "eth_getTransactionReceipt") return { status: "0x1" };
        throw new Error(`Unexpected wallet method: ${method}`);
      },
      on: (event: string, listener: (...args: unknown[]) => void) => { const current = listeners.get(event) ?? new Set(); current.add(listener); listeners.set(event, current); },
      removeListener: (event: string, listener: (...args: unknown[]) => void) => listeners.get(event)?.delete(listener)
    };
    const disconnect = () => { accounts = []; emit("accountsChanged", accounts); };
    Object.assign(window, { ethereum: provider, __walletHarness: { requests, emit, disconnect } });
  }, { account: "0x1111111111111111111111111111111111111111", initialChain: options.chainId ?? "0x2105", reject: options.rejectConnection ?? false, initialAllowance: options.allowanceRaw ?? "0" });
}
