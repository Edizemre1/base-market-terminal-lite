import { Star } from "lucide-react";
import { type PinnedPair } from "@/components/TerminalSearchContext";
import { PairAvatarStack } from "@/components/TokenIdentity";
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
    <section
      className="flex min-h-0 flex-col overflow-hidden border border-border-subtle bg-surface-panel"
      data-testid="pinned-pairs-panel"
    >
      <div className="flex min-h-8 shrink-0 items-center justify-between border-b border-border-subtle bg-surface-raised px-2">
        <div className="flex items-center gap-2">
          <Star size={11} className="text-brand-accent" fill="currentColor" aria-hidden="true" />
          <h2 className="text-meta font-semibold uppercase tracking-eyebrow text-content-primary">
            Pinned
          </h2>
        </div>
        <span className="font-mono text-meta uppercase tracking-eyebrow text-content-secondary">
          local
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {pairs.length === 0 ? (
          <div className="px-2 py-3 text-meta text-content-secondary">
            <p className="font-mono text-content-primary">
              {filtersActive ? "No pinned pairs match filters." : "No pinned pairs."}
            </p>
            <p className="mt-1">Use the star on rows or search results.</p>
          </div>
        ) : (
          pairs.map((pair) => (
            <div
              key={pair.key}
              data-testid={`pinned-pair-${pair.currentPairId ?? pair.key}`}
              className={cx(
                "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-border-subtle px-2 py-2 text-meta last:border-b-0",
                pair.currentPairId === selectedPairId && "bg-brand-accent/10",
                pair.stale && "bg-freshness-delayed/5"
              )}
            >
              <button
                type="button"
                disabled={!pair.currentPairId}
                onClick={() => pair.currentPairId && onSelect(pair.currentPairId)}
                className="flex min-w-0 items-center gap-2 text-left disabled:cursor-not-allowed"
              >
                <PairAvatarStack
                  baseSymbol={pair.baseToken}
                  quoteSymbol={pair.quoteToken}
                  baseLogoUrl={pair.tokenLogoUrl}
                  quoteLogoUrl={pair.quoteTokenLogoUrl}
                  size="sm"
                />
                <span className="min-w-0">
                  <span className="block truncate font-mono font-semibold text-content-primary">
                    {pair.pair}
                  </span>
                  <span
                    className={cx(
                      "block truncate text-meta",
                      pair.stale ? "font-mono text-freshness-delayed" : "text-content-secondary"
                    )}
                  >
                    {pair.stale ? "Stale - not in current feed" : pair.dex}
                  </span>
                </span>
              </button>
              <span className="text-right font-mono text-meta">
                <span className="block text-content-primary">{pair.price}</span>
                <span className={(pair.change24h ?? 0) >= 0 ? "text-market-positive" : "text-market-negative"}>
                  {pair.change24h === undefined ? "N/A" : formatPercent(pair.change24h)}
                </span>
                <span className="block text-meta text-content-secondary">
                  L {pair.liquidity === undefined && pair.volume24h === undefined ? "N/A" : formatCompactCurrency(pair.liquidity ?? pair.volume24h ?? 0)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onUnpin(pair.key)}
                className="grid h-6 w-6 place-items-center border border-border-subtle bg-surface-interactive text-brand-accent hover:border-market-negative hover:text-market-negative"
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
    <section
      id={id}
      className="flex min-h-0 flex-col overflow-hidden border border-border-subtle bg-surface-panel"
      data-testid={`feed-${kind}`}
    >
      <div className="flex min-h-8 shrink-0 items-center justify-between border-b border-border-subtle bg-surface-raised px-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-meta text-content-secondary">{marker}</span>
          <h2 className="text-meta font-semibold uppercase tracking-eyebrow text-content-primary">
            {title}
          </h2>
        </div>
        <span className="border border-border-subtle bg-surface-interactive px-2 py-1 font-mono text-meta uppercase tracking-eyebrow text-content-secondary">
          {pairs.length} rows
        </span>
      </div>
      <div className="grid shrink-0 grid-cols-[minmax(0,1.5fr)_30px_50px_50px_44px] border-b border-border-subtle bg-surface-interactive px-2 py-2 text-meta font-semibold uppercase tracking-eyebrow text-content-secondary">
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
          <div className="border-b border-border-subtle bg-freshness-delayed/10 px-2 py-1 font-mono text-meta uppercase tracking-eyebrow text-freshness-delayed">
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
      <div className="border-b border-border-subtle px-2 py-4 text-meta text-content-secondary last:border-b-0">
        <p className="font-mono text-content-primary">No qualified new pairs found.</p>
        <p className="mt-1">Try Volume Inflow or Momentum.</p>
      </div>
    );
  }

  return (
    <div className="border-b border-border-subtle px-2 py-4 text-meta text-content-secondary last:border-b-0">
      <p className="font-mono text-content-primary">No qualified pairs found.</p>
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
      data-testid={`pair-row-${kind}-${pair.id}`}
      className={cx(
        "relative border-b border-border-subtle last:border-b-0",
        selectedPairId === pair.id && "bg-brand-accent/10"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(pair.id)}
        className="grid min-h-11 w-full grid-cols-[minmax(0,1.5fr)_30px_50px_50px_44px] items-center px-2 py-1 pr-8 text-left text-meta hover:bg-surface-interactive"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cx(
              "h-1.5 w-1.5 shrink-0 rounded-pill",
              isFallbackRow ? "bg-freshness-delayed" : "bg-brand-accent"
            )}
          />
          <PairAvatarStack
            baseSymbol={pair.baseToken}
            quoteSymbol={pair.quoteToken}
            baseLogoUrl={pair.tokenLogoUrl}
            quoteLogoUrl={pair.quoteTokenLogoUrl}
            size="sm"
          />
          <span className="min-w-0">
            <span className="block truncate font-mono font-semibold text-content-primary">
              {pair.pair}
            </span>
            <span className="flex min-w-0 items-center gap-1">
              <span
                className={cx(
                  "truncate text-meta leading-3",
                  isFallbackRow ? "font-mono text-freshness-delayed" : "text-content-secondary"
                )}
              >
                {getFeedRowSubtitle(pair, isFallbackRow)}
              </span>
              {!isFallbackRow ? (
                <span className="shrink-0 border border-border-subtle bg-surface-interactive px-1 font-mono text-meta uppercase text-content-secondary">
                  {pair.dexName ?? pair.dex}
                </span>
              ) : null}
            </span>
          </span>
        </span>
        <span className="font-mono text-meta text-content-secondary">{pair.age}</span>
        <span className="text-right font-mono text-meta text-content-primary">
          {pair.liquidity === undefined ? "N/A" : formatCompactCurrency(pair.liquidity)}
        </span>
        <span className="text-right font-mono text-meta text-content-primary">
          {pair.volume24h === undefined ? "N/A" : formatCompactCurrency(pair.volume24h)}
        </span>
        <span
          className={cx(
            "justify-self-end border px-1 py-1 text-right font-mono text-meta",
            (pair.change24h ?? 0) >= 0
              ? "border-brand-accent/35 bg-brand-accent/10 text-brand-accent"
              : "border-market-negative/35 bg-market-negative/10 text-market-negative"
          )}
        >
          {kind === "momentum"
            ? pair.momentumScore ?? "N/A"
            : kind === "inflow"
              ? pair.inflow24h === undefined ? "N/A" : `+${formatCompactCurrency(pair.inflow24h)}`
              : pair.change24h === undefined ? "N/A" : formatPercent(pair.change24h)}
        </span>
      </button>
      <button
        data-testid={`pin-pair-${kind}-${pair.id}`}
        type="button"
        onClick={() => onTogglePin(pair)}
        className={cx(
          "absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center border border-border-subtle bg-surface-interactive text-content-secondary hover:border-border-strong hover:text-content-primary",
          isPinned && "border-brand-accent/45 bg-brand-accent/10 text-brand-accent"
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
    ? pair.project
    : "Market pair";
}
