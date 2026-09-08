"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

export type OverlayType =
  | "none"
  | "signal_details"
  | "filters"
  | "columns"
  | "market_inspector"
  | "market_board"
  | "pool_drawer"
  | "trade_drawer"
  | "mergen_profile"
  | "wallet_picker"
  | "transaction_review";

export type OverlayPayload = {
  pairId?: string;
  opportunityId?: string;
  side?: "buy" | "sell";
  tab?: string;
};

export type OverlayEntry = {
  type: OverlayType;
  payload?: OverlayPayload;
};

type OverlayContextValue = {
  active: OverlayEntry;
  suspended?: OverlayEntry;
  open: (type: Exclude<OverlayType, "none">, payload?: OverlayPayload) => void;
  close: () => void;
  closeAll: () => void;
  isOpen: (type: OverlayType) => boolean;
};

const NONE: OverlayEntry = { type: "none" };
const SECONDARY_OVERLAYS = new Set<OverlayType>(["filters", "columns", "transaction_review"]);
const PRIMARY_OVERLAYS = new Set<OverlayType>(["market_inspector", "market_board", "pool_drawer", "trade_drawer", "mergen_profile", "wallet_picker"]);
const MOBILE_SHEETS = new Set<OverlayType>([...PRIMARY_OVERLAYS, "filters", "columns"]);
const OverlayContext = createContext<OverlayContextValue | undefined>(undefined);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeScope = `${pathname}?view=${searchParams.get("view") ?? "terminal"}`;
  const pairScope = searchParams.get("pair") ?? "";
  const [active, setActive] = useState<OverlayEntry>(NONE);
  const [suspended, setSuspended] = useState<OverlayEntry>();
  const suspendedRef = useRef<OverlayEntry | undefined>(undefined);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const restoringModalFocusRef = useRef(false);
  const previousRouteScopeRef = useRef(routeScope);

  const open = useCallback((type: Exclude<OverlayType, "none">, payload?: OverlayPayload) => {
    const next = { type, payload } satisfies OverlayEntry;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActive((current) => {
      if (current.type === "none") {
        returnFocusRef.current = trigger;
      }
      const nestedContext = SECONDARY_OVERLAYS.has(type) && PRIMARY_OVERLAYS.has(current.type);
      if (nestedContext) {
        modalReturnFocusRef.current = trigger;
        suspendedRef.current = current;
        setSuspended(current);
      }
      else {
        if (PRIMARY_OVERLAYS.has(type) && !trigger?.closest("[data-overlay-root]")) returnFocusRef.current = trigger;
        suspendedRef.current = undefined;
        setSuspended(undefined);
      }
      return next;
    });
  }, []);

  const close = useCallback(() => {
    setActive(() => {
      if (suspendedRef.current) {
        const restored = suspendedRef.current;
        restoringModalFocusRef.current = true;
        suspendedRef.current = undefined;
        setSuspended(undefined);
        return restored;
      }
      setSuspended(undefined);
      window.setTimeout(() => returnFocusRef.current?.focus(), 0);
      return NONE;
    });
  }, []);

  const closeAll = useCallback(() => {
    setActive(NONE);
    suspendedRef.current = undefined;
    setSuspended(undefined);
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }, []);

  useLayoutEffect(() => {
    if (previousRouteScopeRef.current === routeScope) return;
    previousRouteScopeRef.current = routeScope;
    closeAll();
  }, [closeAll, routeScope]);

  useEffect(() => {
    window.addEventListener("popstate", closeAll);
    return () => window.removeEventListener("popstate", closeAll);
  }, [closeAll]);

  useEffect(() => {
    if (active.type === "none") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active.type, close]);

  useEffect(() => {
    if (active.type === "none") return;
    if (restoringModalFocusRef.current) {
      restoringModalFocusRef.current = false;
      window.setTimeout(() => modalReturnFocusRef.current?.focus(), 0);
      return;
    }
    const root = document.querySelector<HTMLElement>(`[data-overlay-root="${active.type}"]`);
    if (!root) return;
    const focusable = () => [...root.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]")].filter((item) => item.getAttribute("aria-hidden") !== "true");
    const initialFocus = root.querySelector<HTMLElement>("[data-overlay-autofocus]");
    window.setTimeout(() => (initialFocus ?? focusable()[0])?.focus(), 0);
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [active.type, pairScope]);

  useEffect(() => {
    if (active.type === "none") return;
    const isMobileSheet = MOBILE_SHEETS.has(active.type) && window.matchMedia("(max-width: 1023px)").matches;
    if (!PRIMARY_OVERLAYS.has(active.type) && !SECONDARY_OVERLAYS.has(active.type) && !isMobileSheet) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [active.type]);

  const value = useMemo<OverlayContextValue>(() => ({
    active,
    suspended,
    open,
    close,
    closeAll,
    isOpen: (type) => active.type === type
  }), [active, close, closeAll, open, suspended]);

  return <OverlayContext.Provider value={value}><div data-overlay-state={active.type}>{children}</div></OverlayContext.Provider>;
}

export function useOverlayManager() {
  const context = useContext(OverlayContext);
  if (!context) throw new Error("useOverlayManager must be used inside OverlayProvider");
  return context;
}
