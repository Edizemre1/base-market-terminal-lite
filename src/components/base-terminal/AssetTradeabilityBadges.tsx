"use client";

import {
  BadgeCheck,
  ChartNoAxesCombined,
  CheckCircle2,
  CircleHelp,
  CircleX,
  ClockAlert,
  Database,
  LoaderCircle,
  Network,
  Route,
  RouteOff,
  ScanSearch,
  ShieldQuestion,
  WalletCards,
  type LucideIcon
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import type { TokenOpportunity } from "@/lib/base-terminal/opportunityModel";
import {
  deriveTradeabilityAssessment,
  getIdentityDisplay,
  marketDataOnlyAssessment,
  resolveAssetIdentity,
  type AssetIdentityAssessment,
  type AssetIdentityStatus,
  type TradeabilityAssessment,
  type TradeabilityInput,
  type TradeabilityStatus
} from "@/lib/base-terminal/assetTradeability";
import { getNormalizedMarketModel } from "@/lib/base-terminal/marketModel";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { cx } from "@/lib/format";
import { getBaseScanAddressUrl } from "@/lib/safeUrl";
import type { BasePair } from "@/types/baseTerminal";

const IDENTITY_ICONS: Readonly<Record<AssetIdentityStatus, LucideIcon>> = Object.freeze({
  verified: BadgeCheck,
  unverified: ShieldQuestion,
  conflicting: CircleX,
  unavailable: CircleHelp
});

export const TRADEABILITY_ICONS: Readonly<Record<TradeabilityStatus, LucideIcon>> = Object.freeze({
  market_data_only: Database,
  quote_required: CircleHelp,
  quote_loading: LoaderCircle,
  quote_available: Route,
  no_route: RouteOff,
  quote_expired: ClockAlert,
  execution_disabled: CircleX,
  wrong_network: Network,
  wallet_required: WalletCards,
  review_ready: ScanSearch,
  approval_required: ScanSearch,
  simulation_required: ScanSearch,
  transaction_ready: CheckCircle2,
  provider_unavailable: CircleX,
  token_metadata_invalid: CircleX
});

type TradeabilityContextValue = {
  selected?: TradeabilityAssessment;
  publish: (assessment: TradeabilityAssessment) => void;
  clear: (pairKey: string) => void;
};

const TradeabilityContext = createContext<TradeabilityContextValue | undefined>(undefined);

export function TradeabilityProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<TradeabilityAssessment>();
  const publish = useCallback((assessment: TradeabilityAssessment) => {
    setSelected((current) => sameAssessment(current, assessment) ? current : assessment);
  }, []);
  const clear = useCallback((pairKey: string) => setSelected((current) => current?.pairKey === pairKey ? undefined : current), []);
  const value = useMemo(() => ({ selected, publish, clear }), [clear, publish, selected]);
  return <TradeabilityContext.Provider value={value}>{children}</TradeabilityContext.Provider>;
}

export function useTradeabilityPublisher() {
  const context = useContext(TradeabilityContext);
  if (!context) throw new Error("useTradeabilityPublisher must be used inside TradeabilityProvider");
  return context;
}

export function useTradeabilityForPair(pair: BasePair) {
  const context = useContext(TradeabilityContext);
  const fallback = useMemo(() => marketDataOnlyAssessment(pair), [pair]);
  if (!context?.selected) return fallback;
  const pairKey = getNormalizedMarketModel(pair).key;
  const exact = context.selected;
  const addressesMatch = [pair.baseTokenAddress, pair.quoteTokenAddress]
    .filter(Boolean)
    .every((address) => [exact.fromTokenAddress, exact.toTokenAddress].includes(address?.toLowerCase()));
  return exact.pairKey === pairKey && addressesMatch ? exact : fallback;
}

export function useDerivedTradeability(input: TradeabilityInput) {
  return useMemo(() => deriveTradeabilityAssessment(input), [input]);
}

