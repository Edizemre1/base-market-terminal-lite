"use client";

import { ExternalLink, LogOut, RefreshCw, UserRound, X } from "lucide-react";
import { useMergenAccount } from "@/components/AccountContext";
import { useOverlayManager } from "@/components/OverlayManager";
import { useI18n } from "@/i18n/I18nProvider";
import { profileDisplayName, profileInitials } from "@/lib/account/contract";
import { cx } from "@/lib/format";

export function AccountButton() {
  const account = useMergenAccount();
  const { t } = useI18n();
  const label = account.profile ? profileDisplayName(account.profile) : t("account.signInToMergen");
  return <button type="button" onClick={account.openProfile} className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-2 rounded-control border border-border-subtle bg-surface-interactive px-2 text-meta font-semibold text-content-primary hover:border-border-strong lg:h-8" data-testid="mergen-account-button" data-account-state={account.state} aria-label={label}>
    {account.profile ? <span className="grid h-6 w-6 place-items-center rounded-pill border border-brand-accent/30 bg-brand-accent/10 font-mono text-meta text-brand-accent" aria-hidden>{profileInitials(account.profile.displayName ?? "", account.profile.email ?? "")}</span> : <UserRound size={14} aria-hidden="true" />}
    <span className="hidden max-w-account truncate sm:block">{label}</span>
  </button>;
}

export function MergenProfileOverlay() {
  const account = useMergenAccount();
  const overlay = useOverlayManager();
  const { t, locale } = useI18n();
  if (overlay.active.type !== "mergen_profile") return null;
  const profile = account.profile;
  const ready = account.state === "profile_ready" && profile;
  return <div className={cx("fixed inset-0 z-layer-modal flex bg-surface-scrim/75", ready ? "items-end justify-end" : "items-center justify-center p-3")} onMouseDown={(event) => { if (event.target === event.currentTarget) account.closeProfile(); }} data-testid="mergen-profile-backdrop">
    <aside role="dialog" aria-modal="true" aria-label={t(ready ? "account.profile" : "account.signIn")} data-overlay-root="mergen_profile" data-testid="mergen-profile" data-account-state={account.state} className={cx("w-full overflow-y-auto border border-border-subtle bg-surface-panel shadow-overlay", ready ? "max-h-sheet-max rounded-t-overlay p-4 cmi-safe-footer lg:h-full lg:max-h-none lg:w-inspector lg:max-w-inspector lg:rounded-l-overlay lg:rounded-tr-seam" : "max-h-sheet-max max-w-modal-min rounded-overlay p-4")}>
      <header className="flex items-start justify-between gap-3">
        <div><p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">Mergen</p><h2 className="mt-1 text-title-sm font-semibold text-content-primary">{t(ready ? "account.myProfile" : "account.welcomeBack")}</h2></div>
        <button type="button" onClick={account.closeProfile} className="cmi-icon-button h-control-touch w-control-touch" aria-label={t("account.close")} data-overlay-autofocus><X size={16} /></button>
      </header>
      {ready ? <ProfileReady profile={profile} locale={locale} /> : <ProfileState />}
    </aside>
  </div>;
}

function ProfileReady({ profile, locale }: { profile: NonNullable<ReturnType<typeof useMergenAccount>["profile"]>; locale: "tr" | "en" }) {
  const { t } = useI18n();
  const displayName = profileDisplayName(profile) || "—";
  return <div className="mt-4" data-testid="canonical-profile-ready">
    <section className="rounded-card border border-border-subtle bg-surface-raised p-4">
      <div className="flex items-center gap-3"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-pill border border-brand-accent/30 bg-brand-accent/10 font-mono text-data text-brand-accent" aria-hidden>{profileInitials(profile.displayName ?? "", profile.email ?? "")}</span><span className="min-w-0"><strong className="block truncate text-title-sm text-content-primary">{displayName}</strong>{profile.email ? <span className="mt-1 block truncate font-mono text-meta text-content-secondary">{profile.email}</span> : null}</span></div>
    </section>
    <dl className="mt-3 rounded-card border border-border-subtle bg-surface-panel px-3">
      <ProfileFact label={t("account.memberSince")} value={formatDate(profile.memberSince, locale)} />
      <ProfileFact label={t("account.lastSignIn")} value={profile.lastSignInAt ? formatDateTime(profile.lastSignInAt, locale) : "—"} />
      <ProfileFact label={t("account.membership")} value={t(profile.membership === "pro" ? "account.membershipPro" : "account.membershipFree")} />
    </dl>
    <a href={`/api/account/profile?locale=${locale}`} className="mt-3 inline-flex min-h-control-touch w-full items-center justify-center gap-2 rounded-control bg-surface-interactive px-3 text-label font-semibold text-content-primary" data-testid="canonical-profile-link"><ExternalLink size={14} />{t("account.openProfileSettings")}</a>
    <form action={`/api/account/logout?locale=${locale}`} method="post" className="mt-2"><button type="submit" className="inline-flex min-h-control-touch w-full items-center justify-center gap-2 rounded-control border border-border-subtle px-3 text-label font-semibold text-content-secondary" data-testid="mergen-sign-out"><LogOut size={14} />{t("account.signOut")}</button></form>
    <p className="mt-3 text-meta leading-5 text-content-secondary">{t("account.walletSeparate")}</p>
  </div>;
}

function ProfileState() {
  const account = useMergenAccount();
  const { t, locale } = useI18n();
  const loading = account.state === "callback_pending" || account.state === "authenticated" || account.state === "profile_loading";
  const retryable = account.state === "offline" || account.state === "profile_unavailable";
  const title = loading ? t("account.loading") : account.state === "session_expired" ? t("account.sessionExpired") : account.state === "offline" ? t("account.offline") : retryable ? t("account.unavailable") : t("account.signIn");
  const body = loading ? t("account.loadingBody") : account.state === "session_expired" ? t("account.sessionExpiredBody") : account.state === "offline" ? t("account.offlineBody") : account.state === "profile_unavailable" ? t("account.unavailableBody") : t("account.signInBody");
  return <section className="mt-4 rounded-card border border-border-subtle bg-surface-raised p-4" data-testid="account-state-panel"><div className="grid h-10 w-10 place-items-center rounded-control bg-surface-interactive text-content-secondary"><UserRound size={18} /></div><h3 className="mt-3 text-data font-semibold text-content-primary">{title}</h3><p className="mt-2 text-label leading-5 text-content-secondary">{body}</p>{loading ? <p className="mt-4 font-mono text-meta text-content-secondary" role="status">{t("common.checking")}</p> : retryable ? <button type="button" onClick={account.retryProfile} className="cmi-button cmi-button-secondary mt-4 min-h-control-touch w-full"><RefreshCw size={14} />{t("common.refresh")}</button> : <a href={`/api/account/login?locale=${locale}`} className="cmi-button cmi-button-primary mt-4 min-h-control-touch w-full" data-testid="mergen-sign-in">{t("account.signIn")}</a>}</section>;
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return <div className="flex min-h-control-touch items-center justify-between gap-3 border-b border-border-subtle/60 py-3 last:border-b-0"><dt className="text-meta text-content-secondary">{label}</dt><dd className="text-right font-mono text-meta text-content-primary">{value}</dd></div>;
}

function formatDate(value: string, locale: "tr" | "en") {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "long" }).format(new Date(value));
}

function formatDateTime(value: string, locale: "tr" | "en") {
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
