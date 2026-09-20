"use client";

import { RefreshCw, WalletCards } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BASE_CHAIN_ID } from "@/lib/wallet";
import { useI18n } from "@/i18n/I18nProvider";
import { useWallet, type WalletTokenBalanceState } from "@/components/WalletContext";

export function WalletBalances({ autoRefresh = false }: { autoRefresh?: boolean }) {
  const wallet = useWallet();
  const refreshBalances = wallet.refreshBalances;
  const { t, locale } = useI18n();
  const autoRefreshKeyRef = useRef<string | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const connected = wallet.accountConnected && Boolean(wallet.address);
  const onBase = connected && wallet.chainId === BASE_CHAIN_ID;

  useEffect(() => {
    if (!autoRefresh || !onBase || !wallet.address) return;
    const key = `${wallet.selectedProviderId ?? "provider"}:${wallet.address.toLowerCase()}:${wallet.selectedToken?.address ?? "none"}`;
    if (autoRefreshKeyRef.current === key) return;
    autoRefreshKeyRef.current = key;
    void refreshBalances();
  }, [autoRefresh, onBase, refreshBalances, wallet.address, wallet.selectedProviderId, wallet.selectedToken?.address]);

  useEffect(() => {
    if (!onBase) return;
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [onBase]);

  if (!connected) {
    return <section className="rounded-card border border-border-subtle bg-surface-interactive p-4" data-testid="wallet-balances-disconnected"><WalletCards size={18} className="text-content-secondary" /><p className="mt-2 text-label font-semibold text-content-primary">{t("wallet.balancesTitle")}</p><p className="mt-1 text-meta leading-5 text-content-secondary">{t("wallet.balancesConnect")}</p><button type="button" onClick={wallet.openPicker} className="cmi-button cmi-button-primary mt-3 min-h-control-touch w-full">{t("wallet.connect")}</button></section>;
  }

  const updatedAt = latestTimestamp(wallet.balanceUpdatedAt, ...Object.values(wallet.tokenBalances).map((balance) => balance.updatedAt));
  return <section className="rounded-card border border-border-subtle bg-surface-interactive/70 p-3" data-testid="wallet-balance-grid" data-wallet-balance-network={onBase ? "base" : "wrong_network"}>
    <header className="flex items-start justify-between gap-3"><div><h3 className="text-label font-semibold text-content-primary">{t("wallet.balancesTitle")}</h3><p className="mt-1 text-meta leading-5 text-content-secondary">{t("wallet.balancesScope")}</p></div><button type="button" disabled={!onBase || wallet.balanceStatus === "balance_loading" || Object.values(wallet.tokenBalances).some((balance) => balance.status === "loading")} onClick={() => void wallet.refreshBalances()} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-control bg-surface-panel px-3 text-meta font-semibold text-content-primary disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw size={13} />{t("wallet.refreshBalances")}</button></header>
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      <BalanceFact label="ETH" value={formatNativeBalance(wallet, onBase, now, t)} testId="wallet-balance-eth" />
      {wallet.trackedBalanceTokens.map((token) => <BalanceFact key={token.address} label={token.symbol} value={formatTokenBalance(wallet.tokenBalances[token.address], token.symbol, onBase, now, t)} testId={token.symbol === "WETH" ? "wallet-balance-weth" : token.symbol === "USDC" ? "wallet-balance-usdc" : "wallet-balance-selected"} />)}
    </dl>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle/60 pt-3 text-meta"><span className="text-content-secondary">{t("wallet.portfolioTotal")}</span><strong className="text-right font-mono text-content-primary">{t("wallet.portfolioTotalUnavailable")}</strong></div>
    <p className="mt-2 text-meta leading-5 text-content-secondary">{t("wallet.portfolioTotalScope")}</p>
    <p className="mt-2 font-mono text-meta text-content-secondary" data-testid="wallet-balances-updated">{t("wallet.lastUpdated")}: {updatedAt ? new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(updatedAt)) : t("common.unavailable")}</p>
  </section>;
}

function BalanceFact({ label, value, testId }: { label: string; value: string; testId: string }) {
  return <div className="min-w-0 rounded-control bg-surface-panel p-3"><dt className="truncate text-meta text-content-secondary">{label}</dt><dd className="mt-1 break-words font-mono text-data text-content-primary" data-testid={testId}>{value}</dd></div>;
}

function formatNativeBalance(wallet: ReturnType<typeof useWallet>, onBase: boolean, now: number, t: ReturnType<typeof useI18n>["t"]) {
  if (!onBase) return t("wallet.balanceUnavailableWrongNetwork");
  if (wallet.balanceStatus === "balance_loading") return t("wallet.balanceLoading");
  if (wallet.balanceStatus === "balance_unavailable") return t("wallet.balanceUnavailable");
  if (wallet.balanceStatus !== "balance_ready" || wallet.balanceEth === undefined) return t("wallet.balanceNotLoaded");
  const value = `${wallet.balanceEth} ETH`;
  return isStale(wallet.balanceUpdatedAt, now) ? t("wallet.balanceStale", { value }) : value;
}

function formatTokenBalance(balance: WalletTokenBalanceState | undefined, symbol: string, onBase: boolean, now: number, t: ReturnType<typeof useI18n>["t"]) {
  if (!onBase) return t("wallet.balanceUnavailableWrongNetwork");
  if (!balance || balance.status === "idle") return t("wallet.balanceNotLoaded");
  if (balance.status === "loading") return t("wallet.balanceLoading");
  if (balance.status === "metadata_unavailable") return t("wallet.balanceMetadataUnavailable");
  if (balance.status === "unavailable" || balance.value === undefined) return t("wallet.balanceUnavailable");
  const value = `${balance.value} ${symbol}`;
  return balance.status === "stale" || isStale(balance.updatedAt, now) ? t("wallet.balanceStale", { value }) : value;
}

function isStale(updatedAt: string | undefined, now: number) {
  const timestamp = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  return Number.isFinite(timestamp) && now - timestamp > 60_000;
}

function latestTimestamp(...values: Array<string | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1);
}