export function AssetTradeabilityBadges({ pair, opportunity, compact = true, className }: {
  pair: BasePair;
  opportunity?: TokenOpportunity;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const identity = useMemo(() => {
    const display = getIdentityDisplay(pair, {
      address: opportunity?.focusTokenAddress,
      name: opportunity?.focusTokenName,
      symbol: opportunity?.focusTokenSymbol
    });
    return resolveAssetIdentity({
      chainId: pair.chainId,
      tokenAddress: display.address,
      displayName: display.name,
      displaySymbol: display.symbol,
      observedAt: pair.sourceUpdatedAt
    });
  }, [opportunity, pair]);
  const tradeability = useTradeabilityForPair(pair);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 72, left: 12 });

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        top: Math.min(window.innerHeight - 24, rect.bottom + 6),
        left: Math.max(12, Math.min(window.innerWidth - 332, rect.left))
      });
    };
    const close = (event: MouseEvent) => {
      const node = event.target as Node;
      if (!triggerRef.current?.contains(node) && !dialogRef.current?.contains(node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const subject = `${identity.displaySymbol} · ${t(`identity.status.${identity.status}` as TranslationKey)} · ${t(`tradeability.status.${tradeability.status}` as TranslationKey)}`;
  return <>
    <button
      ref={triggerRef}
      type="button"
      aria-expanded={open}
      aria-label={t("assetTradeability.open", { asset: identity.displaySymbol })}
      onClick={() => setOpen((value) => !value)}
      className={cx("inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-1 outline-none focus-visible:ring-2 focus-visible:ring-base-mint/50", className)}
      data-testid="asset-tradeability-group"
      data-identity-status={identity.status}
      data-tradeability-status={tradeability.status}
      title={subject}
    >
      <AssetIdentityBadge assessment={identity} compact={compact} />
      <TradeabilityBadge assessment={tradeability} compact={compact} />
    </button>
    {mounted && open ? createPortal(<AssetTradeabilityPopover dialogRef={dialogRef} pair={pair} identity={identity} tradeability={tradeability} position={position} />, document.body) : null}
  </>;
}

export function AssetIdentityBadge({ assessment, compact = false }: { assessment: AssetIdentityAssessment; compact?: boolean }) {
  const { t } = useI18n();
  const Icon = IDENTITY_ICONS[assessment.status];
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-1.5 py-1 font-mono text-[8px] font-semibold", identityTone(assessment.status))} data-testid="asset-identity-badge">
    <Icon size={11} aria-hidden="true" />
    {!compact || assessment.status !== "verified" ? t(`identity.status.${assessment.status}` as TranslationKey) : null}
  </span>;
}

export function TradeabilityBadge({ assessment, compact = false }: { assessment: TradeabilityAssessment; compact?: boolean }) {
  const { t } = useI18n();
  const Icon = TRADEABILITY_ICONS[assessment.status];
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-1.5 py-1 font-mono text-[8px] font-semibold", tradeTone(assessment.status))} data-testid="tradeability-badge">
    <Icon size={11} className={assessment.status === "quote_loading" ? "animate-spin motion-reduce:animate-none" : undefined} aria-hidden="true" />
    {!compact || !["market_data_only", "quote_required"].includes(assessment.status) ? t(`tradeability.status.${assessment.status}` as TranslationKey) : null}
  </span>;
}

const AssetTradeabilityPopover = function AssetTradeabilityPopover({ pair, identity, tradeability, position, dialogRef }: {
  pair: BasePair;
  identity: AssetIdentityAssessment;
  tradeability: TradeabilityAssessment;
  position: { top: number; left: number };
  dialogRef: Ref<HTMLDivElement>;
}) {
  const { t } = useI18n();
  const baseScan = getBaseScanAddressUrl(identity.tokenAddress);
  return <div
    ref={dialogRef}
    role="dialog"
    aria-label={t("assetTradeability.details", { asset: identity.displaySymbol })}
    className="fixed z-[120] max-h-[min(620px,82vh)] w-[320px] overflow-y-auto rounded-xl border border-base-line bg-base-panel p-3 shadow-2xl"
    style={{ top: position.top, left: position.left, transform: position.top > window.innerHeight / 2 ? "translateY(-100%)" : undefined }}
    data-testid="asset-tradeability-popover"
  >
    <div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("assetTradeability.title")}</p><h3 className="mt-1 text-[13px] font-semibold text-base-text">{identity.displayName} · {identity.displaySymbol}</h3></div><ChartNoAxesCombined size={16} className="text-base-muted" aria-hidden="true" /></div>
    <dl className="mt-3 space-y-1.5 text-[9px]">
      <Fact label={t("assetTradeability.identityStatus")} value={t(`identity.status.${identity.status}` as TranslationKey)} />
      <Fact label={t("assetTradeability.contract")} value={identity.tokenAddress ?? t("common.noData")} breakAll />
      <Fact label={t("assetTradeability.chain")} value="Base · 8453" />
      <Fact label={t("assetTradeability.source")} value={identity.source} />
      <Fact label={t("assetTradeability.primaryPool")} value={`${pair.dexName ?? pair.dex} · ${pair.pairAddress ?? pair.id}`} breakAll />
      <Fact label={t("assetTradeability.marketData")} value={t("tradeability.marketDataAvailable")} />
      <Fact label={t("assetTradeability.lastQuote")} value={t(`tradeability.status.${tradeability.status}` as TranslationKey)} />
      <Fact label={t("assetTradeability.quoteSource")} value={tradeability.provider ? `${tradeability.provider} · ${tradeability.source}` : tradeability.source} />
      <Fact label={t("assetTradeability.sideAmount")} value={`${t(`trade.${tradeability.side}` as TranslationKey)} · ${tradeability.amount || t("common.noData")}`} />
      <Fact label={t("assetTradeability.reason")} value={tradeability.reasonCode} />
      <Fact label={t("assetTradeability.lastCheck")} value={formatUtc(tradeability.observedAt)} />
      <Fact label={t("assetTradeability.expires")} value={formatUtc(tradeability.expiresAt)} />
    </dl>
    <p className="mt-3 rounded-sm bg-base-elevated p-2 text-[9px] leading-4 text-base-muted">{t(`tradeability.description.${tradeability.status}` as TranslationKey)}</p>
    <p className="mt-2 rounded-sm border border-base-amber/25 bg-base-amber/5 p-2 text-[9px] leading-4 text-base-amber">{identity.resemblesKnownBrand ? t("identity.brandDisclaimer") : identity.status === "verified" ? t("identity.verifiedDisclaimer") : t("identity.unverifiedDisclaimer")}</p>
    <div className="mt-3 flex flex-wrap gap-2">{baseScan ? <a href={baseScan} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center rounded-sm bg-base-elevated px-2 text-[9px] font-semibold text-base-mint">BaseScan</a> : null}{identity.status === "verified" && identity.officialSourceUrl ? <a href={identity.officialSourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center rounded-sm bg-base-elevated px-2 text-[9px] font-semibold text-base-mint">{t("assetTradeability.officialSource")}</a> : null}</div>
  </div>;
};

function Fact({ label, value, breakAll = false }: { label: string; value: string; breakAll?: boolean }) {
  return <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2"><dt className="text-base-muted">{label}</dt><dd className={cx("text-right font-mono text-base-text", breakAll && "break-all")}>{value}</dd></div>;
}

function identityTone(status: AssetIdentityStatus) {
  if (status === "verified") return "border-base-mint/35 bg-base-mint/10 text-base-mint";
  if (status === "conflicting") return "border-base-rose/40 bg-base-rose/10 text-base-rose";
  return "border-base-line bg-base-elevated text-base-muted";
}

function tradeTone(status: TradeabilityStatus) {
  if (status === "quote_available" || status === "transaction_ready") return "border-base-mint/35 bg-base-mint/10 text-base-mint";
  if (status === "quote_loading") return "border-base-cyan/35 bg-base-cyan/10 text-base-cyan";
  if (["wrong_network", "wallet_required", "review_ready", "approval_required", "simulation_required", "quote_expired"].includes(status)) return "border-base-amber/35 bg-base-amber/10 text-base-amber";
  if (["no_route", "provider_unavailable", "token_metadata_invalid"].includes(status)) return "border-base-rose/35 bg-base-rose/10 text-base-rose";
  return "border-base-line bg-base-elevated text-base-muted";
}

function sameAssessment(left: TradeabilityAssessment | undefined, right: TradeabilityAssessment) {
  if (!left) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatUtc(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().replace("T", " ").replace(".000Z", " UTC") : "N/A";
}

export function assetIdentityForPair(pair: BasePair) {
  const display = getIdentityDisplay(pair);
  return resolveAssetIdentity({ chainId: pair.chainId, tokenAddress: display.address, displayName: display.name, displaySymbol: display.symbol, observedAt: pair.sourceUpdatedAt });
}
