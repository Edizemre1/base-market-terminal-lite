import { Star } from "lucide-react";
import { type PinnedPair } from "@/components/TerminalSearchContext";
import { cx, formatCompactCurrency, formatPercent } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";

type FeedKind = "new" | "inflow" | "momentum";

export function PinnedPairsPanel({
  pairs,
  selectedPairId,
  onSelect,
  onUnpin,
  filtersActive
}: {
  pairs: PinnedPair[];
  selectedPairId: string;
  onSelect: (id: string) => void;
  onUnpin: (key: string) => void;
  filtersActive: boolean;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden border border-base-line bg-base-panel">
      <div className="flex min-h-8 shrink-0 items-center justify-between border-b border-base-line bg-base-raised px-2">
        <div className="flex items-center gap-2">
          <Star size={11} className="text-base-mint" fill="currentColor" aria-hidden="true" />
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-text">
            Pinned
          </h2>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-base-muted">
          local
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {pairs.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-base-muted">
            <p className="font-mono text-base-text">
              {filtersActive ? "No pinned pairs match filters." : "No pinned pairs."}
            </p>
            <p className="mt-1">Use the star on rows or search results.</p>
          </div>
        ) : (
          pairs.map((pair) => (
            <div
              key={pair.key}
              className={cx(
                "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-base-line px-2 py-1.5 text-[11px] last:border-b-0",
                pair.currentPairId === selectedPairId && "bg-base-mint/10",
                pair.stale && "bg-base-amber/5"
              )}
            >
              <button
                type="button"
                disabled={!pair.currentPairId}
                onClick={() => pair.currentPairId && onSelect(pair.currentPairId)}
                className="min-w-0 text-left disabled:cursor-not-allowed"
              >
                <span className="block truncate font-mono font-semibold text-base-text">
                  {pair.pair}
                </span>
                <span
                  className={cx(
                    "block truncate text-[10px]",
                    pair.stale ? "font-mono text-base-amber" : "text-base-muted"
                  )}
                >
                  {pair.stale ? "Stale - not in current feed" : pair.dex}
                </span>
              </button>
              <span className="text-right font-mono text-[10px]">
                <span className="block text-base-text">{pair.price}</span>
                <span className={pair.change24h >= 0 ? "text-base-mint" : "text-base-rose"}>
                  {formatPercent(pair.change24h)}
                </span>
                <span className="block text-[9px] text-base-muted">
                  L {formatCompactCurrency(pair.liquidity || pair.volume24h)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onUnpin(pair.key)}
                className="grid h-6 w-6 place-items-center border border-base-line bg-base-elevated text-base-mint hover:border-base-rose hover:text-base-rose"
                aria-label={`Unpin ${pair.pair}`}
              >
                <Star size={12} fill="currentColor" aria-hidden="true" />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function OpportunityFeed({
  id,
  title,
  marker,
  kind,
  pairs,
  showFallbackLabels,
  selectedPairId,
  onSelect,
  isPairPinned,
  onTogglePin
}: {
  id?: string;
  title: string;
  marker: string;
  kind: FeedKind;
  pairs: BasePair[];
  showFallbackLabels: boolean;
  selectedPairId: string;
  onSelect: (id: string) => void;
  isPairPinned: (pair: BasePair) => boolean;
  onTogglePin: (pair: BasePair) => void;
}) {
  const livePairs =
    showFallbackLabels ? pairs.filter((pair) => pair.dataSource !== "mock") : pairs;
  const fallbackPairs =
    showFallbackLabels ? pairs.filter((pair) => pair.dataSource === "mock") : [];

  return (
    <section id={id} className="flex min-h-0 flex-col overflow-hidden border border-base-line bg-base-panel">
      <div className="flex min-h-8 shrink-0 items-center justify-between border-b border-base-line bg-base-raised px-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-base-muted">{marker}</span>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-text">
            {title}
          </h2>
        </div>
        <span className="border border-base-mint/40 bg-base-mint/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-base-mint">
          View all
        </span>
      </div>
      <div className="grid shrink-0 grid-cols-[minmax(104px,1.4fr)_34px_56px_56px_44px] border-b border-base-line bg-base-elevated px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-base-muted">
        <span>Pair</span>
        <span>Age</span>
        <span className="text-right">Liquidity</span>
        <span className="text-right">24h Vol</span>
        <span className="text-right">{kind === "momentum" ? "Score" : "Delta"}</span>
      </div>
      <div className="min-h-0 xl:flex-1 xl:overflow-y-auto">
        {livePairs.map((pair) => (
          <FeedRow
            key={`${title}-${pair.id}`}
            kind={kind}
            pair={pair}
            selectedPairId={selectedPairId}
            onSelect={onSelect}
            isPinned={isPairPinned(pair)}
            onTogglePin={onTogglePin}
          />
        ))}

        {livePairs.length === 0 && fallbackPairs.length === 0 ? (
          <FeedEmptyState kind={kind} />
        ) : null}

        {fallbackPairs.length > 0 ? (
          <div className="border-b border-base-line bg-base-amber/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-base-amber">
            Demo fallback
          </div>
        ) : null}

        {fallbackPairs.map((pair) => (
          <FeedRow
            key={`${title}-fallback-${pair.id}`}
            kind={kind}
            pair={pair}
            selectedPairId={selectedPairId}
            onSelect={onSelect}
            isFallbackRow
            isPinned={isPairPinned(pair)}
            onTogglePin={onTogglePin}
          />
        ))}
      </div>
    </section>
  );
}

function FeedEmptyState({ kind }: { kind: FeedKind }) {
  if (kind === "new") {
    return (
      <div className="border-b border-base-line px-2 py-4 text-[11px] text-base-muted last:border-b-0">
        <p className="font-mono text-base-text">No qualified new Base pairs found.</p>
        <p className="mt-1">Try Volume Inflow or Momentum.</p>
      </div>
    );
  }

  return (
    <div className="border-b border-base-line px-2 py-4 text-[11px] text-base-muted last:border-b-0">
      <p className="font-mono text-base-text">No qualified pairs found.</p>
      <p className="mt-1">Read-only market data is limited right now.</p>
    </div>
  );
}

function FeedRow({
  kind,
  pair,
  selectedPairId,
  onSelect,
  isPinned,
  onTogglePin,
  isFallbackRow = false
}: {
  kind: FeedKind;
  pair: BasePair;
  selectedPairId: string;
  onSelect: (id: string) => void;
  isPinned: boolean;
  onTogglePin: (pair: BasePair) => void;
  isFallbackRow?: boolean;
}) {
  return (
    <div
      className={cx(
        "relative border-b border-base-line last:border-b-0",
        selectedPairId === pair.id && "bg-base-mint/10"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(pair.id)}
        className="grid min-h-10 w-full grid-cols-[minmax(104px,1.4fr)_34px_56px_56px_44px] items-center px-2 py-1 pr-8 text-left text-[11px] hover:bg-base-mint/5"
      >
        <span className="flex min-w-0 items-start gap-1.5">
          <span
            className={cx(
              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
              isFallbackRow ? "bg-base-amber" : "bg-base-mint"
            )}
          />
          <span className="min-w-0">
            <span className="block truncate font-mono font-semibold text-base-text">
              {pair.pair}
            </span>
            <span
              className={cx(
                "block truncate text-[9px] leading-3",
                isFallbackRow ? "font-mono text-base-amber" : "text-base-muted"
              )}
            >
              {getFeedRowSubtitle(pair, isFallbackRow)}
            </span>
          </span>
        </span>
        <span className="font-mono text-[10px] text-base-muted">{pair.age}</span>
        <span className="text-right font-mono text-[10px] text-base-text">
          {formatCompactCurrency(pair.liquidity)}
        </span>
        <span className="text-right font-mono text-[10px] text-base-text">
          {formatCompactCurrency(pair.volume24h)}
        </span>
        <span
          className={cx(
            "text-right font-mono text-[10px]",
            pair.change24h >= 0 ? "text-base-mint" : "text-base-rose"
          )}
        >
          {kind === "momentum"
            ? pair.momentumScore
            : kind === "inflow"
              ? `+${formatCompactCurrency(pair.inflow24h)}`
              : formatPercent(pair.change24h)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onTogglePin(pair)}
        className={cx(
          "absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center border border-base-line bg-base-elevated text-base-muted hover:border-base-mint hover:text-base-mint",
          isPinned && "border-base-mint/45 bg-base-mint/10 text-base-mint"
        )}
        aria-label={isPinned ? `Unpin ${pair.pair}` : `Pin ${pair.pair}`}
      >
        <Star size={12} fill={isPinned ? "currentColor" : "none"} aria-hidden="true" />
      </button>
    </div>
  );
}

function getFeedRowSubtitle(pair: BasePair, isFallbackRow: boolean) {
  if (isFallbackRow) {
    return `Demo fallback - ${pair.dex}`;
  }

  return pair.project && pair.project !== pair.baseToken
    ? `${pair.project} - ${pair.dex}`
    : pair.dex;
}
