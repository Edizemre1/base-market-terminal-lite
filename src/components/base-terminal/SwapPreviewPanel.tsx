"use client";

import { AlertTriangle, ChevronDown, ChevronUp, LockKeyhole, LogOut, WalletCards } from "lucide-react";
import { useState } from "react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { TokenAvatar } from "@/components/TokenIdentity";
import { useWallet } from "@/components/WalletContext";
import { cx } from "@/lib/format";
import { BASE_CHAIN_ID, shortenWalletAddress } from "@/lib/wallet";
import type { BasePair } from "@/types/baseTerminal";
import { useI18n } from "@/i18n/I18nProvider";
import { parseLocaleDecimalInput } from "@/lib/marketMath";
import { getMarketInvariantAttributes } from "@/lib/base-terminal/marketModel";

export function SwapTicket({
  pair,
  marketDataMode,
  amount,
  onAmountChange
}: {
  pair: BasePair;
  marketDataMode: MarketTerminalSnapshot["mode"];
  amount: string;
  onAmountChange: (value: string) => void;
}) {
  const wallet = useWallet();
  const { t } = useI18n();
  const walletAddress = wallet.address;
  const connected = wallet.status === "connected" && Boolean(walletAddress);
  const amountNumber = parseLocaleDecimalInput(amount);
  const amountValid = typeof amountNumber === "number" && amountNumber > 0;
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      {...getMarketInvariantAttributes(pair)}
      className="pulse-surface min-w-0 overflow-hidden rounded-xl"
      data-testid="swap-preview-panel"
      data-market-mode={marketDataMode}
    >
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-base-line/60 px-3 py-2.5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-base-mint">
            {t("wallet.actionDock")}
          </p>
          <h2 className="mt-0.5 text-[13px] font-semibold text-base-text">{pair.pair}</h2>
        </div>
        <button type="button" onClick={() => setExpanded((current) => !current)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-base-elevated px-2.5 font-mono text-[10px] text-base-muted" aria-expanded={expanded}>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? t("wallet.collapse") : t("wallet.details")}
        </button>
      </div>

      <div className="space-y-3 p-3">
        <section className="rounded-sm bg-base-elevated p-3" aria-label={t("wallet.status")}>
          {connected && walletAddress ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium text-base-muted">{t("wallet.connected")}</p>
                  <p className="mt-1 truncate font-mono text-[14px] font-semibold text-base-text" data-testid="wallet-address">
                    {shortenWalletAddress(walletAddress)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={wallet.disconnect}
                  className="inline-flex min-h-8 items-center gap-1 rounded-sm px-2 text-[10px] text-base-muted outline-none hover:bg-base-panel hover:text-base-text focus-visible:ring-2 focus-visible:ring-base-mint/40"
                  aria-label={t("wallet.disconnectAria")}
                >
                  <LogOut size={12} aria-hidden="true" />
                  {t("wallet.disconnect")}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <WalletMetric
                  label={t("wallet.network")}
                  value={wallet.chainId === BASE_CHAIN_ID ? t("header.baseMainnet") : t("wallet.chain", { id: wallet.chainId ?? t("common.unknown") })}
                  tone={wallet.wrongNetwork ? "amber" : "mint"}
                />
                <WalletMetric label={t("wallet.balance")} value={!wallet.wrongNetwork && wallet.balanceEth !== undefined ? `${wallet.balanceEth} ETH` : t("common.unavailable")} />
              </div>
              {wallet.wrongNetwork ? (
                <div className="mt-3 rounded-sm border border-base-amber/35 bg-base-amber/10 p-2.5 text-[11px] text-base-amber" data-testid="wrong-network-warning">
                  <p className="font-semibold">{t("wallet.wrongNetwork")}</p>
                  <button
                    type="button"
                    onClick={() => void wallet.switchToBase()}
                    className="mt-2 min-h-9 rounded-sm border border-base-amber/45 bg-base-panel px-3 font-semibold outline-none hover:text-base-text focus-visible:ring-2 focus-visible:ring-base-amber/40"
                  >
                    {t("wallet.switchBase")}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-center">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-base-panel text-base-mint">
                <WalletCards size={19} aria-hidden="true" />
              </span>
              <p className="mt-2 text-[14px] font-semibold text-base-text">{t("wallet.contextTitle")}</p>
              <p className="mt-1 text-[11px] leading-5 text-base-muted">
                {t("wallet.contextBody")}
              </p>
              <button
                type="button"
                data-testid="wallet-panel-connect"
                onClick={wallet.openPicker}
                disabled={wallet.status === "connecting"}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-sm border border-base-mint bg-base-mint px-3 text-[12px] font-semibold text-white outline-none hover:bg-base-mint/90 focus-visible:ring-2 focus-visible:ring-base-mint/50 disabled:cursor-wait disabled:opacity-70"
              >
                <WalletCards size={14} aria-hidden="true" />
                {wallet.status === "connecting" ? t("wallet.waiting") : t("wallet.connect")}
              </button>
              {wallet.status === "unavailable" ? (
                <p className="mt-2 text-[11px] text-base-amber">{t("wallet.noProvider")}</p>
              ) : null}
            </div>
          )}
          {wallet.error ? (
            <p className="mt-3 rounded-sm border border-base-amber/35 bg-base-amber/10 px-2.5 py-2 text-[11px] text-base-amber" role="alert" data-testid="wallet-error">
              {wallet.errorCode ? walletErrorText(wallet.errorCode, t) : t("wallet.error.unreachable")}
            </p>
          ) : null}
        </section>

        {expanded ? <section aria-label={t("wallet.quoteContext")} className="space-y-2">
          <TokenBox
            label={t("wallet.from")}
            token={pair.quoteToken}
            logoUrl={pair.quoteTokenLogoUrl}
            sublabel={t("wallet.localInput")}
            value={amount}
            onValueChange={onAmountChange}
          />
          <TokenBox
            label={t("wallet.toIndicative")}
            token={pair.baseToken}
            logoUrl={pair.tokenLogoUrl}
            sublabel={t("wallet.noQuoteProvider")}
            value={t("common.unavailable")}
            readOnly
          />
        </section> : null}

        {expanded && !amountValid ? (
          <p className="rounded-sm border border-base-amber/35 bg-base-amber/10 px-2.5 py-2 text-[11px] text-base-amber">
            {t("wallet.amountError")}
          </p>
        ) : null}

        {expanded ? <section className="rounded-lg bg-base-elevated/60 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-base-amber" aria-hidden="true" />
            <div>
              <p className="text-[12px] font-semibold text-base-text">{t("wallet.quoteUnavailable")}</p>
              <p className="mt-1 text-[11px] leading-5 text-base-muted">
                {t("wallet.quoteUnavailableBody")}
              </p>
            </div>
          </div>
        </section> : (
          <div className="rounded-lg bg-base-elevated/60 px-3 py-2.5 text-[11px] leading-5 text-base-muted">
            <p className="font-semibold text-base-text">{t("wallet.previewMissing")}</p>
            <p>{t("wallet.previewMissingBody")}</p>
          </div>
        )}

        <div className="rounded-lg bg-base-mint/5 px-3 py-2.5 text-[11px] leading-5 text-base-muted">
          <p className="font-semibold text-base-text">{t("wallet.readOnly")}</p>
          <p>{t("wallet.readOnlyBody")}</p>
        </div>

        <button
          type="button"
          disabled
          data-testid="review-swap-button"
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-sm border border-base-line bg-base-raised px-3 text-[12px] font-semibold text-base-muted"
        >
          <LockKeyhole size={14} aria-hidden="true" />
          {t("wallet.transactionsDisabled")}
        </button>
      </div>
    </aside>
  );
}

function walletErrorText(code: "cancelled" | "pending" | "unreachable" | "unsupported-base", t: ReturnType<typeof useI18n>["t"]) {
  if (code === "cancelled") return t("wallet.error.cancelled");
  if (code === "pending") return t("wallet.error.pending");
  if (code === "unsupported-base") return t("wallet.error.unsupportedBase");
  return t("wallet.error.unreachable");
}

function TokenBox({
  label,
  token,
  logoUrl,
  sublabel,
  value,
  onValueChange,
  readOnly = false
}: {
  label: string;
  token: string;
  logoUrl?: string;
  sublabel: string;
  value: string;
  onValueChange?: (value: string) => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium text-base-muted">{label}</span>
      <span className="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] overflow-hidden rounded-sm border border-base-line bg-base-panel">
        <span className="flex min-w-0 items-center gap-2 bg-base-elevated px-2 py-2">
          <TokenAvatar symbol={token} logoUrl={logoUrl} size="md" />
          <span className="min-w-0">
            <span className="block truncate font-mono text-[13px] font-semibold text-base-text">{token}</span>
            <span className="block truncate text-[9px] text-base-muted">{sublabel}</span>
          </span>
        </span>
        <input
          aria-label={t("wallet.amountLabel", { label })}
          value={value}
          readOnly={readOnly}
          inputMode="decimal"
          onChange={(event) => onValueChange?.(event.target.value)}
          className="h-14 min-w-0 bg-base-panel px-3 text-right font-mono text-[16px] text-base-text outline-none focus:bg-base-elevated"
        />
      </span>
    </label>
  );
}

function WalletMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "mint" | "amber" }) {
  return (
    <div className="rounded-sm bg-base-panel p-2">
      <p className="text-[9px] uppercase tracking-[0.08em] text-base-muted">{label}</p>
      <p className={cx("mt-1 truncate font-mono text-[11px] font-semibold", tone === "mint" ? "text-base-mint" : tone === "amber" ? "text-base-amber" : "text-base-text")}>{value}</p>
    </div>
  );
}
