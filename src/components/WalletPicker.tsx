"use client";

import Image from "next/image";
import { Check, ChevronDown, Copy, ExternalLink, LogOut, ShieldCheck, WalletCards, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useWallet } from "@/components/WalletContext";
import { WalletBalances } from "@/components/WalletBalances";
import { useI18n } from "@/i18n/I18nProvider";
import { cx } from "@/lib/format";
import type { WalletProviderOption } from "@/lib/wallet";

const OFFICIAL_WALLETS = [
  { name: "MetaMask", url: "https://metamask.io/download" },
  { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet/downloads" },
  { name: "Rabby", url: "https://rabby.io/" }
] as const;

export function WalletPicker() {
  const wallet = useWallet();
  const { t } = useI18n();
  const [getWalletOpen, setGetWalletOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { pickerOpen } = wallet;
  const installed = useMemo(() => wallet.providers.filter((provider) => provider.compatibility === "verified"), [wallet.providers]);
  const otherInstalled = useMemo(() => wallet.providers.filter((provider) => provider.compatibility !== "verified"), [wallet.providers]);

  if (!pickerOpen) return null;
  const connected = wallet.accountConnected && Boolean(wallet.address);
  const reconnectable = Boolean(wallet.selectedProviderId && ["reconnect_required", "locked_or_no_accounts", "disconnected_by_user", "provider_error"].includes(wallet.status));

  return (
    <div className="fixed inset-0 z-layer-modal grid place-items-center bg-surface-scrim/75 p-3 backdrop-blur-sm" data-testid="wallet-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) wallet.closePicker(); }}>
      <div role="dialog" aria-modal="true" aria-label={t(connected ? "wallet.detailsTitle" : "wallet.pickerTitle")} data-testid="wallet-picker" data-wallet-status={wallet.status} data-balance-status={wallet.balanceStatus} data-overlay-root="wallet_picker" className="max-h-[min(760px,92vh)] w-full max-w-[540px] overflow-y-auto rounded-overlay border border-border-subtle bg-surface-panel p-4 shadow-overlay">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">Mergen Wallet</p>
            <h2 className="mt-1 text-title-sm font-semibold text-content-primary">{t(connected ? "wallet.detailsTitle" : "wallet.pickerTitle")}</h2>
            <p className="mt-1 max-w-[440px] text-label leading-5 text-content-secondary">{t(connected ? "wallet.publicAddressOnly" : "wallet.pickerBodySeparated")}</p>
          </div>
          <button type="button" onClick={wallet.closePicker} className="grid h-control-touch w-control-touch shrink-0 place-items-center rounded-pill bg-surface-interactive text-content-secondary hover:text-content-primary" aria-label={t("wallet.closePicker")} data-overlay-autofocus><X size={15} /></button>
        </div>

        {connected && wallet.address ? renderConnectedWalletDetails(copied, async () => { try { await navigator.clipboard.writeText(wallet.address!); setCopied(true); window.setTimeout(() => setCopied(false), 1_500); } catch { setCopied(false); } }) : <>
          {reconnectable && wallet.selectedProviderId ? <section className="mt-4 rounded-panel border border-border-subtle bg-surface-interactive/70 p-3" data-testid="wallet-reconnect-panel"><div className="flex items-center gap-3"><ProviderIcon provider={wallet.selectedProvider} /><span className="min-w-0 flex-1"><strong className="block truncate text-label text-content-primary">{wallet.selectedProvider?.name ?? t("wallet.reconnect")}</strong><span className="mt-1 block text-meta text-content-secondary">{t(wallet.status === "locked_or_no_accounts" ? "wallet.lockedBody" : "wallet.reconnectBody")}</span></span></div><button type="button" onClick={() => void wallet.connectProvider(wallet.selectedProviderId!)} disabled={wallet.status === "connecting"} className="mt-3 min-h-11 w-full rounded-control bg-brand-action px-3 text-label font-bold text-content-on-accent disabled:cursor-wait disabled:opacity-60" data-testid="wallet-reconnect-button">{wallet.status === "connecting" ? t("wallet.connecting") : t("wallet.reconnect")}</button></section> : null}
          <ProviderGroup title={t("wallet.installed")} providers={installed} onConnect={wallet.connectProvider} />
          {otherInstalled.length > 0 ? <ProviderGroup title={t("wallet.otherInstalled")} providers={otherInstalled} onConnect={wallet.connectProvider} unverified /> : null}
          {wallet.providers.length === 0 ? <div className="mt-4 rounded-panel bg-surface-interactive/70 p-4 text-center text-label text-content-secondary"><WalletCards className="mx-auto mb-2 text-content-secondary" size={20} />{t("wallet.noneInstalled")}</div> : null}

          {wallet.errorCode ? <p role="alert" data-testid="wallet-picker-error" className="mt-3 rounded-card bg-freshness-delayed/10 px-3 py-2 text-meta text-freshness-delayed">{walletError(t, wallet.errorCode)} {wallet.errorCode === "unreachable" || wallet.errorCode === "unsupported-base" ? t("wallet.error.tryAnother") : ""}</p> : null}

          <section className="mt-4 border-t border-border-subtle/70 pt-3">
            <button type="button" onClick={() => setGetWalletOpen((open) => !open)} className="flex min-h-10 w-full items-center justify-between rounded-card px-2 text-left text-label font-semibold text-content-primary" aria-expanded={getWalletOpen} data-testid="get-wallet-toggle">
              <span><span className="block">{t("wallet.getWallet")}</span><span className="mt-1 block text-meta font-normal text-content-secondary">{t("wallet.getWalletBody")}</span></span>
              <ChevronDown size={15} className={cx("transition-transform", getWalletOpen && "rotate-180")} />
            </button>
            {getWalletOpen ? <div className="mt-2 grid gap-2 sm:grid-cols-3">{OFFICIAL_WALLETS.map((item) => <button key={item.name} type="button" data-testid={`install-${item.name.toLowerCase().replaceAll(" ", "-")}`} onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-card border border-border-subtle bg-surface-interactive px-2 text-meta font-semibold text-content-primary hover:border-border-strong"><ExternalLink size={12} />{t("wallet.install", { wallet: item.name })}</button>)}</div> : null}
          </section>
        </>}
      </div>
    </div>
  );

  function renderConnectedWalletDetails(addressCopied: boolean, onCopy: () => Promise<void>) {
    return <section className="mt-4 space-y-3" data-testid="wallet-details">
      <div className="rounded-panel border border-border-subtle bg-surface-interactive/70 p-3">
        <div className="flex items-center gap-3"><ProviderIcon provider={wallet.selectedProvider} /><span className="min-w-0 flex-1"><strong className="block truncate text-label text-content-primary">{wallet.selectedProvider?.name ?? t("wallet.connected")}</strong><span className="mt-1 block text-meta text-operation-success">{t(wallet.connectionOrigin === "previously_authorized" ? "wallet.previouslyAuthorized" : "wallet.explicitConnection")}</span></span><ShieldCheck size={16} className="text-trust-verified" /></div>
        {wallet.connectionOrigin === "previously_authorized" ? <p className="mt-3 rounded-control bg-network-base/10 p-2 text-meta leading-5 text-content-secondary" data-testid="wallet-connection-origin">{t("wallet.previouslyAuthorizedBody")}</p> : null}
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        <WalletFact label={t("wallet.connectionStatus")} value={t(wallet.wrongNetwork ? "wallet.statusWrongNetwork" : "wallet.statusConnected")} />
        <WalletFact label={t("wallet.provider")} value={wallet.selectedProvider?.name ?? t("common.unknown")} />
        <WalletFact label={t("wallet.network")} value={wallet.wrongNetwork ? t("wallet.chain", { id: wallet.chainId ?? "—" }) : "Base Mainnet · 8453"} />
      </dl>
      <WalletBalances autoRefresh />
      <div className="rounded-control bg-surface-interactive p-3"><span className="text-meta text-content-secondary">{t("wallet.address")}</span><div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 break-all font-mono text-meta text-content-primary" data-testid="wallet-exact-address">{wallet.address}</code><button type="button" onClick={() => void onCopy()} className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-surface-panel text-content-secondary" aria-label={t("wallet.copyAddress")}>{addressCopied ? <Check size={14} className="text-operation-success" /> : <Copy size={14} />}</button></div></div>
      {wallet.wrongNetwork ? <div className="rounded-control bg-freshness-delayed/10 p-3 text-label text-freshness-delayed"><p>{t("wallet.wrongNetwork")}</p><button type="button" onClick={() => void wallet.switchToBase()} className="mt-2 min-h-10 w-full rounded-control bg-freshness-delayed/15 px-3 font-bold">{t("wallet.switchBase")}</button></div> : null}
      <a href={`https://basescan.org/address/${wallet.address}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-surface-interactive px-3 text-label font-semibold text-content-primary"><ExternalLink size={14} />{t("wallet.openBaseScan")}</a>
      <button type="button" onClick={wallet.disconnect} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-border-subtle text-label font-semibold text-content-secondary"><LogOut size={14} />{t("wallet.disconnectTerminal")}</button>
    </section>;
  }
}

function ProviderGroup({ title, providers, onConnect, unverified = false }: { title: string; providers: WalletProviderOption[]; onConnect: (id: string) => Promise<void>; unverified?: boolean }) {
  const { t } = useI18n();
  const { status } = useWallet();
  if (providers.length === 0) return null;
  return <section className="mt-4"><h3 className="mb-2 text-meta font-bold uppercase tracking-eyebrow text-content-secondary">{title}</h3><div className="space-y-2">{providers.map((provider) => {
    const verified = provider.compatibility === "verified";
    const disabled = status === "connecting" || unverified;
    return <button key={provider.id} type="button" onClick={() => void onConnect(provider.id)} disabled={disabled} data-testid={`wallet-provider-${provider.id}`} className="flex min-h-14 w-full items-center gap-3 rounded-panel border border-border-subtle bg-surface-interactive/70 px-3 text-left outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60"><ProviderIcon provider={provider} /><span className="min-w-0 flex-1"><span className="block truncate text-data font-semibold text-content-primary">{provider.name}</span><span className={cx("mt-1 block text-meta", unverified || !verified ? "text-freshness-delayed" : "text-content-secondary")}>{verified ? t("wallet.baseVerified") : t("wallet.baseUnverified")}</span></span>{verified ? <ShieldCheck size={15} className="text-trust-verified" /> : null}</button>;
  })}</div></section>;
}

function ProviderIcon({ provider }: { provider: WalletProviderOption | undefined }) {
  return provider?.icon ? <Image unoptimized src={provider.icon} alt="" width={32} height={32} className="h-8 w-8 rounded-card" /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-card bg-surface-panel text-content-secondary"><WalletCards size={16} /></span>;
}

function WalletFact({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return <div className="rounded-control bg-surface-interactive p-3"><dt className="text-meta text-content-secondary">{label}</dt><dd className="mt-1 break-words font-mono text-meta text-content-primary" data-testid={testId}>{value}</dd></div>;
}

function walletError(t: ReturnType<typeof useI18n>["t"], code: NonNullable<ReturnType<typeof useWallet>["errorCode"]>) {
  if (code === "cancelled") return t("wallet.error.cancelled");
  if (code === "pending") return t("wallet.error.pending");
  if (code === "unsupported-base") return t("wallet.error.unsupportedBase");
  return t("wallet.error.unreachable");
}
