import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("wallet session truth requires explicit reconnect and separates balance state", () => {
  const controller = read("src/lib/wallet.ts");
  const context = read("src/components/WalletContext.tsx");
  const preferredProviderBranch = controller.match(/if \(!this\.selectedProvider && option\.id === this\.preferredProviderId[\s\S]*?\n    \}/u)?.[0] ?? "";

  for (const state of ["disconnected", "provider_available", "reconnect_required", "connecting", "connected", "locked_or_no_accounts", "wrong_network", "provider_error", "disconnected_by_user"]) assert.match(controller, new RegExp(`"${state}"`));
  for (const state of ["balance_loading", "balance_ready", "balance_unavailable"]) assert.match(controller, new RegExp(`"${state}"`));
  assert.match(preferredProviderBranch, /status: "reconnect_required"/u);
  assert.doesNotMatch(preferredProviderBranch, /queueReconcile|eth_accounts|eth_requestAccounts/u);
  assert.match(controller, /existingAddress = readFirstAddress\(await provider\.request\(\{ method: "eth_accounts" \}\)\)/u);
  assert.match(controller, /provider\.request\(\{ method: "eth_requestAccounts" \}\)/u);
  assert.match(controller, /existingAddress\?\.toLowerCase\(\) === address\.toLowerCase\(\) \? "previously_authorized"/u);
  assert.match(context, /LEGACY_WALLET_SESSION_STORAGE_KEYS/u);
  assert.match(context, /parsed\.compatibility !== "verified"/u);
  assert.doesNotMatch(context, /safeSetStorageItem\([^\n]*(address|balance|connected)/iu);
});

test("wallet details expose origin, exact balances and app-local disconnect", () => {
  const picker = read("src/components/WalletPicker.tsx");
  const button = read("src/components/WalletButton.tsx");
  for (const marker of ["wallet-connection-origin", "wallet-exact-address", "wallet-native-balance", "wallet-token-balance", "wallet.disconnectTerminal", "basescan.org/address", "wallet.refreshBalances"]) assert.match(picker, new RegExp(marker.replace(/[.]/g, "\\."), "u"));
  assert.match(picker, /buildBalanceOfData/u);
  assert.match(picker, /BigInt\(result\)\.toString\(\)/u);
  assert.match(button, /data-connection-origin/u);
  assert.match(button, /selectedProvider\?\.name/u);
});

test("Trade remains globally visible and defaults to exact Base USDC to WETH", () => {
  const terminal = read("src/components/BaseTerminal.tsx");
  const dock = read("src/components/base-terminal/TradeDock.tsx");
  const surface = read("src/components/base-terminal/TerminalMarketSurface.tsx");
  const inspector = read("src/components/base-terminal/ContextInspector.tsx");

  assert.match(terminal, /data-testid="global-trade-button"/u);
  assert.match(terminal, /BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"/u);
  assert.match(terminal, /BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006"/u);
  assert.match(terminal, /return buildDefaultTradeContext\(selectedPairWithLiveChart\)/u);
  assert.match(terminal.match(/if \(!selectedPairWithLiveChart\)[\s\S]*?const inspectorOpen/u)?.[0] ?? "", /GlobalTradeEntry pair=\{defaultTradePair\}/u);
  assert.doesNotMatch(terminal.match(/const openTrade[\s\S]*?\n  \}, \[handleSelectPairById/u)?.[0] ?? "", /rankingEligibility/u);
  assert.match(dock, /type SpendTokenKey = "USDC" \| "WETH"/u);
  assert.match(dock, /useState<SpendTokenKey>\("USDC"\)/u);
  assert.match(dock, /data-reason-code=\{quoteFailureCode\}/u);
  assert.match(surface, /hasExactTradeTarget\(pair, opportunity\)/u);
  assert.match(inspector, /data-testid="inspector-trade-cta"/u);
  assert.match(inspector, /data-testid="inspector-technical-details"/u);
});

test("token-first presentation is shared while raw pairs stay in technical pool surfaces", () => {
  const presentation = read("src/lib/base-terminal/marketPresentation.ts");
  const surface = read("src/components/base-terminal/TerminalMarketSurface.tsx");
  const wall = read("src/components/base-terminal/LiveMarketWall.tsx");
  const inspector = read("src/components/base-terminal/ContextInspector.tsx");

  assert.match(presentation, /direct_usdc/u);
  assert.match(presentation, /via_quote/u);
  assert.match(presentation, /unpriced/u);
  assert.match(surface, /getMarketPresentation/u);
  assert.match(wall, /getMarketPresentation/u);
  assert.match(inspector, /terminalV3\.rawPair/u);
  assert.match(inspector, /pool\.pair/u);
});
