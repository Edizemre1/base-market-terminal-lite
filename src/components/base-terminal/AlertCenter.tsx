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

const ALERT_RULES_STORAGE_KEY = "mergen-pulse:alert-rules:v1";
const ALERT_TRIGGER_STORAGE_KEY = "mergen-pulse:alert-triggers:v1";

const METRICS: Array<{ id: AlertMetric; label: string; threshold: boolean; placeholder?: string }> = [
  { id: "price_above", label: "Price above", threshold: true, placeholder: "USD price" },
  { id: "price_below", label: "Price below", threshold: true, placeholder: "USD price" },
  { id: "change_5m", label: "5m change ≥", threshold: true, placeholder: "%" },
  { id: "change_1h", label: "1h change ≥", threshold: true, placeholder: "%" },
  { id: "change_24h", label: "24h change ≥", threshold: true, placeholder: "%" },
  { id: "volume_24h", label: "24h volume ≥", threshold: true, placeholder: "USD" },
  { id: "liquidity", label: "Liquidity ≥", threshold: true, placeholder: "USD" },
  { id: "enters_trending", label: "Enters Trending", threshold: false },
  { id: "new_pair", label: "New qualified pair", threshold: false },
  { id: "watchlist_move", label: "Watchlist movement", threshold: false }
];

export function AlertCenter({
  snapshot,
  selectedPair,
  signals
}: {
  snapshot: MarketTerminalSnapshot;
  selectedPair: BasePair;
  signals: PulseSignal[];
}) {
  const [open, setOpen] = useState(false);
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
        new Notification(trigger.title, { body: trigger.detail, tag: trigger.ruleId });
      }
    }
  }, [loaded, rules, signals, snapshot]);

  const activeRules = useMemo(() => rules.filter((rule) => rule.enabled), [rules]);

  function addRule() {
    const parsedThreshold = selectedMetric.threshold ? Number.parseFloat(threshold) : undefined;
    if (selectedMetric.threshold && !Number.isFinite(parsedThreshold)) return;
    const rule = createAlertRule({
      pairId: metric === "new_pair" ? undefined : selectedPair.id,
      pairLabel: metric === "new_pair" ? "Any qualified Base pair" : selectedPair.pair,
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
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cx("inline-flex h-9 items-center gap-2 rounded-full bg-base-elevated px-3 text-[11px] font-semibold text-base-muted outline-none hover:text-base-text focus-visible:ring-2 focus-visible:ring-base-mint/40", open && "bg-base-mint/10 text-base-mint")}
        aria-expanded={open}
        aria-controls="alert-center-panel"
      >
        {triggers.length > 0 ? <BellRing size={14} className="text-base-amber" /> : <Bell size={14} />}
        Alerts
        <span className="rounded-full bg-base-panel px-1.5 font-mono text-[9px]">{activeRules.length}</span>
      </button>

      {open ? (
        <div id="alert-center-panel" data-testid="alert-center-panel" className="mt-2 w-full rounded-xl bg-base-panel p-3 shadow-2xl ring-1 ring-base-line lg:absolute lg:right-0 lg:z-50 lg:w-[430px]" role="dialog" aria-label="Local alert center">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-base-mint">Local Alert Center</p>
              <h3 className="mt-1 text-[15px] font-semibold text-base-text">Rules stay on this device</h3>
              <p className="mt-1 text-[10px] text-base-muted">Source and timeframe are preserved. Cooldown prevents repeat spam.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-full bg-base-elevated text-base-muted" aria-label="Close alert center"><X size={13} /></button>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
            <label className="block"><span className="sr-only">Alert condition</span><select value={metric} onChange={(event) => setMetric(event.target.value as AlertMetric)} className="h-10 w-full rounded-lg border border-base-line bg-base-elevated px-2 text-[11px] text-base-text outline-none">{METRICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            {selectedMetric.threshold ? <label><span className="sr-only">Alert threshold</span><input value={threshold} onChange={(event) => setThreshold(event.target.value)} inputMode="decimal" placeholder={selectedMetric.placeholder} className="h-10 w-full rounded-lg border border-base-line bg-base-elevated px-2 font-mono text-[11px] text-base-text outline-none" /></label> : <div className="hidden sm:block" />}
            <button type="button" onClick={addRule} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-base-mint px-3 text-[11px] font-bold text-[#031411]"><Plus size={13} /> Add</button>
          </div>
          <p className="mt-2 text-[10px] text-base-muted">Target: {metric === "new_pair" ? "Any qualified Base pair" : selectedPair.pair} · {alertTimeframe(metric)}</p>

          <div className="mt-3 max-h-[220px] space-y-1.5 overflow-y-auto">
            {rules.length > 0 ? rules.map((rule) => (
              <div key={rule.id} data-testid="alert-rule" className="flex items-center gap-2 rounded-lg bg-base-elevated/70 px-2.5 py-2">
                <button type="button" onClick={() => setRules((current) => current.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item))} className={cx("h-5 w-9 rounded-full p-0.5 transition", rule.enabled ? "bg-base-mint" : "bg-base-line")} aria-label={`${rule.enabled ? "Disable" : "Enable"} ${metricLabel(rule.metric)} alert`}><span className={cx("block h-4 w-4 rounded-full bg-white transition", rule.enabled && "translate-x-4")} /></button>
                <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold text-base-text">{rule.pairLabel}</span><span className="block text-[10px] text-base-muted">{metricLabel(rule.metric)}{rule.threshold !== undefined ? ` ${rule.threshold}` : ""} · {alertTimeframe(rule.metric)}</span></span>
                <button type="button" onClick={() => setRules((current) => current.filter((item) => item.id !== rule.id))} className="grid h-7 w-7 place-items-center text-base-muted hover:text-base-rose" aria-label="Delete alert"><Trash2 size={12} /></button>
              </div>
            )) : <p className="rounded-lg bg-base-elevated/55 p-3 text-[11px] text-base-muted">No rules yet. Add several without closing this panel.</p>}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-base-line/60 pt-3">
            <p className="text-[10px] text-base-muted">In-app alerts work without browser permission.</p>
            {notificationState !== "granted" ? <button type="button" onClick={() => void enableNotifications()} className="rounded-full bg-base-elevated px-3 py-1.5 text-[10px] font-semibold text-base-text">Enable browser notifications</button> : <span className="text-[10px] font-semibold text-base-mint">Browser notifications enabled</span>}
          </div>

          {triggers.length > 0 ? <div className="mt-3 space-y-1.5 border-t border-base-line/60 pt-3">{triggers.slice(0, 3).map((trigger) => <div key={trigger.key} className="rounded-lg bg-base-amber/10 p-2 text-[10px]"><p className="font-semibold text-base-text">{trigger.title}</p><p className="mt-1 text-base-muted">{trigger.detail} · {trigger.source} · {trigger.timeframe}</p></div>)}</div> : null}
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

function metricLabel(metric: AlertMetric) {
  return METRICS.find((item) => item.id === metric)?.label ?? metric;
}

function alertTimeframe(metric: AlertMetric) {
  if (metric === "change_5m") return "5m";
  if (metric === "change_1h") return "1h";
  if (metric === "change_24h" || metric === "volume_24h") return "24h";
  return "snapshot";
}
