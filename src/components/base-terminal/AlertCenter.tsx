"use client";

import { Bell, BellRing, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import {
  createAlertRule,
  evaluateAlertRules,
  type AlertMetric,
  type AlertTrigger,
  type LocalAlertRule
} from "@/lib/base-terminal/alerts";
import type { PulseSignal } from "@/lib/base-terminal/pulse";
import { cx } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { parseLocaleDecimalInput } from "@/lib/marketMath";
import { safeGetStorageItem, safeSetStorageItem } from "@/lib/safeStorage";
import { getMarketInvariantAttributes } from "@/lib/base-terminal/marketModel";

const ALERT_RULES_STORAGE_KEY = "mergen-pulse:alert-rules:v1";
const ALERT_TRIGGER_STORAGE_KEY = "mergen-pulse:alert-triggers:v1";

const METRICS: Array<{ id: AlertMetric; labelKey: TranslationKey; threshold: boolean; placeholder?: string }> = [
  { id: "price_above", labelKey: "alerts.priceAbove", threshold: true, placeholder: "USD" },
  { id: "price_below", labelKey: "alerts.priceBelow", threshold: true, placeholder: "USD" },
  { id: "change_5m", labelKey: "alerts.change5m", threshold: true, placeholder: "%" },
  { id: "change_1h", labelKey: "alerts.change1h", threshold: true, placeholder: "%" },
  { id: "change_24h", labelKey: "alerts.change24h", threshold: true, placeholder: "%" },
  { id: "volume_24h", labelKey: "alerts.volume24h", threshold: true, placeholder: "USD" },
  { id: "liquidity", labelKey: "alerts.liquidity", threshold: true, placeholder: "USD" },
  { id: "enters_trending", labelKey: "alerts.entersTrending", threshold: false },
  { id: "new_pair", labelKey: "alerts.newPair", threshold: false },
  { id: "watchlist_move", labelKey: "alerts.watchlistMove", threshold: false }
];

export function AlertCenter({
  snapshot,
  selectedPair,
  signals,
  embedded = false
}: {
  snapshot: MarketTerminalSnapshot;
  selectedPair: BasePair;
  signals: PulseSignal[];
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(embedded);
  const [rules, setRules] = useState<LocalAlertRule[]>([]);
  const [triggers, setTriggers] = useState<AlertTrigger[]>([]);
  const [metric, setMetric] = useState<AlertMetric>("price_above");
  const [threshold, setThreshold] = useState("");
  const [thresholdError, setThresholdError] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string>();
  const [notificationState, setNotificationState] = useState<NotificationPermission | "unsupported">("default");
  const [loaded, setLoaded] = useState(false);
  const previousSnapshotRef = useRef(snapshot);
  const sectionRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const metricSelectRef = useRef<HTMLSelectElement>(null);
  const selectedMetric = METRICS.find((item) => item.id === metric)!;

  useEffect(() => {
    setRules(readStoredArray(ALERT_RULES_STORAGE_KEY, isStoredAlertRule).slice(0, 40));
    setTriggers(readStoredArray(ALERT_TRIGGER_STORAGE_KEY, isStoredAlertTrigger).slice(0, 30));
    setNotificationState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    safeSetStorageItem(ALERT_RULES_STORAGE_KEY, JSON.stringify(rules));
  }, [loaded, rules]);

  useEffect(() => {
    if (!loaded) return;
    safeSetStorageItem(ALERT_TRIGGER_STORAGE_KEY, JSON.stringify(triggers.slice(0, 30)));
  }, [loaded, triggers]);

  useEffect(() => {
    if (!loaded || previousSnapshotRef.current.generatedAt === snapshot.generatedAt) return;
    const result = evaluateAlertRules({
      rules,
      previous: previousSnapshotRef.current,
      current: snapshot,
      signals
    });
    previousSnapshotRef.current = snapshot;
    if (result.triggers.length === 0) return;
    setRules(result.rules);
    setTriggers((current) => [...result.triggers, ...current].slice(0, 30));
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const trigger of result.triggers.slice(0, 3)) {
        const copy = localizedTrigger(trigger, result.rules.find((rule) => rule.id === trigger.ruleId), t);
        try {
          new Notification(copy.title, { body: copy.detail, tag: trigger.ruleId });
        } catch {
          // In-app alert history remains authoritative when OS notifications fail.
        }
      }
    }
  }, [loaded, rules, signals, snapshot, t]);

  useEffect(() => {
    if (embedded || !open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      setEditingRuleId(undefined);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
    function handlePointerDown(event: PointerEvent) {
      if (sectionRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setEditingRuleId(undefined);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [embedded, open]);

  const activeRules = useMemo(() => rules.filter((rule) => rule.enabled), [rules]);

  function saveRule() {
    const parsedThreshold = selectedMetric.threshold ? parseLocaleDecimalInput(threshold) : undefined;
    if (selectedMetric.threshold && !isValidAlertThreshold(metric, parsedThreshold)) {
      setThresholdError(true);
      return;
    }
    if (editingRuleId) {
      setRules((current) => current.map((item) => item.id === editingRuleId ? {
        ...item,
        pairId: metric === "new_pair" ? undefined : selectedPair.id,
        pairLabel: metric === "new_pair" ? t("alerts.anyPair") : selectedPair.pair,
        metric,
        threshold: parsedThreshold,
        lastTriggeredAt: undefined
      } : item));
    } else {
      const rule = createAlertRule({
        pairId: metric === "new_pair" ? undefined : selectedPair.id,
        pairLabel: metric === "new_pair" ? t("alerts.anyPair") : selectedPair.pair,
        metric,
        threshold: parsedThreshold
      });
      setRules((current) => [rule, ...current].slice(0, 40));
    }
    setThreshold("");
    setThresholdError(false);
    setEditingRuleId(undefined);
  }

  function startEditing(rule: LocalAlertRule) {
    setEditingRuleId(rule.id);
    setMetric(rule.metric);
    setThreshold(rule.threshold === undefined ? "" : String(rule.threshold));
    setThresholdError(false);
    requestAnimationFrame(() => metricSelectRef.current?.focus());
  }

  function cancelEditing() {
    setEditingRuleId(undefined);
    setMetric("price_above");
    setThreshold("");
    setThresholdError(false);
  }

  function closePanel() {
    setOpen(false);
    setEditingRuleId(undefined);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") {
      setNotificationState("unsupported");
      return;
    }
    setNotificationState(await Notification.requestPermission());
  }

  return (
    <section ref={sectionRef} {...getMarketInvariantAttributes(selectedPair)} id="alerts" className="relative" data-testid="alert-center">
      {!embedded ? <button
        ref={triggerRef}
        type="button"
        onClick={() => open ? closePanel() : setOpen(true)}
        className={cx("inline-flex h-9 items-center gap-2 rounded-pill bg-surface-interactive px-3 text-meta font-semibold text-content-secondary outline-none hover:text-content-primary focus-visible:ring-2 focus-visible:ring-focus", open && "bg-surface-selected text-content-primary")}
        aria-expanded={open}
        aria-controls="alert-center-panel"
      >
        {triggers.length > 0 ? <BellRing size={14} className="text-freshness-delayed" aria-hidden="true" /> : <Bell size={14} aria-hidden="true" />}
        {t("alerts.title")}
        <span className="rounded-pill bg-surface-panel px-2 font-mono text-meta">{activeRules.length}</span>
      </button> : null}

      {open ? (
        <div id="alert-center-panel" data-testid="alert-center-panel" className={cx("mt-2 w-full rounded-panel bg-surface-panel p-3 shadow-popover ring-1 ring-border-subtle", !embedded && "lg:absolute lg:right-0 lg:z-layer-popover lg:w-popover")} role={embedded ? "region" : "dialog"} aria-label={t("alerts.center")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">{t("alerts.center")}</p>
              <h3 className="mt-1 text-title-sm font-semibold text-content-primary">{t("alerts.local")}</h3>
              <p className="mt-1 text-meta text-content-secondary">{t("alerts.description")}</p>
            </div>
            {!embedded ? <button type="button" onClick={closePanel} className="grid h-8 w-8 place-items-center rounded-pill bg-surface-interactive text-content-secondary" aria-label={t("alerts.close")}><X size={13} /></button> : null}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
            <label className="block"><span className="sr-only">{t("alerts.condition")}</span><select ref={metricSelectRef} value={metric} onChange={(event) => { setMetric(event.target.value as AlertMetric); setThresholdError(false); }} className="h-10 w-full rounded-card border border-border-subtle bg-surface-interactive px-2 text-meta text-content-primary outline-none">{METRICS.map((item) => <option key={item.id} value={item.id}>{t(item.labelKey)}</option>)}</select></label>
            {selectedMetric.threshold ? <label><span className="sr-only">{t("alerts.threshold")}</span><input value={threshold} onChange={(event) => { setThreshold(event.target.value); setThresholdError(false); }} inputMode="decimal" placeholder={selectedMetric.placeholder} aria-invalid={thresholdError} aria-describedby={thresholdError ? "alert-threshold-error" : undefined} className="h-10 w-full rounded-card border border-border-subtle bg-surface-interactive px-2 font-mono text-meta text-content-primary outline-none aria-[invalid=true]:border-market-negative" /></label> : <div className="hidden sm:block" />}
            <button type="button" onClick={saveRule} className="inline-flex h-10 items-center justify-center gap-2 rounded-card bg-brand-action px-3 text-meta font-bold text-content-on-accent">{editingRuleId ? <Check size={13} /> : <Plus size={13} />} {t(editingRuleId ? "alerts.save" : "alerts.add")}</button>
          </div>
          {editingRuleId ? <button type="button" onClick={cancelEditing} className="mt-2 text-meta font-semibold text-content-secondary underline-offset-2 hover:text-content-primary hover:underline">{t("alerts.cancelEdit")}</button> : null}
          {thresholdError ? <p id="alert-threshold-error" className="mt-2 text-meta text-market-negative" role="alert">{t("alerts.invalidThreshold")}</p> : null}
          <p className="mt-2 text-meta text-content-secondary">{t("alerts.target", { target: metric === "new_pair" ? t("alerts.anyPair") : selectedPair.pair, timeframe: alertTimeframe(metric, t) })}</p>

          <div className="mt-3 max-h-[220px] space-y-2 overflow-y-auto">
            {rules.length > 0 ? rules.map((rule) => (
              <div key={rule.id} data-testid="alert-rule" className="flex items-center gap-2 rounded-card bg-surface-interactive/70 px-3 py-2">
                <button type="button" role="switch" aria-checked={rule.enabled} onClick={() => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item))} className={cx("h-5 w-9 rounded-pill p-1 transition", rule.enabled ? "bg-brand-action" : "bg-border-subtle")} aria-label={t("alerts.toggle", { condition: metricLabel(rule.metric, t) })}><span className={cx("block h-4 w-4 rounded-pill bg-surface-canvas transition", rule.enabled && "translate-x-4")} /></button>
                <span className="min-w-0 flex-1"><span className="block truncate text-meta font-semibold text-content-primary">{rule.pairLabel}</span><span className="block text-meta text-content-secondary">{metricLabel(rule.metric, t)}{rule.threshold !== undefined ? ` ${rule.threshold}` : ""} · {alertTimeframe(rule.metric, t)}</span></span>
                <button type="button" onClick={() => startEditing(rule)} className="grid h-7 w-7 place-items-center text-content-secondary hover:text-content-primary" aria-label={t("alerts.edit")}><Pencil size={12} /></button>
                <button type="button" onClick={() => { setRules((current) => current.filter((item) => item.id !== rule.id)); if (editingRuleId === rule.id) cancelEditing(); }} className="grid h-7 w-7 place-items-center text-content-secondary hover:text-market-negative" aria-label={t("alerts.delete")}><Trash2 size={12} /></button>
              </div>
            )) : <p className="rounded-card bg-surface-interactive/55 p-3 text-meta text-content-secondary">{t("alerts.noRules")}</p>}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle/60 pt-3">
            <p className="text-meta text-content-secondary">{t("alerts.inApp")}</p>
            {notificationState !== "granted" ? <button type="button" onClick={() => void enableNotifications()} className="rounded-pill bg-surface-interactive px-3 py-2 text-meta font-semibold text-content-primary">{t("alerts.enableNotifications")}</button> : <span className="text-meta font-semibold text-operation-success">{t("alerts.notificationsEnabled")}</span>}
          </div>

          {triggers.length > 0 ? <div className="mt-3 space-y-2 border-t border-border-subtle/60 pt-3">{triggers.slice(0, 3).map((trigger) => {
            const rule = rules.find((item) => item.id === trigger.ruleId);
            const copy = localizedTrigger(trigger, rule, t);
            return <div key={trigger.key} className="rounded-card bg-freshness-delayed/10 p-2 text-meta"><p className="font-semibold text-content-primary">{copy.title}</p><p className="mt-1 text-content-secondary">{copy.detail} · {trigger.source} · {rule ? alertTimeframe(rule.metric, t) : trigger.timeframe}</p></div>;
          })}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

function readStoredArray<T>(key: string, guard: (value: unknown) => value is T): T[] {
  try {
    const value = safeGetStorageItem(key);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter(guard) : [];
  } catch {
    return [];
  }
}

function isValidAlertThreshold(metric: AlertMetric, value: number | undefined): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return metric.startsWith("change_") || value > 0;
}

function isStoredAlertRule(value: unknown): value is LocalAlertRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Partial<LocalAlertRule>;
  return isStoredText(rule.id, 160) &&
    METRICS.some((metric) => metric.id === rule.metric) &&
    isStoredText(rule.createdAt, 40) && Number.isFinite(Date.parse(rule.createdAt)) &&
    typeof rule.cooldownMs === "number" && Number.isFinite(rule.cooldownMs) && rule.cooldownMs >= 0 && rule.cooldownMs <= 24 * 60 * 60_000 &&
    typeof rule.enabled === "boolean" &&
    (rule.pairId === undefined || isStoredText(rule.pairId, 180)) &&
    (rule.pairLabel === undefined || isStoredText(rule.pairLabel, 100)) &&
    (rule.lastTriggeredAt === undefined || (isStoredText(rule.lastTriggeredAt, 40) && Number.isFinite(Date.parse(rule.lastTriggeredAt)))) &&
    (rule.threshold === undefined || isValidAlertThreshold(rule.metric!, rule.threshold));
}

function isStoredAlertTrigger(value: unknown): value is AlertTrigger {
  if (!value || typeof value !== "object") return false;
  const trigger = value as Partial<AlertTrigger>;
  return isStoredText(trigger.key, 220) && isStoredText(trigger.ruleId, 160) &&
    (trigger.pairId === undefined || isStoredText(trigger.pairId, 180)) &&
    isStoredText(trigger.title, 180) && isStoredText(trigger.detail, 500) &&
    isStoredText(trigger.source, 100) && isStoredText(trigger.timeframe, 40) &&
    isStoredText(trigger.triggeredAt, 40) && Number.isFinite(Date.parse(trigger.triggeredAt));
}

function isStoredText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function metricLabel(metric: AlertMetric, t: (key: TranslationKey) => string) {
  const key = METRICS.find((item) => item.id === metric)?.labelKey;
  return key ? t(key) : metric;
}

function alertTimeframe(metric: AlertMetric, t?: (key: TranslationKey) => string) {
  if (metric === "change_5m") return "5m";
  if (metric === "change_1h") return "1h";
  if (metric === "change_24h" || metric === "volume_24h") return "24h";
  return t ? t("alerts.snapshot") : "snapshot";
}

function localizedTrigger(trigger: AlertTrigger, rule: LocalAlertRule | undefined, t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  if (!rule) return { title: trigger.title, detail: trigger.detail };
  return {
    title: t("alerts.triggerTitle", { target: rule.pairLabel ?? t("alerts.anyPair") }),
    detail: t("alerts.triggerDetail", {
      condition: metricLabel(rule.metric, t),
      threshold: rule.threshold === undefined ? "" : ` ${rule.threshold}`
    })
  };
}
