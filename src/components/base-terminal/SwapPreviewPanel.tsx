"use client";

import { AlertTriangle, LockKeyhole, LogOut, WalletCards } from "lucide-react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { TokenAvatar } from "@/components/TokenIdentity";
import { useWallet } from "@/components/WalletContext";
import { cx } from "@/lib/format";
import { BASE_CHAIN_ID, shortenWalletAddress } from "@/lib/wallet";
import type { BasePair } from "@/types/baseTerminal";

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
  const walletAddress = wallet.address;
  const connected = wallet.status === "connected" && Boolean(walletAddress);
  const amountNumber = Number.parseFloat(amount);
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0;

  return (
    <aside
      className="min-w-0 overflow-hidden rounded-sm border border-base-line bg-base-panel shadow-panel"
      data-testid="swap-preview-panel"
    >
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-base-line bg-base-raised px-3 py-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-base-muted">
            Wallet & quote
          </p>
          <h2 className="mt-0.5 text-[13px] font-semibold text-base-text">{pair.pair}</h2>
        </div>
        <span className="rounded-full border border-base-mint/35 bg-base-mint/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-base-mint">
          Read-only
        </span>
      </div>

      <div className="space-y-3 p-3">
        <section className="rounded-sm bg-base-elevated p-3" aria-label="Wallet status">
          {connected && walletAddress ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium text-base-muted">Connected wallet</p>
                  <p className="mt-1 truncate font-mono text-[14px] font-semibold text-base-text" data-testid="wallet-address">
                    {shortenWalletAddress(walletAddress)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={wallet.disconnect}
                  className="inline-flex min-h-8 items-center gap-1 rounded-sm px-2 text-[10px] text-base-muted outline-none hover:bg-base-panel hover:text-base-text focus-visible:ring-2 focus-visible:ring-base-mint/40"
                  aria-label="Disconnect wallet from this interface"
                >
                  <LogOut size={12} aria-hidden="true" />
                  Disconnect
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <WalletMetric
                  label="Network"
                  value={wallet.chainId === BASE_CHAIN_ID ? "Base Mainnet" : `Chain ${wallet.chainId ?? "unknown"}`}
                  tone={wallet.wrongNetwork ? "amber" : "mint"}
                />
                <WalletMetric label="Balance" value={wallet.balanceEth ? `${wallet.balanceEth} ETH` : "Unavailable"} />
              </div>
              {wallet.wrongNetwork ? (
                <div className="mt-3 rounded-sm border border-base-amber/35 bg-base-amber/10 p-2.5 text-[11px] text-base-amber" data-testid="wrong-network-warning">
                  <p className="font-semibold">This wallet is not on Base Mainnet (chain 8453).</p>
                  <button
                    type="button"
                    onClick={() => void wallet.switchToBase()}
                    className="mt-2 min-h-9 rounded-sm border border-base-amber/45 bg-base-panel px-3 font-semibold outline-none hover:text-base-text focus-visible:ring-2 focus-visible:ring-base-amber/40"
                  >
                    Switch to Base
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-center">
              <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-base-panel text-base-mint">
                <WalletCards size={19} aria-hidden="true" />
              </span>
              <p className="mt-2 text-[14px] font-semibold text-base-text">Connect for account context</p>
              <p className="mt-1 text-[11px] leading-5 text-base-muted">
                View your public address, Base network and native balance. Connecting does not enable approvals or swaps.
              </p>
              <button
                type="button"
                data-testid="wallet-panel-connect"
                onClick={() => void wallet.connect()}
                disabled={wallet.status === "connecting"}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-sm border border-base-mint bg-base-mint px-3 text-[12px] font-semibold text-white outline-none hover:bg-base-mint/90 focus-visible:ring-2 focus-visible:ring-base-mint/50 disabled:cursor-wait disabled:opacity-70"
              >
                <WalletCards size={14} aria-hidden="true" />
                {wallet.status === "connecting" ? "Waiting for wallet..." : "Connect wallet"}
              </button>
              {wallet.status === "unavailable" ? (
                <p className="mt-2 text-[11px] text-base-amber">Install a compatible wallet to connect.</p>
              ) : null}
            </div>
          )}
          {wallet.error ? (
            <p className="mt-3 rounded-sm border border-base-amber/35 bg-base-amber/10 px-2.5 py-2 text-[11px] text-base-amber" role="alert" data-testid="wallet-error">
              {wallet.error}
            </p>
          ) : null}
        </section>

        <section aria-label="Pair quote context" className="space-y-2">
          <TokenBox
            label="From"
            token={pair.quoteToken}
            logoUrl={pair.quoteTokenLogoUrl}
            sublabel="Local input only"
            value={amount}
            onValueChange={onAmountChange}
          />
          <TokenBox
            label="To (indicative)"
            token={pair.baseToken}
            logoUrl={pair.tokenLogoUrl}
            sublabel="No verified quote provider"
            value="Unavailable"
            readOnly
          />
        </section>

        {!amountValid ? (
          <p className="rounded-sm border border-base-amber/35 bg-base-amber/10 px-2.5 py-2 text-[11px] text-base-amber">
            Enter an amount greater than zero to inspect the pair context.
          </p>
        ) : null}

        <section className="rounded-sm border border-base-line p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-base-amber" aria-hidden="true" />
            <div>
              <p className="text-[12px] font-semibold text-base-text">Indicative quote unavailable</p>
              <p className="mt-1 text-[11px] leading-5 text-base-muted">
                No verified quote provider is configured for this public terminal. Market values come from {marketDataMode === "dexscreener" ? "read-only public data" : "the labeled sample dataset"}; no executable route is constructed.
              </p>
            </div>
          </div>
        </section>

        <div className="rounded-sm border border-base-mint/30 bg-base-mint/5 px-3 py-2.5 text-[11px] leading-5 text-base-muted">
          <p className="font-semibold text-base-text">Wallet connection is read-only</p>
          <p>Approval, swap and transaction creation remain disabled, even while a wallet is connected.</p>
        </div>

        <button
          type="button"
          disabled
          data-testid="review-swap-button"
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-sm border border-base-line bg-base-raised px-3 text-[12px] font-semibold text-base-muted"
        >
          <LockKeyhole size={14} aria-hidden="true" />
          Transactions disabled — read-only
        </button>
      </div>
    </aside>
  );
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
          aria-label={`${label} amount`}
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
