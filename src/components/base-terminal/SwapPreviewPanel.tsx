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
      className="pulse-surface min-w-0 overflow-hidden rounded-panel"
      data-testid="swap-preview-panel"
      data-market-mode={marketDataMode}
    >
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-subtle/60 px-3 py-3">
        <div>
          <p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">
            {t("wallet.actionDock")}
          </p>
          <h2 className="mt-1 text-data font-semibold text-content-primary">{pair.pair}</h2>
        </div>
        <button type="button" onClick={() => setExpanded((current) => !current)} className="inline-flex h-8 items-center gap-2 rounded-pill bg-surface-interactive px-3 font-mono text-meta text-content-secondary" aria-expanded={expanded}>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? t("wallet.collapse") : t("wallet.details")}
        </button>
      </div>

      <div className="space-y-3 p-3">
        <section className="rounded-control bg-surface-interactive p-3" aria-label={t("wallet.status")}>
          {connected && walletAddress ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-meta font-medium text-content-secondary">{t("wallet.connected")}</p>
                  <p className="mt-1 truncate font-mono text-body font-semibold text-content-primary" data-testid="wallet-address">
                    {shortenWalletAddress(walletAddress)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={wallet.disconnect}
                  className="inline-flex min-h-8 items-center gap-1 rounded-control px-2 text-meta text-content-secondary outline-none hover:bg-surface-panel hover:text-content-primary focus-visible:ring-2 focus-visible:ring-focus"
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
                <div className="mt-3 rounded-control border border-freshness-delayed/35 bg-freshness-delayed/10 p-3 text-meta text-freshness-delayed" data-testid="wrong-network-warning">
                  <p className="font-semibold">{t("wallet.wrongNetwork")}</p>
                  <button
                    type="button"
                    onClick={() => void wallet.switchToBase()}
                    className="mt-2 min-h-9 rounded-control border border-freshness-delayed/45 bg-surface-panel px-3 font-semibold outline-none hover:text-content-primary focus-visible:ring-2 focus-visible:ring-freshness-delayed/40"
                  >
                    {t("wallet.switchBase")}
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-center">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-pill bg-surface-panel text-brand-accent">
                <WalletCards size={19} aria-hidden="true" />
              </span>
              <p className="mt-2 text-body font-semibold text-content-primary">{t("wallet.contextTitle")}</p>
              <p className="mt-1 text-meta leading-5 text-content-secondary">
                {t("wallet.contextBody")}
              </p>
              <button
                type="button"
                data-testid="wallet-panel-connect"
                onClick={wallet.openPicker}
                disabled={wallet.status === "connecting"}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-control border border-brand-action bg-brand-action px-3 text-label font-semibold text-content-on-accent outline-none hover:bg-brand-action/90 focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait disabled:opacity-70"
              >
                <WalletCards size={14} aria-hidden="true" />
                {wallet.status === "connecting" ? t("wallet.waiting") : t("wallet.connect")}
              </button>
              {wallet.status === "unavailable" ? (
                <p className="mt-2 text-meta text-freshness-delayed">{t("wallet.noProvider")}</p>
              ) : null}
            </div>
          )}
          {wallet.error ? (
            <p className="mt-3 rounded-control border border-freshness-delayed/35 bg-freshness-delayed/10 px-3 py-2 text-meta text-freshness-delayed" role="alert" data-testid="wallet-error">
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
          <p className="rounded-control border border-freshness-delayed/35 bg-freshness-delayed/10 px-3 py-2 text-meta text-freshness-delayed">
            {t("wallet.amountError")}
          </p>
        ) : null}

        {expanded ? <section className="rounded-card bg-surface-interactive/60 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-1 shrink-0 text-freshness-delayed" aria-hidden="true" />
            <div>
              <p className="text-label font-semibold text-content-primary">{t("wallet.quoteUnavailable")}</p>
              <p className="mt-1 text-meta leading-5 text-content-secondary">
                {t("wallet.quoteUnavailableBody")}
              </p>
            </div>
          </div>
        </section> : (
          <div className="rounded-card bg-surface-interactive/60 px-3 py-3 text-meta leading-5 text-content-secondary">
            <p className="font-semibold text-content-primary">{t("wallet.previewMissing")}</p>
            <p>{t("wallet.previewMissingBody")}</p>
          </div>
        )}

        <div className="rounded-card bg-brand-accent/5 px-3 py-3 text-meta leading-5 text-content-secondary">
          <p className="font-semibold text-content-primary">{t("wallet.readOnly")}</p>
          <p>{t("wallet.readOnlyBody")}</p>
        </div>

        <button
          type="button"
          disabled
          data-testid="review-swap-button"
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-control border border-border-subtle bg-surface-raised px-3 text-label font-semibold text-content-secondary"
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
      <span className="mb-1 block text-meta font-medium text-content-secondary">{label}</span>
      <span className="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] overflow-hidden rounded-control border border-border-subtle bg-surface-panel">
        <span className="flex min-w-0 items-center gap-2 bg-surface-interactive px-2 py-2">
          <TokenAvatar symbol={token} logoUrl={logoUrl} size="md" />
          <span className="min-w-0">
            <span className="block truncate font-mono text-data font-semibold text-content-primary">{token}</span>
            <span className="block truncate text-meta text-content-secondary">{sublabel}</span>
          </span>
        </span>
        <input
          aria-label={t("wallet.amountLabel", { label })}
          value={value}
          readOnly={readOnly}
          inputMode="decimal"
          onChange={(event) => onValueChange?.(event.target.value)}
          className="h-14 min-w-0 bg-surface-panel px-3 text-right font-mono text-title-sm text-content-primary outline-none focus:bg-surface-interactive"
        />
      </span>
    </label>
  );
}

function WalletMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "mint" | "amber" }) {
  return (
    <div className="rounded-control bg-surface-panel p-2">
      <p className="text-meta uppercase tracking-eyebrow text-content-secondary">{label}</p>
      <p className={cx("mt-1 truncate font-mono text-meta font-semibold", tone === "mint" ? "text-brand-accent" : tone === "amber" ? "text-freshness-delayed" : "text-content-primary")}>{value}</p>
    </div>
  );
}
