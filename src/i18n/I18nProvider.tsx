"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isLocale, translate, type Locale, type TranslationKey } from "@/i18n/dictionaries";
import { normalizeSignedZero } from "@/lib/marketMath";
import { safeGetStorageItem, safeSetStorageItem } from "@/lib/safeStorage";
import { normalizeCompactNumberText } from "@/lib/format";

export const LOCALE_STORAGE_KEY = "mergen-pulse:locale:v1";
export const LOCALE_COOKIE_NAME = "mergen_locale";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  formatCurrency: (value: number, maximumFractionDigits?: number) => string;
  formatCompactCurrency: (value: number) => string;
  formatNumber: (value: number, maximumFractionDigits?: number) => string;
  formatPercent: (value: number) => string;
  formatDateTime: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
  formatRelativeTime: (value: string | number | Date) => string;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ initialLocale, initialNow, children }: { initialLocale: Locale; initialNow: number; children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(initialLocale);
  const [relativeNow, setRelativeNow] = useState(initialNow);
  const storageCheckedRef = useRef(false);

  useEffect(() => {
    setRelativeNow(Date.now());
    const timer = window.setInterval(() => setRelativeNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!storageCheckedRef.current) {
      storageCheckedRef.current = true;
      const hasLocaleCookie = document.cookie.split(";").some((entry) => entry.trim().startsWith(`${LOCALE_COOKIE_NAME}=`));
      const storedLocale = hasLocaleCookie ? undefined : safeGetStorageItem(LOCALE_STORAGE_KEY);
      if (isLocale(storedLocale) && storedLocale !== locale) {
        document.cookie = `${LOCALE_COOKIE_NAME}=${storedLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
        document.documentElement.lang = storedLocale;
        updateLocale(storedLocale);
        return;
      }
    }
    document.documentElement.lang = locale;
    safeSetStorageItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    if (!isLocale(nextLocale)) return;
    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = nextLocale;
    updateLocale(nextLocale);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const intlLocale = locale === "tr" ? "tr-TR" : "en-US";
    return {
      locale,
      setLocale,
      t: (key, values) => translate(locale, key, values),
      formatCurrency: (number, maximumFractionDigits = 2) => Number.isFinite(number) ? new Intl.NumberFormat(intlLocale, { style: "currency", currency: "USD", maximumFractionDigits }).format(normalizeSignedZero(number)) : translate(locale, "common.noData"),
      formatCompactCurrency: (number) => Number.isFinite(number) ? normalizeCompactNumberText(new Intl.NumberFormat(intlLocale, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(normalizeSignedZero(number))) : translate(locale, "common.noData"),
      formatNumber: (number, maximumFractionDigits = 1) => {
        if (!Number.isFinite(number)) return translate(locale, "common.noData");
        const compact = Math.abs(number) > 9999;
        const formatted = new Intl.NumberFormat(intlLocale, { notation: compact ? "compact" : "standard", maximumFractionDigits }).format(normalizeSignedZero(number));
        return compact ? normalizeCompactNumberText(formatted) : formatted;
      },
      formatPercent: (number) => {
        if (!Number.isFinite(number)) return translate(locale, "common.noData");
        const normalized = normalizeSignedZero(number);
        return `${normalized > 0 ? "+" : ""}${new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(normalized)}%`;
      },
      formatDateTime: (date, options) => {
        const parsed = new Date(date);
        return Number.isNaN(parsed.getTime()) ? translate(locale, "common.noData") : new Intl.DateTimeFormat(intlLocale, options).format(parsed);
      },
      formatRelativeTime: (date) => formatRelative(date, locale, relativeNow)
    };
  }, [locale, relativeNow, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}

function formatRelative(value: string | number | Date, locale: Locale, now: number) {
  const milliseconds = now - new Date(value).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return translate(locale, "common.now");
  if (milliseconds < 60_000) return locale === "tr" ? `${Math.max(1, Math.floor(milliseconds / 1000))} sn önce` : `${Math.max(1, Math.floor(milliseconds / 1000))}s ago`;
  if (milliseconds < 3_600_000) return locale === "tr" ? `${Math.floor(milliseconds / 60_000)} dk önce` : `${Math.floor(milliseconds / 60_000)}m ago`;
  if (milliseconds < 86_400_000) return locale === "tr" ? `${Math.floor(milliseconds / 3_600_000)} sa önce` : `${Math.floor(milliseconds / 3_600_000)}h ago`;
  return new Intl.RelativeTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { numeric: "auto" }).format(-Math.floor(milliseconds / 86_400_000), "day");
}
