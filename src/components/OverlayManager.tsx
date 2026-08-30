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
  | "pool_drawer"
  | "trade_drawer"
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
const MODALS = new Set<OverlayType>(["wallet_picker", "transaction_review"]);
const DRAWERS = new Set<OverlayType>(["market_inspector", "pool_drawer", "trade_drawer"]);
const MOBILE_SHEETS = new Set<OverlayType>([...DRAWERS, "filters", "columns"]);
const OverlayContext = createContext<OverlayContextValue | undefined>(undefined);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeScope = `${pathname}?view=${searchParams.get("view") ?? "terminal"}`;
  const pairScope = searchParams.get("pair") ?? "";
  const [active, setActive] = useState<OverlayEntry>(NONE);
  const [suspended, setSuspended] = useState<OverlayEntry>();
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
      if (MODALS.has(type) && DRAWERS.has(current.type)) {
        modalReturnFocusRef.current = trigger;
        setSuspended(current);
      }
      else if (!MODALS.has(type)) setSuspended(undefined);
      return next;
    });
  }, []);

  const close = useCallback(() => {
    setActive((current) => {
      if (MODALS.has(current.type) && suspended) {
        const restored = suspended;
        restoringModalFocusRef.current = true;
        setSuspended(undefined);
        return restored;
      }
      setSuspended(undefined);
      window.setTimeout(() => returnFocusRef.current?.focus(), 0);
      return NONE;
    });
  }, [suspended]);

  const closeAll = useCallback(() => {
    setActive(NONE);
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
    window.setTimeout(() => focusable()[0]?.focus(), 0);
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
    if (!MODALS.has(active.type) && !isMobileSheet) return;
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
