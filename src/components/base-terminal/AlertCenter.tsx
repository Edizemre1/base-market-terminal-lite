"use client";

import { Bell, BellRing, Plus, Trash2, X } from "lucide-react";
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
  const [notificationState, setNotificationState] = useState<NotificationPermission | "unsupported">("default");
  const [loaded, setLoaded] = useState(false);
  const previousSnapshotRef = useRef(snapshot);
  const selectedMetric = METRICS.find((item) => item.id === metric)!;

  useEffect(() => {
    setRules(readStoredArray<LocalAlertRule>(ALERT_RULES_STORAGE_KEY));
    setTriggers(readStoredArray<AlertTrigger>(ALERT_TRIGGER_STORAGE_KEY));
    setNotificationState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(ALERT_RULES_STORAGE_KEY, JSON.stringify(rules));
  }, [loaded, rules]);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(ALERT_TRIGGER_STORAGE_KEY, JSON.stringify(triggers.slice(0, 30)));
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
        new Notification(copy.title, { body: copy.detail, tag: trigger.ruleId });
      }
    }
  }, [loaded, rules, signals, snapshot, t]);

  const activeRules = useMemo(() => rules.filter((rule) => rule.enabled), [rules]);

  function addRule() {
    const parsedThreshold = selectedMetric.threshold ? Number.parseFloat(threshold) : undefined;
    if (selectedMetric.threshold && !Number.isFinite(parsedThreshold)) return;
    const rule = createAlertRule({
      pairId: metric === "new_pair" ? undefined : selectedPair.id,
      pairLabel: metric === "new_pair" ? t("alerts.anyPair") : selectedPair.pair,
      metric,
      threshold: parsedThreshold
    });
    setRules((current) => [rule, ...current].slice(0, 40));
    setThreshold("");
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") {
      setNotificationState("unsupported");
      return;
    }
    setNotificationState(await Notification.requestPermission());
  }

  return (
    <section id="alerts" className="relative" data-testid="alert-center">
      {!embedded ? <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cx("inline-flex h-9 items-center gap-2 rounded-full bg-base-elevated px-3 text-[11px] font-semibold text-base-muted outline-none hover:text-base-text focus-visible:ring-2 focus-visible:ring-base-mint/40", open && "bg-base-mint/10 text-base-mint")}
        aria-expanded={open}
        aria-controls="alert-center-panel"
      >
        {triggers.length > 0 ? <BellRing size={14} className="text-base-amber" /> : <Bell size={14} />}
        {t("alerts.title")}
        <span className="rounded-full bg-base-panel px-1.5 font-mono text-[9px]">{activeRules.length}</span>
      </button> : null}

      {open ? (
        <div id="alert-center-panel" data-testid="alert-center-panel" className={cx("mt-2 w-full rounded-xl bg-base-panel p-3 shadow-2xl ring-1 ring-base-line", !embedded && "lg:absolute lg:right-0 lg:z-50 lg:w-[430px]")} role="dialog" aria-label={t("alerts.center")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("alerts.center")}</p>
              <h3 className="mt-1 text-[15px] font-semibold text-base-text">{t("alerts.local")}</h3>
              <p className="mt-1 text-[10px] text-base-muted">{t("alerts.description")}</p>
            </div>
            {!embedded ? <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-full bg-base-elevated text-base-muted" aria-label={t("alerts.close")}><X size={13} /></button> : null}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
            <label className="block"><span className="sr-only">{t("alerts.condition")}</span><select value={metric} onChange={(event) => setMetric(event.target.value as AlertMetric)} className="h-10 w-full rounded-lg border border-base-line bg-base-elevated px-2 text-[11px] text-base-text outline-none">{METRICS.map((item) => <option key={item.id} value={item.id}>{t(item.labelKey)}</option>)}</select></label>
            {selectedMetric.threshold ? <label><span className="sr-only">{t("alerts.threshold")}</span><input value={threshold} onChange={(event) => setThreshold(event.target.value)} inputMode="decimal" placeholder={selectedMetric.placeholder} className="h-10 w-full rounded-lg border border-base-line bg-base-elevated px-2 font-mono text-[11px] text-base-text outline-none" /></label> : <div className="hidden sm:block" />}
            <button type="button" onClick={addRule} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-base-mint px-3 text-[11px] font-bold text-[#031411]"><Plus size={13} /> {t("alerts.add")}</button>
          </div>
          <p className="mt-2 text-[10px] text-base-muted">{t("alerts.target", { target: metric === "new_pair" ? t("alerts.anyPair") : selectedPair.pair, timeframe: alertTimeframe(metric, t) })}</p>

          <div className="mt-3 max-h-[220px] space-y-1.5 overflow-y-auto">
            {rules.length > 0 ? rules.map((rule) => (
              <div key={rule.id} data-testid="alert-rule" className="flex items-center gap-2 rounded-lg bg-base-elevated/70 px-2.5 py-2">
                <button type="button" onClick={() => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item))} className={cx("h-5 w-9 rounded-full p-0.5 transition", rule.enabled ? "bg-base-mint" : "bg-base-line")} aria-label={t("alerts.toggle", { condition: metricLabel(rule.metric, t) })}><span className={cx("block h-4 w-4 rounded-full bg-white transition", rule.enabled && "translate-x-4")} /></button>
                <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold text-base-text">{rule.pairLabel}</span><span className="block text-[10px] text-base-muted">{metricLabel(rule.metric, t)}{rule.threshold !== undefined ? ` ${rule.threshold}` : ""} · {alertTimeframe(rule.metric, t)}</span></span>
                <button type="button" onClick={() => setRules((current) => current.filter((item) => item.id !== rule.id))} className="grid h-7 w-7 place-items-center text-base-muted hover:text-base-rose" aria-label={t("alerts.delete")}><Trash2 size={12} /></button>
              </div>
            )) : <p className="rounded-lg bg-base-elevated/55 p-3 text-[11px] text-base-muted">{t("alerts.noRules")}</p>}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-base-line/60 pt-3">
            <p className="text-[10px] text-base-muted">{t("alerts.inApp")}</p>
            {notificationState !== "granted" ? <button type="button" onClick={() => void enableNotifications()} className="rounded-full bg-base-elevated px-3 py-1.5 text-[10px] font-semibold text-base-text">{t("alerts.enableNotifications")}</button> : <span className="text-[10px] font-semibold text-base-mint">{t("alerts.notificationsEnabled")}</span>}
          </div>

          {triggers.length > 0 ? <div className="mt-3 space-y-1.5 border-t border-base-line/60 pt-3">{triggers.slice(0, 3).map((trigger) => {
            const rule = rules.find((item) => item.id === trigger.ruleId);
            const copy = localizedTrigger(trigger, rule, t);
            return <div key={trigger.key} className="rounded-lg bg-base-amber/10 p-2 text-[10px]"><p className="font-semibold text-base-text">{copy.title}</p><p className="mt-1 text-base-muted">{copy.detail} · {trigger.source} · {rule ? alertTimeframe(rule.metric, t) : trigger.timeframe}</p></div>;
          })}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

function readStoredArray<T>(key: string): T[] {
  try {
    const value = window.localStorage.getItem(key);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
