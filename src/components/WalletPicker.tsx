"use client";

import { ChevronDown, ExternalLink, ShieldCheck, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useWallet } from "@/components/WalletContext";
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const { pickerOpen, closePicker } = wallet;
  const installed = useMemo(() => wallet.providers.filter((provider) => provider.compatibility !== "unverified"), [wallet.providers]);
  const otherInstalled = useMemo(() => wallet.providers.filter((provider) => provider.compatibility === "unverified"), [wallet.providers]);

  useEffect(() => {
    if (!pickerOpen) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? []);
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePicker();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [closePicker, pickerOpen]);

  if (!pickerOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-3 backdrop-blur-sm" data-testid="wallet-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) wallet.closePicker(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("wallet.pickerTitle")} data-testid="wallet-picker" className="max-h-[min(720px,92vh)] w-full max-w-[520px] overflow-y-auto rounded-2xl border border-base-line bg-base-panel p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-base-mint">Mergen Wallet</p>
            <h2 className="mt-1 text-[18px] font-semibold text-base-text">{t("wallet.pickerTitle")}</h2>
            <p className="mt-1 max-w-[430px] text-[12px] leading-5 text-base-muted">{t("wallet.pickerBody")}</p>
          </div>
          <button type="button" onClick={wallet.closePicker} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-base-elevated text-base-muted hover:text-base-text" aria-label={t("wallet.closePicker")}><X size={15} /></button>
        </div>

        <ProviderGroup title={t("wallet.installed")} providers={installed} onConnect={wallet.connectProvider} />
        {otherInstalled.length > 0 ? <ProviderGroup title={t("wallet.otherInstalled")} providers={otherInstalled} onConnect={wallet.connectProvider} unverified /> : null}
        {wallet.providers.length === 0 ? <div className="mt-4 rounded-xl bg-base-elevated/70 p-4 text-center text-[12px] text-base-muted"><WalletCards className="mx-auto mb-2 text-base-mint" size={20} />{t("wallet.noneInstalled")}</div> : null}

        {wallet.errorCode ? <p role="alert" data-testid="wallet-picker-error" className="mt-3 rounded-lg bg-base-amber/10 px-3 py-2 text-[11px] text-base-amber">{walletError(t, wallet.errorCode)} {wallet.errorCode === "unreachable" || wallet.errorCode === "unsupported-base" ? t("wallet.error.tryAnother") : ""}</p> : null}

        <section className="mt-4 border-t border-base-line/70 pt-3">
          <button type="button" onClick={() => setGetWalletOpen((open) => !open)} className="flex min-h-10 w-full items-center justify-between rounded-lg px-2 text-left text-[12px] font-semibold text-base-text" aria-expanded={getWalletOpen} data-testid="get-wallet-toggle">
            <span><span className="block">{t("wallet.getWallet")}</span><span className="mt-0.5 block text-[10px] font-normal text-base-muted">{t("wallet.getWalletBody")}</span></span>
            <ChevronDown size={15} className={cx("transition-transform", getWalletOpen && "rotate-180")} />
          </button>
          {getWalletOpen ? <div className="mt-2 grid gap-2 sm:grid-cols-3">{OFFICIAL_WALLETS.map((item) => <button key={item.name} type="button" data-testid={`install-${item.name.toLowerCase().replaceAll(" ", "-")}`} onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-base-line bg-base-elevated px-2 text-[11px] font-semibold text-base-text hover:border-base-mint"><ExternalLink size={12} />{t("wallet.install", { wallet: item.name })}</button>)}</div> : null}
        </section>
      </div>
    </div>
  );
}

function ProviderGroup({ title, providers, onConnect, unverified = false }: { title: string; providers: WalletProviderOption[]; onConnect: (id: string) => Promise<void>; unverified?: boolean }) {
  const { t } = useI18n();
  const { status } = useWallet();
  if (providers.length === 0) return null;
  return <section className="mt-4"><h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-base-muted">{title}</h3><div className="space-y-2">{providers.map((provider) => {
    const verified = provider.compatibility === "verified";
    return <button key={provider.id} type="button" onClick={() => void onConnect(provider.id)} disabled={status === "connecting"} data-testid={`wallet-provider-${provider.id}`} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-base-line bg-base-elevated/70 px-3 text-left outline-none hover:border-base-mint focus-visible:ring-2 focus-visible:ring-base-mint/50 disabled:cursor-wait disabled:opacity-60">{provider.icon ? <Image unoptimized src={provider.icon} alt="" width={32} height={32} className="h-8 w-8 rounded-lg" /> : <span className="grid h-8 w-8 place-items-center rounded-lg bg-base-panel text-base-mint"><WalletCards size={16} /></span>}<span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-base-text">{provider.name}</span><span className={cx("mt-0.5 block text-[10px]", unverified || !verified ? "text-base-amber" : "text-base-muted")}>{verified ? t("wallet.baseVerified") : t("wallet.baseUnverified")}</span></span>{verified ? <ShieldCheck size={15} className="text-base-mint" /> : null}</button>;
  })}</div></section>;
}

function walletError(t: ReturnType<typeof useI18n>["t"], code: NonNullable<ReturnType<typeof useWallet>["errorCode"]>) {
  if (code === "cancelled") return t("wallet.error.cancelled");
  if (code === "pending") return t("wallet.error.pending");
  if (code === "unsupported-base") return t("wallet.error.unsupportedBase");
  return t("wallet.error.unreachable");
}
