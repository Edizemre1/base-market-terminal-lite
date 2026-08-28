import { LockKeyhole, Settings } from "lucide-react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { TokenAvatar } from "@/components/TokenIdentity";
import { cx } from "@/lib/format";
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
  const amountNumber = Number.parseFloat(amount);
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0;
  const modeWarning =
    marketDataMode === "dexscreener"
      ? "Read-only market data. No real funds will be used."
      : "This is demo data. No real funds will be used.";
  const modeLabel =
    marketDataMode === "dexscreener"
      ? "Read-only mode - no transaction will be sent"
      : "Demo mode - no transaction will be sent";

  return (
    <aside
      className="min-w-0 border border-base-line bg-base-panel xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:self-stretch xl:overflow-hidden"
      data-testid="swap-preview-panel"
    >
      <div className="flex min-h-10 shrink-0 items-center justify-between border-b border-base-line bg-base-raised px-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
            Read-only preview
          </p>
          <h2 className="text-[12px] font-semibold text-base-text">Swap {pair.pair}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="border border-base-line bg-base-panel px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-base-muted">
            Disabled
          </span>
          <Settings size={14} className="text-base-muted" aria-hidden="true" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        <TokenBox
          label="From"
          token={pair.quoteToken}
          logoUrl={pair.quoteTokenLogoUrl}
          sublabel="Sell asset"
          rightLabel="Wallet not connected by design"
          value={amount}
          onValueChange={onAmountChange}
        />

        <div className="flex shrink-0 justify-center">
          <span className="grid h-7 w-7 place-items-center border border-base-line bg-base-panel font-mono text-base-muted">
            v
          </span>
        </div>

        <TokenBox
          label="To (Estimated)"
          token={pair.baseToken}
          logoUrl={pair.tokenLogoUrl}
          sublabel="Selected pair"
          value="Unavailable"
          readOnly
        />

        <div className="border border-base-line bg-base-elevated p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-base-muted">
              Quote status
            </p>
            <span className="border border-base-amber/40 bg-base-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-base-amber">
              Not requested
            </span>
          </div>
          <RouteRow label="Pair context" value={pair.pair} />
          <RouteRow
            label="Market source"
            value={marketDataMode === "dexscreener" ? "Read-only public data" : "Labeled sample data"}
          />
          <RouteRow label="Executable route" value="Unavailable" />
          <RouteRow label="Price impact" value="Unavailable" />
          <RouteRow label="Network fee" value="Unavailable" />
        </div>

        <div className="border border-base-line bg-base-panel p-2 text-[11px]">
          <RouteRow label="Wallet" value="Not connected" />
          <RouteRow label="Approval" value="Not available" />
          <RouteRow label="Transaction" value="Not constructed" />
        </div>

        {!amountValid ? (
          <p className="border border-base-amber/40 bg-base-amber/10 px-2 py-1.5 text-[11px] text-base-amber">
            Enter an amount greater than zero to inspect the local preview context.
          </p>
        ) : null}

        <div className="mt-auto space-y-2 pt-1">
          <div className="border border-base-line border-l-base-amber bg-base-elevated p-2.5 text-[11px] leading-4 text-base-muted">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-base-text">
              Read-only boundary
            </p>
            <p className="mt-1">
              Low liquidity can increase price impact and slippage. {modeWarning}
            </p>
          </div>

          <button
            type="button"
            disabled
            data-testid="review-swap-button"
            className="flex h-9 w-full items-center justify-center gap-2 border border-base-line bg-base-raised text-[12px] font-semibold text-base-muted"
          >
            <LockKeyhole size={14} aria-hidden="true" />
            Quote unavailable — preview only
          </button>

          <p className="text-center font-mono text-[10px] uppercase tracking-[0.12em] text-base-muted">
            {modeLabel}
          </p>
        </div>
      </div>
    </aside>
  );
}

function TokenBox({
  label,
  token,
  logoUrl,
  sublabel,
  rightLabel,
  value,
  onValueChange,
  readOnly = false
}: {
  label: string;
  token: string;
  logoUrl?: string;
  sublabel: string;
  rightLabel?: string;
  value: string;
  onValueChange?: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-base-muted">
        <span>{label}</span>
        {rightLabel ? <span className="font-mono text-base-mint">{rightLabel}</span> : null}
      </div>
      <div className="grid min-w-0 grid-cols-[104px_minmax(0,1fr)] border border-base-line bg-base-panel 2xl:grid-cols-[116px_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center gap-2 border-r border-base-line bg-base-elevated px-2 py-1.5">
          <TokenAvatar symbol={token} logoUrl={logoUrl} size="md" />
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-semibold text-base-text">{token}</p>
            <p className="text-[10px] text-base-muted">{sublabel}</p>
          </div>
        </div>
        <input
          value={value}
          readOnly={readOnly}
          inputMode="decimal"
          onChange={(event) => onValueChange?.(event.target.value)}
          className="h-12 min-w-0 bg-base-panel px-3 text-right font-mono text-[17px] text-base-text outline-none 2xl:text-[19px]"
        />
      </div>
    </label>
  );
}

function RouteRow({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: string;
  tone?: "default" | "mint";
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-2 border-b border-base-line py-1 last:border-b-0">
      <span className="min-w-0 text-[11px] text-base-muted">{label}</span>
      <span
        className={cx(
          "max-w-[62%] break-words text-right font-mono text-[11px] font-semibold leading-4",
          tone === "mint" ? "text-base-mint" : "text-base-text"
        )}
      >
        {value}
      </span>
    </div>
  );
}
