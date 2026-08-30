"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, LockKeyhole, RefreshCw, WalletCards, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PairAvatarStack } from "@/components/TokenIdentity";
import { useWallet } from "@/components/WalletContext";
import { AssetTradeabilityBadges, useTradeabilityPublisher } from "@/components/base-terminal/AssetTradeabilityBadges";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { deriveTradeabilityAssessment } from "@/lib/base-terminal/assetTradeability";
import { getNormalizedMarketModel } from "@/lib/base-terminal/marketModel";
import { cx } from "@/lib/format";
import { safeGetStorageItem, safeSetStorageItem } from "@/lib/safeStorage";
import { BASE_CHAIN_ID } from "@/lib/wallet";
import type { QuoteFailureCode, QuoteInvalidationInput, TransactionQuote, TradeCapabilities, TradeSide, TradeToken, TransactionDraft } from "@/lib/trade/types";
import {
  buildAllowanceData,
  buildBalanceOfData,
  buildExactApprovalData,
  formatRawTokenAmount,
  getQuoteInvalidationReason,
  isQuoteFingerprintValid,
  isNativeToken,
  parseHumanTokenAmount,
  validateTransactionQuote
} from "@/lib/trade/validation";
import type { BasePair } from "@/types/baseTerminal";
import { useOverlayManager } from "@/components/OverlayManager";

const LAST_TRANSACTION_KEY = "mergen-terminal:last-transaction:v1";
type QuoteStatus = "idle" | "loading" | "ready" | "error";
type TransactionStatus = "idle" | "simulating" | "awaiting-wallet" | "submitted" | "pending" | "confirmed" | "rejected" | "failed" | "replaced";

