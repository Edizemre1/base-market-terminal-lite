"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOverlayManager } from "@/components/OverlayManager";
import { readCanonicalProfileClaim, type CanonicalMergenProfile, type MergenAccountState } from "@/lib/account/contract";

type AccountContextValue = Readonly<{
  state: MergenAccountState;
  profile?: CanonicalMergenProfile;
  openProfile: () => void;
  closeProfile: () => void;
  retryProfile: () => void;
}>;

const AccountContext = createContext<AccountContextValue | undefined>(undefined);
const ACCOUNT_HINT = "mergen_base_account_hint=1";

function hasAccountHint(): boolean {
  return document.cookie.split(";").some((cookie) => cookie.trim() === ACCOUNT_HINT);
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const overlay = useOverlayManager();
  const [state, setState] = useState<MergenAccountState>("anonymous");
  const [profile, setProfile] = useState<CanonicalMergenProfile>();
  const requestRef = useRef(0);

  const loadProfile = useCallback(async () => {
    if (!navigator.onLine) {
      setProfile(undefined);
      setState("offline");
      return;
    }
    const requestId = ++requestRef.current;
    setState("profile_loading");
    try {
      const response = await fetch("/api/account/session", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const body = await response.json() as { state?: unknown; profile?: unknown };
      if (requestId !== requestRef.current) return;
      if (response.status === 401 || body.state === "session_expired") {
        setProfile(undefined);
        setState("session_expired");
        return;
      }
      const candidate = body.profile as Record<string, unknown> | undefined;
      const canonical = candidate ? readCanonicalProfileClaim(candidate.subject, {
        version: candidate.version,
        email: candidate.email,
        display_name: candidate.displayName,
        member_since: candidate.memberSince,
        last_sign_in_at: candidate.lastSignInAt,
        membership: candidate.membership
      }) : undefined;
      if (!response.ok || !canonical) {
        setProfile(undefined);
        setState("profile_unavailable");
        return;
      }
      setProfile(canonical);
      setState("profile_ready");
    } catch {
      if (requestId !== requestRef.current) return;
      setProfile(undefined);
      setState(navigator.onLine ? "profile_unavailable" : "offline");
    }
  }, []);

  useEffect(() => {
    const marker = new URLSearchParams(window.location.search).get("account");
    if (marker === "callback") setState("callback_pending");
    else if (marker === "expired") setState("session_expired");
    else if (marker === "unavailable") setState("profile_unavailable");
    else if (marker === "logged_out") setState("logged_out");
    if (hasAccountHint()) {
      setState("authenticated");
      void loadProfile();
    }
    if (marker) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("account");
      clean.searchParams.delete("locale");
      window.history.replaceState(window.history.state, "", clean);
    }
    return () => { requestRef.current += 1; };
  }, [loadProfile]);

  useEffect(() => {
    const handleOffline = () => {
      if (hasAccountHint()) {
        setProfile(undefined);
        setState("offline");
      }
    };
    const handleOnline = () => {
      if (hasAccountHint()) void loadProfile();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadProfile]);

  const openProfile = useCallback(() => {
    if (state === "anonymous" || state === "logged_out") setState("sign_in_required");
    overlay.open("mergen_profile");
  }, [overlay, state]);
  const closeProfile = useCallback(() => overlay.close(), [overlay]);
  const value = useMemo<AccountContextValue>(() => ({ state, profile, openProfile, closeProfile, retryProfile: loadProfile }), [closeProfile, loadProfile, openProfile, profile, state]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useMergenAccount() {
  const context = useContext(AccountContext);
  if (!context) throw new Error("useMergenAccount must be used inside AccountProvider");
  return context;
}
