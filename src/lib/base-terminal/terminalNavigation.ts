export const TERMINAL_NAVIGATION_EVENT = "mergen:terminal-navigation";

export type TerminalView = "terminal" | "markets" | "watchlist" | "portfolio" | "alerts" | "workspace";
export type TerminalOverlayRoute = "none" | "market_inspector";

export type TerminalLocation = {
  view: TerminalView;
  pair?: string;
  overlay: TerminalOverlayRoute;
};

type NavigationOptions = {
  view: TerminalView;
  pair?: string;
  overlay?: TerminalOverlayRoute;
  mode?: "push" | "replace";
  preservePair?: boolean;
};

export function normalizeTerminalView(value: string | null | undefined): TerminalView {
  if (value === "markets" || value === "watchlist" || value === "alerts" || value === "portfolio" || value === "workspace") return value;
  if (value === "wallet") return "portfolio";
  return "terminal";
}

export function readTerminalLocation(location: Pick<Location, "href"> = window.location): TerminalLocation {
  const url = new URL(location.href);
  const state = typeof window === "undefined" ? undefined : window.history.state as { terminalOverlay?: TerminalOverlayRoute } | null;
  return {
    view: normalizeTerminalView(url.searchParams.get("view")),
    pair: url.searchParams.get("pair") ?? undefined,
    overlay: state?.terminalOverlay === "market_inspector" ? "market_inspector" : "none"
  };
}

export function commitTerminalNavigation({
  view,
  pair,
  overlay = "none",
  mode = "push",
  preservePair = true
}: NavigationOptions) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.pathname = "/terminal";
  if (view === "terminal") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  if (pair) url.searchParams.set("pair", pair);
  else if (!preservePair) url.searchParams.delete("pair");
  const state = { ...(window.history.state ?? {}), terminalView: view, terminalOverlay: overlay };
  window.history[mode === "replace" ? "replaceState" : "pushState"](state, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new CustomEvent<TerminalLocation>(TERMINAL_NAVIGATION_EVENT, {
    detail: { view, pair: url.searchParams.get("pair") ?? undefined, overlay }
  }));
}

export function shouldHandleTerminalAnchor(event: { button: number; defaultPrevented: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) {
  return event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
