import { LockKeyhole, Settings } from "lucide-react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { cx, formatNumber } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";

export function SwapTicket({
  pair,
  marketDataMode,
  amount,
  onAmountChange,
  estimatedOutput
}: {
  pair: BasePair;
  marketDataMode: MarketTerminalSnapshot["mode"];
  amount: string;
  onAmountChange: (value: string) => void;
  estimatedOutput: number;
}) {
  const modeWarning =
    marketDataMode === "dexscreener"
      ? "Read-only market data. No real funds will be used."
      : "This is demo data. No real funds will be used.";
  const modeLabel =
    marketDataMode === "dexscreener"
      ? "Read-only mode - no transaction will be sent"
      : "Demo mode - no transaction will be sent";

  return (
    <aside className="min-w-0 border border-base-line bg-base-panel xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:self-stretch xl:overflow-hidden">
      <div className="flex min-h-10 shrink-0 items-center justify-between border-b border-base-line bg-base-raised px-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
            Swap selected pair
          </p>
          <h2 className="text-[12px] font-semibold text-base-text">{pair.pair}</h2>
        </div>
        <Settings size={14} className="text-base-muted" aria-hidden="true" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        <TokenBox
          label="From"
          token={pair.quoteToken}
          sublabel="Base"
          rightLabel={`Max: 0.2451 ${pair.quoteToken}`}
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
          sublabel="Base"
          value={formatNumber(estimatedOutput)}
          readOnly
        />

        <div className="border border-base-line bg-base-elevated p-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-base-muted">
              Route preview (best)
            </p>
            <span className="border border-base-mint/40 bg-base-mint/10 px-1.5 py-0.5 font-mono text-[10px] text-base-mint">
              100%
            </span>
          </div>
          <RouteRow label={pair.dex} value={pair.route} />
          <RouteRow label="Price impact" value="-0.24%" tone="mint" />
          <RouteRow label="Minimum received" value={`${formatNumber(estimatedOutput * 0.99)} ${pair.baseToken}`} />
          <RouteRow label="Network fee (est.)" value="$0.84" />
        </div>

        <div className="space-y-1.5 text-[11px]">
          <RouteRow label="Slippage tolerance" value="0.50%" />
          <RouteRow label="Price impact" value="-0.24%" tone="mint" />
          <RouteRow label="Platform fee" value="0.10% (Est. $0.33)" />
        </div>

        <div className="mt-auto space-y-2 pt-1">
          <div className="border border-base-amber/45 bg-base-amber/10 p-2 text-[11px] leading-4 text-base-muted">
            Low liquidity: higher price impact and slippage risk. {modeWarning}
          </div>

          <button
            type="button"
            disabled
            className="flex h-9 w-full items-center justify-center gap-2 border border-base-line bg-base-raised text-[12px] font-semibold text-base-muted"
          >
            <LockKeyhole size={14} aria-hidden="true" />
            Review Swap
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
  sublabel,
  rightLabel,
  value,
  onValueChange,
  readOnly = false
}: {
  label: string;
  token: string;
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
          <span className="grid h-7 w-7 place-items-center rounded-full bg-base-mint/15 font-mono text-[10px] font-semibold text-base-mint">
            {token.slice(0, 2)}
          </span>
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