export function TradeDock({ pair, marketDataMode, amount, onAmountChange, side, onSideChange, onInteractionChange }: {
  pair: BasePair;
  marketDataMode: MarketTerminalSnapshot["mode"];
  amount: string;
  onAmountChange: (value: string) => void;
  side: TradeSide;
  onSideChange: (side: TradeSide) => void;
  onInteractionChange: (locked: boolean) => void;
}) {
  const wallet = useWallet();
  const overlay = useOverlayManager();
  const { t, formatCompactCurrency } = useI18n();
  const [capabilities, setCapabilities] = useState<TradeCapabilities>();
  const [quote, setQuote] = useState<TransactionQuote>();
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>("idle");
  const [quoteError, setQuoteError] = useState<string>();
  const [quoteFailureCode, setQuoteFailureCode] = useState<QuoteFailureCode>();
  const [slippageBps, setSlippageBps] = useState(50);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [simulationPassed, setSimulationPassed] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<TransactionStatus>("idle");
  const [transactionHash, setTransactionHash] = useState<string>();
  const [balanceRaw, setBalanceRaw] = useState<string>();
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const requestIdRef = useRef(0);
  const quoteInFlightRef = useRef(false);
  const transactionInFlightRef = useRef(false);
  const quoteAbortRef = useRef<AbortController | undefined>(undefined);
  const reviewTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const tokens = useMemo(() => getTradeTokens(pair, side), [pair, side]);
  const market = getNormalizedMarketModel(pair);
  const walletConnected = wallet.status === "connected" && Boolean(wallet.address);
  const connected = walletConnected && wallet.chainId === BASE_CHAIN_ID;
  const exactTokensAvailable = Boolean(tokens.from?.address && tokens.to?.address && market.key);
  const { publish: publishTradeability, clear: clearTradeability } = useTradeabilityPublisher();
  const tradeability = useMemo(() => deriveTradeabilityAssessment({
    pair,
    side,
    amount,
    slippageBps,
    walletAddress: wallet.address,
    walletChainId: wallet.chainId,
    capabilities,
    quote,
    quoteLoading: quoteStatus === "loading",
    quoteFailureCode,
    reviewRequested: transactionStatus === "simulating" && !reviewOpen,
    reviewOpen,
    approvalRequired,
    simulationPassed,
    transactionReady: reviewOpen && simulationPassed && !approvalRequired && Boolean(capabilities?.transactionExecutionEnabled),
    now
  }), [amount, approvalRequired, capabilities, now, pair, quote, quoteFailureCode, quoteStatus, reviewOpen, side, simulationPassed, slippageBps, transactionStatus, wallet.address, wallet.chainId]);

  useEffect(() => {
    publishTradeability(tradeability);
  }, [publishTradeability, tradeability]);

  useEffect(() => () => clearTradeability(market.key), [clearTradeability, market.key]);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    const refreshCapabilities = () => void fetchTradeCapabilities().then((value) => { if (active) setCapabilities(value); }).catch(() => { if (active) setCapabilities(disabledTradeCapabilities()); });
    refreshCapabilities();
    const capabilityTimer = window.setInterval(() => { if (document.visibilityState === "visible") refreshCapabilities(); }, 15_000);
    const stored = readStoredTransaction();
    if (stored) { setTransactionHash(stored.hash); setTransactionStatus(stored.status); }
    return () => {
      active = false;
      mountedRef.current = false;
      quoteAbortRef.current?.abort();
      window.clearInterval(capabilityTimer);
    };
  }, []);

  useEffect(() => {
    requestIdRef.current += 1;
    quoteAbortRef.current?.abort();
    quoteAbortRef.current = undefined;
    quoteInFlightRef.current = false;
    setQuote(undefined);
    setQuoteStatus("idle");
    setQuoteError(undefined);
    setQuoteFailureCode(undefined);
    setReviewOpen(false);
    setApprovalRequired(false);
    setSimulationPassed(false);
    if (!transactionInFlightRef.current) setTransactionStatus("idle");
    setBalanceRaw(undefined);
  }, [amount, pair.baseTokenAddress, pair.id, pair.quoteTokenAddress, side, slippageBps, wallet.address, wallet.chainId]);

  useEffect(() => {
    if (!quote) return;
    const provider = capabilities?.providers.find((candidate) => candidate.name === quote.provider);
    if (capabilities?.quoteRequestEnabled && provider?.status === "enabled") return;
    setQuote(undefined); setQuoteStatus("error"); setReviewOpen(false); setSimulationPassed(false); setQuoteFailureCode("provider-unavailable"); setQuoteError(t("trade.error.providerChanged"));
  }, [capabilities, quote, t]);

  useEffect(() => {
    if (!quote) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [quote]);

  useEffect(() => {
    if (!quote || Date.parse(quote.expiresAt) > now) return;
    setQuote(undefined); setQuoteStatus("error"); setReviewOpen(false); setSimulationPassed(false); setQuoteFailureCode("expired"); setQuoteError(t("trade.error.code.expired"));
  }, [now, quote, t]);

  useEffect(() => {
    if (!reviewOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setReviewOpen(false); reviewTriggerRef.current?.focus(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href]")];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("button")?.focus(), 0);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [reviewOpen]);

  useEffect(() => {
    if (!reviewOpen && overlay.active.type === "transaction_review") overlay.close();
  }, [overlay, reviewOpen]);

  const requestQuote = useCallback(async () => {
    if (!wallet.address || !tokens.from || !tokens.to || quoteInFlightRef.current) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    quoteAbortRef.current?.abort();
    const abortController = new AbortController();
    quoteAbortRef.current = abortController;
    quoteInFlightRef.current = true;
    setQuoteStatus("loading"); setQuoteError(undefined); setQuoteFailureCode(undefined); setQuote(undefined); setSimulationPassed(false);
    let failureCode: QuoteFailureCode | undefined;
    try {
      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet.address, pairKey: market.key, side, fromToken: tokens.from, toToken: tokens.to, amount, slippageBps }),
        signal: abortController.signal
      });
      const payload = await response.json() as { quote?: TransactionQuote; error?: string; code?: unknown; capabilities?: TradeCapabilities };
      if (requestIdRef.current !== requestId) return;
      if (!response.ok) {
        failureCode = normalizeQuoteFailureCode(payload.code);
        throw new Error(t(`trade.error.code.${failureCode}` as TranslationKey));
      }
      if (!payload.quote || !validateTransactionQuote(payload.quote) || !isQuoteFingerprintValid(payload.quote)) {
        failureCode = "invalid-provider-response";
        throw new Error(t("trade.error.code.invalid-provider-response"));
      }
      setQuote(payload.quote); setCapabilities(payload.capabilities ?? capabilities); setQuoteStatus("ready"); setQuoteFailureCode(undefined);
    } catch (error) {
      if (abortController.signal.aborted) return;
      if (requestIdRef.current === requestId) { setQuoteStatus("error"); setQuoteFailureCode(failureCode ?? "provider-unavailable"); setQuoteError(error instanceof Error ? error.message : t("trade.error.quote")); }
    } finally { if (requestIdRef.current === requestId) { quoteInFlightRef.current = false; if (quoteAbortRef.current === abortController) quoteAbortRef.current = undefined; } }
  }, [amount, capabilities, market.key, side, slippageBps, t, tokens.from, tokens.to, wallet.address]);

  async function loadBalance() {
    if (!wallet.address || !tokens.from || balanceLoading) return;
    setBalanceLoading(true);
    try {
      const data = buildBalanceOfData(wallet.address);
      if (!data) throw new Error(t("trade.error.balance"));
      const result = await wallet.readContract(tokens.from.address, data);
      setBalanceRaw(BigInt(result || "0x0").toString());
    } catch { setQuoteError(t("trade.error.balance")); }
    finally { setBalanceLoading(false); }
  }

  async function openReview() {
    if (!quote || !wallet.address || !tokens.from || !tokens.to) return;
    const reason = getQuoteInvalidationReason(quote, currentQuoteContext(quote, tokens, wallet.address, market.key, side, amount, slippageBps));
    if (reason || !isQuoteFingerprintValid(quote)) { setQuote(undefined); setQuoteStatus("idle"); setQuoteError(t("trade.error.stale")); return; }
    setTransactionStatus("simulating");
    try {
      const allowanceEnough = await hasAllowance(quote);
      setApprovalRequired(!allowanceEnough);
      if (allowanceEnough) { await wallet.simulateTransaction(quote.transaction); setSimulationPassed(true); }
      else setSimulationPassed(false);
      setReviewOpen(true); overlay.open("transaction_review", { pairId: pair.id, side }); setTransactionStatus("idle");
    } catch { setTransactionStatus("failed"); setQuoteError(t("trade.error.simulation")); }
  }

  async function hasAllowance(currentQuote: TransactionQuote) {
    if (!currentQuote.approvalAddress) return true;
    const data = buildAllowanceData(currentQuote.walletAddress, currentQuote.approvalAddress);
    if (!data) return false;
    const raw = await wallet.readContract(currentQuote.fromToken.address, data);
    return BigInt(raw || "0x0") >= BigInt(currentQuote.fromAmountRaw);
  }

  async function approveExactAmount() {
    if (!quote || !quote.approvalAddress || transactionInFlightRef.current) return;
    const data = buildExactApprovalData(quote.approvalAddress, quote.fromAmountRaw);
    if (!data) return;
    transactionInFlightRef.current = true;
    setTransactionStatus("simulating");
    try {
      const draft: TransactionDraft = { from: quote.walletAddress, to: quote.fromToken.address, data, value: "0x0", chainId: BASE_CHAIN_ID };
      const simulation = await wallet.simulateTransaction(draft);
      setTransactionStatus("awaiting-wallet");
      const hash = await wallet.sendTransaction({ ...draft, gasLimit: simulation.gasLimit });
      setTransactionHash(hash); persistTransaction(hash, "submitted"); setTransactionStatus("submitted");
      const confirmed = await waitForReceipt(hash);
      setTransactionStatus(confirmed ? "confirmed" : "pending");
      persistTransaction(hash, confirmed ? "confirmed" : "pending");
      if (confirmed) { setQuote(undefined); setQuoteStatus("idle"); setReviewOpen(false); setQuoteError(t("trade.approvalRefresh")); }
    } catch (error) { setTransactionStatus(isRejected(error) ? "rejected" : "failed"); }
    finally { transactionInFlightRef.current = false; }
  }

  async function sendSwap() {
    if (!quote || !wallet.address || transactionInFlightRef.current) return;
    const reason = getQuoteInvalidationReason(quote, currentQuoteContext(quote, tokens, wallet.address, market.key, side, amount, slippageBps));
    if (reason || !validateTransactionQuote(quote) || !isQuoteFingerprintValid(quote)) { setQuote(undefined); setReviewOpen(false); setQuoteError(t("trade.error.stale")); return; }
    transactionInFlightRef.current = true; setTransactionStatus("simulating");
    try {
      if (!(await hasSufficientBalance(quote))) { setTransactionStatus("idle"); setQuoteError(t("trade.error.insufficientBalance")); return; }
      if (!(await hasAllowance(quote))) { setApprovalRequired(true); setSimulationPassed(false); setTransactionStatus("idle"); return; }
      const simulation = await wallet.simulateTransaction(quote.transaction);
      setSimulationPassed(true); setTransactionStatus("awaiting-wallet");
      const hash = await wallet.sendTransaction({ ...quote.transaction, gasLimit: simulation.gasLimit });
      setTransactionHash(hash); persistTransaction(hash, "submitted"); setTransactionStatus("submitted");
      const confirmed = await waitForReceipt(hash);
      setTransactionStatus(confirmed ? "confirmed" : "pending");
      persistTransaction(hash, confirmed ? "confirmed" : "pending");
      if (confirmed) setReviewOpen(false);
    } catch (error) { setTransactionStatus(isRejected(error) ? "rejected" : "failed"); }
    finally { transactionInFlightRef.current = false; }
  }

  async function hasSufficientBalance(currentQuote: TransactionQuote) {
    if (isNativeToken(currentQuote.fromToken)) {
      const raw = parseHumanTokenAmount(wallet.balanceEth ?? "", currentQuote.fromToken.decimals);
      return raw !== undefined && BigInt(raw) >= BigInt(currentQuote.fromAmountRaw);
    }
    const data = buildBalanceOfData(currentQuote.walletAddress);
    if (!data) return false;
    const raw = await wallet.readContract(currentQuote.fromToken.address, data);
    return BigInt(raw || "0x0") >= BigInt(currentQuote.fromAmountRaw);
  }

  async function waitForReceipt(hash: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (!mountedRef.current) return false;
      const receipt = await wallet.readTransactionReceipt(hash);
      if (receipt) {
        const status = receipt.status;
        if (status === "0x0") throw new Error("Transaction failed");
        return status === "0x1" || status === 1;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    return false;
  }

  const output = quote ? formatRawTokenAmount(quote.expectedAmountRaw, quote.toToken.decimals) : undefined;
  const minimum = quote ? formatRawTokenAmount(quote.minimumAmountRaw, quote.toToken.decimals) : undefined;
  const balance = balanceRaw && quote?.fromToken ? formatRawTokenAmount(balanceRaw, quote.fromToken.decimals) : undefined;
  const quoteExpired = quote ? Date.parse(quote.expiresAt) <= now : false;
  const quoteAgeSeconds = quote ? Math.max(0, Math.floor((now - Date.parse(quote.createdAt)) / 1_000)) : 0;

  return <aside className="pulse-surface min-w-0 rounded-xl" data-testid="trade-dock" data-tradeability-status={tradeability.status} onFocusCapture={() => onInteractionChange(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onInteractionChange(false); }}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-base-line/60 px-3 py-2"><div className="flex min-w-0 items-center gap-2"><PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} baseAddress={pair.baseTokenAddress} quoteAddress={pair.quoteTokenAddress} baseName={pair.project} chainId={pair.chainId} observedAt={pair.sourceUpdatedAt} size="md" /><div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("trade.dock")}</p><h2 className="mt-0.5 truncate text-[13px] font-semibold">{pair.pair}</h2></div></div><AssetTradeabilityBadges pair={pair} compact={false} /></header>
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 rounded-sm bg-base-elevated p-1" role="tablist" aria-label={t("trade.side")}><button type="button" role="tab" aria-selected={side === "buy"} onClick={() => onSideChange("buy")} className={cx("min-h-10 rounded-sm text-[11px] font-bold", side === "buy" ? "bg-base-mint/15 text-base-mint" : "text-base-muted")}>{t("trade.buy")}</button><button type="button" role="tab" aria-selected={side === "sell"} onClick={() => onSideChange("sell")} className={cx("min-h-10 rounded-sm text-[11px] font-bold", side === "sell" ? "bg-base-rose/15 text-base-rose" : "text-base-muted")}>{t("trade.sell")}</button></div>
      <div className="rounded-lg border border-base-line bg-base-panel p-3"><div className="flex items-center justify-between text-[9px] text-base-muted"><span>{t("wallet.from")}</span><button type="button" disabled={!connected || balanceLoading || !tokens.from?.address} onClick={() => void loadBalance()} className="min-h-8 underline disabled:no-underline disabled:opacity-50">{balanceLoading ? t("common.checking") : balance ? t("trade.balance", { value: balance }) : t("trade.loadBalance")}</button></div><div className="mt-1 grid grid-cols-[minmax(0,1fr)_94px] items-center gap-2"><input aria-label={t("wallet.amountLabel", { label: t("wallet.from") })} inputMode="decimal" value={amount} onChange={(event) => onAmountChange(event.target.value)} className="min-w-0 bg-transparent font-mono text-[22px] outline-none" /><span className="truncate rounded-full bg-base-elevated px-2 py-1 text-right font-mono text-[11px]">{tokens.from?.symbol ?? "N/A"}</span></div>{balanceRaw && quote?.fromToken ? <div className="mt-2 grid grid-cols-4 gap-1">{[25, 50, 75, 100].map((percent) => <button key={percent} type="button" onClick={() => onAmountChange(formatPercentOfBalance(balanceRaw, quote.fromToken.decimals, percent))} className="min-h-8 rounded-sm bg-base-elevated text-[9px] text-base-muted">{percent === 100 ? t("trade.max") : `${percent}%`}</button>)}</div> : null}</div>
      <div className="rounded-lg border border-base-line bg-base-panel p-3"><p className="text-[9px] text-base-muted">{quote ? t("trade.expected") : t("trade.indicative")}</p><div className="mt-1 flex items-center justify-between"><span className="font-mono text-[20px]">{output ?? "—"}</span><span className="rounded-full bg-base-elevated px-2 py-1 font-mono text-[11px]">{tokens.to?.symbol ?? "N/A"}</span></div><p className="mt-2 text-[9px] text-base-muted">{t("trade.marketContext", { price: pair.priceUsd, liquidity: formatCompactCurrency(pair.liquidity) })}</p></div>
      <label className="flex items-center justify-between rounded-sm bg-base-elevated px-2 py-1.5 text-[10px] text-base-muted"><span>{t("trade.slippage")}</span><select value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value))} className="h-8 rounded-sm bg-base-panel px-2 font-mono text-[10px]"><option value={25}>0.25%</option><option value={50}>0.50%</option><option value={100}>1.00%</option></select></label>
      {quote ? <div className="space-y-1 rounded-lg bg-base-elevated/60 p-3 text-[10px]"><QuoteLine label={t("trade.provider")} value={`${quote.provider} · ${quote.route}`} /><QuoteLine label={t("trade.minimum")} value={`${minimum ?? "N/A"} ${quote.toToken.symbol}`} critical /><QuoteLine label={t("trade.priceImpact")} value={quote.priceImpactPercent === undefined ? t("common.unavailable") : `${quote.priceImpactPercent}%`} /><QuoteLine label={t("trade.gasEstimate")} value={formatGasEstimate(quote.gasEstimate) ?? t("common.unavailable")} /><QuoteLine label={t("trade.networkFee")} value={quote.networkFeeUsd ? `$${quote.networkFeeUsd}` : t("common.unavailable")} /><QuoteLine label={t("trade.providerFees")} value={formatProviderFees(quote, t("trade.noProviderFee"))} /><QuoteLine label={t("trade.quoteAge")} value={t("trade.quoteAgeSeconds", { count: quoteAgeSeconds })} /><QuoteLine label={t("trade.quoteExpiry")} value={new Date(quote.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} critical={quoteExpired} /></div> : null}
      {quoteError ? <p role="alert" className="rounded-sm border border-base-amber/30 bg-base-amber/10 p-2 text-[10px] leading-5 text-base-amber"><AlertTriangle size={12} className="mr-1 inline" />{quoteError}</p> : null}
      {!walletConnected ? <button type="button" onClick={wallet.openPicker} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm bg-base-mint text-[11px] font-bold text-[#031411]"><WalletCards size={14} />{t("wallet.connect")}</button> : wallet.wrongNetwork ? <button type="button" onClick={() => void wallet.switchToBase()} className="min-h-11 w-full rounded-sm bg-base-amber/15 text-[11px] font-bold text-base-amber">{t("wallet.switchBase")}</button> : !quote ? <button type="button" disabled={!capabilities?.quoteRequestEnabled || !exactTokensAvailable || quoteStatus === "loading" || !amount.trim()} onClick={() => void requestQuote()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm bg-base-mint text-[11px] font-bold text-[#031411] disabled:cursor-not-allowed disabled:bg-base-raised disabled:text-base-muted">{quoteStatus === "loading" ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}{quoteStatus === "loading" ? t("trade.fetchingQuote") : t("trade.getQuote")}</button> : <button ref={reviewTriggerRef} type="button" disabled={!capabilities?.transactionExecutionEnabled || quoteExpired || transactionStatus === "simulating"} onClick={() => void openReview()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm bg-base-mint text-[11px] font-bold text-[#031411] disabled:bg-base-raised disabled:text-base-muted">{transactionStatus === "simulating" ? <LoaderCircle size={14} className="animate-spin" /> : <LockKeyhole size={14} />}{capabilities?.transactionExecutionEnabled ? t("trade.review") : t("trade.executionDisabled")}</button>}
      <p className="text-[9px] leading-4 text-base-muted">{!exactTokensAvailable ? t("trade.exactTokensUnavailable") : marketDataMode === "mock" ? t("trade.mockDisabled") : capabilities?.transactionExecutionEnabled ? t("trade.explicitActions") : t("trade.stagingOnly")}</p>
      {transactionHash ? <a href={`https://basescan.org/tx/${transactionHash}`} target="_blank" rel="noopener noreferrer" className="flex min-h-9 items-center justify-between rounded-sm bg-base-elevated px-2 font-mono text-[9px] text-base-mint"><span>{transactionHash.slice(0, 10)}…{transactionHash.slice(-8)}</span><ExternalLink size={11} /></a> : null}
    </div>
    {reviewOpen && quote && overlay.active.type === "transaction_review" ? <div className="fixed inset-0 z-[90] grid place-items-end bg-black/70 p-0 sm:place-items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewOpen(false); }}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="trade-review-title" className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-base-line bg-base-panel p-4 shadow-2xl sm:max-w-lg sm:rounded-xl" data-testid="trade-review-dialog"><header className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("trade.reviewEyebrow")}</p><h2 id="trade-review-title" className="mt-1 text-lg font-semibold">{t("trade.reviewTitle")}</h2><AssetTradeabilityBadges pair={pair} compact={false} className="mt-2" /></div><button type="button" onClick={() => { setReviewOpen(false); reviewTriggerRef.current?.focus(); }} className="grid h-11 w-11 place-items-center rounded-sm bg-base-elevated" aria-label={t("trade.closeReview")}><X size={16} /></button></header><div className="mt-4 space-y-2 rounded-lg bg-base-elevated/60 p-3 text-[11px]"><QuoteLine label={t("trade.spend")} value={`${quote.amount} ${quote.fromToken.symbol}`} critical /><QuoteLine label={t("trade.expected")} value={`${output ?? "N/A"} ${quote.toToken.symbol}`} /><QuoteLine label={t("trade.minimum")} value={`${minimum ?? "N/A"} ${quote.toToken.symbol}`} critical /><QuoteLine label={t("trade.provider")} value={`${quote.provider} · ${quote.route}`} /><QuoteLine label={t("trade.slippage")} value={`${quote.slippageBps / 100}%`} /><QuoteLine label={t("trade.priceImpact")} value={quote.priceImpactPercent === undefined ? t("common.unavailable") : `${quote.priceImpactPercent}%`} /><QuoteLine label={t("trade.gasEstimate")} value={formatGasEstimate(quote.gasEstimate) ?? t("common.unavailable")} /><QuoteLine label={t("trade.networkFee")} value={quote.networkFeeUsd ? `$${quote.networkFeeUsd}` : t("common.unavailable")} /><QuoteLine label={t("trade.providerFees")} value={formatProviderFees(quote, t("trade.noProviderFee"))} /><QuoteLine label={t("trade.approvalStatus")} value={approvalRequired ? t("trade.approvalRequired") : t("trade.approvalNotRequired")} critical={approvalRequired} /><QuoteLine label={t("trade.simulation")} value={simulationPassed ? t("trade.simulationPassed") : approvalRequired ? t("trade.afterApproval") : t("trade.simulationRequired")} critical={!simulationPassed} /><QuoteLine label={t("trade.quoteExpiry")} value={new Date(quote.expiresAt).toLocaleTimeString()} critical /></div><div className="mt-4 rounded-sm border border-base-amber/30 bg-base-amber/10 p-3 text-[10px] leading-5 text-base-amber">{t("trade.walletOwnsConfirmation")}</div><div className="mt-4 grid gap-2">{approvalRequired ? <button type="button" disabled={transactionInFlightRef.current} onClick={() => void approveExactAmount()} className="min-h-12 rounded-sm bg-base-amber/15 text-[11px] font-bold text-base-amber disabled:opacity-50">{t("trade.approveExact", { amount: quote.amount, symbol: quote.fromToken.symbol })}</button> : <button type="button" disabled={!simulationPassed || transactionInFlightRef.current} onClick={() => void sendSwap()} className="min-h-12 rounded-sm bg-base-mint text-[11px] font-bold text-[#031411] disabled:bg-base-raised disabled:text-base-muted">{transactionStatus === "awaiting-wallet" ? t("trade.confirmInWallet") : transactionStatus === "submitted" || transactionStatus === "pending" ? t("trade.pending") : t("trade.confirmSwap")}</button>}<button type="button" onClick={() => setReviewOpen(false)} className="min-h-11 rounded-sm bg-base-elevated text-[11px] text-base-muted">{t("trade.cancel")}</button></div>{transactionStatus !== "idle" ? <p className="mt-3 flex items-center gap-2 text-[10px] text-base-muted">{transactionStatus === "confirmed" ? <CheckCircle2 size={13} className="text-base-mint" /> : <LoaderCircle size={13} className={transactionStatus === "pending" || transactionStatus === "submitted" ? "animate-spin" : ""} />}{t(`trade.status.${transactionStatus}`)}</p> : null}</div></div> : null}
  </aside>;
}

function getTradeTokens(pair: BasePair, side: TradeSide): { from?: Omit<TradeToken, "decimals">; to?: Omit<TradeToken, "decimals"> } {
  const base = pair.baseTokenAddress ? { address: pair.baseTokenAddress, symbol: pair.baseToken } : undefined;
  const quote = pair.quoteTokenAddress ? { address: pair.quoteTokenAddress, symbol: pair.quoteToken } : undefined;
  return side === "buy" ? { from: quote, to: base } : { from: base, to: quote };
}

function currentQuoteContext(quote: TransactionQuote, tokens: ReturnType<typeof getTradeTokens>, walletAddress: string, pairKey: string, side: TradeSide, amount: string, slippageBps: number): QuoteInvalidationInput {
  return {
    walletAddress,
    pairKey,
    side,
    chainId: BASE_CHAIN_ID,
    fromToken: tokens.from ? { ...tokens.from, decimals: quote.fromToken.decimals } : { ...quote.fromToken, address: "" },
    toToken: tokens.to ? { ...tokens.to, decimals: quote.toToken.decimals } : { ...quote.toToken, address: "" },
    amount,
    slippageBps
  };
}

async function fetchTradeCapabilities(): Promise<TradeCapabilities> {
  const response = await fetch("/api/health", { cache: "no-store" });
  if (!response.ok) throw new Error("Health unavailable");
  const value = await response.json() as Partial<TradeCapabilities> & { quoteProviders?: TradeCapabilities["providers"] };
  return {
    quoteRequestEnabled: Boolean(value.quoteRequestEnabled),
    transactionExecutionEnabled: Boolean(value.transactionExecutionEnabled),
    approvalRequestEnabled: Boolean(value.approvalRequestEnabled),
    swapRequestEnabled: Boolean(value.swapRequestEnabled),
    providers: value.quoteProviders ?? value.providers ?? []
  };
}

function disabledTradeCapabilities(): TradeCapabilities {
  return { quoteRequestEnabled: false, transactionExecutionEnabled: false, approvalRequestEnabled: false, swapRequestEnabled: false, providers: [] };
}

function QuoteLine({ label, value, critical = false }: { label: string; value: string; critical?: boolean }) { return <div className="flex items-start justify-between gap-3"><span className="text-base-muted">{label}</span><span className={cx("max-w-[62%] text-right font-mono", critical ? "font-semibold text-base-text" : "text-base-muted")}>{value}</span></div>; }

function formatPercentOfBalance(balanceRaw: string, decimals: number, percent: number) {
  const raw = BigInt(balanceRaw) * BigInt(percent) / BigInt(100);
  return formatRawTokenAmount(raw.toString(), decimals, decimals) ?? "0";
}

function formatGasEstimate(value: string | undefined) {
  if (!value) return undefined;
  try { return BigInt(value).toLocaleString("en-US"); }
  catch { return undefined; }
}

function formatProviderFees(quote: TransactionQuote, emptyLabel: string) {
  return quote.fees.length ? quote.fees.map((fee) => `${fee.name}${fee.amountUsd ? ` $${fee.amountUsd}` : ""}`).join(", ") : emptyLabel;
}

function isRejected(error: unknown) { return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 4001); }

function normalizeQuoteFailureCode(value: unknown): QuoteFailureCode {
  const supported: QuoteFailureCode[] = ["no-route", "unsupported-token", "invalid-amount", "rate-limited", "timeout", "provider-unavailable", "invalid-provider-response", "expired", "capability-disabled", "token-metadata-invalid", "invalid-request"];
  return typeof value === "string" && supported.includes(value as QuoteFailureCode) ? value as QuoteFailureCode : "provider-unavailable";
}

function persistTransaction(hash: string, status: "submitted" | "pending" | "confirmed" | "replaced") {
  safeSetStorageItem(LAST_TRANSACTION_KEY, JSON.stringify({ hash, status, chainId: BASE_CHAIN_ID, updatedAt: new Date().toISOString() }));
}

function readStoredTransaction(): { hash: string; status: "submitted" | "pending" | "confirmed" | "replaced" } | undefined {
  const raw = safeGetStorageItem(LAST_TRANSACTION_KEY);
  if (!raw) return undefined;
  if (/^0x[0-9a-f]{64}$/i.test(raw)) return { hash: raw, status: "submitted" };
  try {
    const value = JSON.parse(raw) as { hash?: unknown; status?: unknown; chainId?: unknown };
    if (typeof value.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(value.hash) || value.chainId !== BASE_CHAIN_ID) return undefined;
    if (value.status !== "submitted" && value.status !== "pending" && value.status !== "confirmed" && value.status !== "replaced") return undefined;
    return { hash: value.hash, status: value.status };
  } catch { return undefined; }
}
