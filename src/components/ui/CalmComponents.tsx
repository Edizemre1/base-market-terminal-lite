import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode
} from "react";
import { cx } from "@/lib/format";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
type ButtonSize = "s" | "m" | "touch";
export type StateKind = "loading" | "empty" | "delayed" | "stale" | "unavailable" | "error" | "partial" | "offline" | "recovering";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-brand-action text-content-on-accent hover:bg-brand-action/90 active:bg-brand-action/80",
  secondary: "border border-border-subtle bg-surface-interactive text-content-primary hover:border-border-strong hover:bg-surface-raised",
  quiet: "bg-transparent text-content-secondary hover:bg-surface-interactive hover:text-content-primary",
  danger: "border border-operation-failed/35 bg-operation-failed/10 text-operation-failed hover:bg-operation-failed/15"
};

const buttonSizes: Record<ButtonSize, string> = {
  s: "h-control-s px-2 text-meta",
  m: "h-control-m px-3 text-label",
  touch: "h-control-touch px-4 text-label"
};

const stateKinds: Record<StateKind, string> = {
  loading: "border-border-subtle text-content-secondary",
  empty: "border-border-subtle text-content-secondary",
  delayed: "border-freshness-delayed/35 text-freshness-delayed",
  stale: "border-freshness-stale/35 text-freshness-stale",
  unavailable: "border-border-strong text-content-secondary",
  error: "border-operation-failed/35 text-operation-failed",
  partial: "border-trust-conflicting/35 text-trust-conflicting",
  offline: "border-freshness-stale/35 text-freshness-stale",
  recovering: "border-network-base/35 text-network-base"
};

export function Button({
  className,
  variant = "secondary",
  size = "m",
  loading = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-control font-semibold outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas disabled:cursor-not-allowed disabled:text-content-disabled disabled:opacity-60",
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  className,
  label,
  selected = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  selected?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={cx(
        "grid h-control-s w-control-s shrink-0 place-items-center rounded-control bg-surface-interactive text-content-secondary outline-none hover:text-content-primary focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas disabled:cursor-not-allowed disabled:text-content-disabled",
        selected && "bg-surface-selected text-brand-accent",
        className
      )}
    >
      {children}
    </button>
  );
}

export function Field({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("cmi-field", className)} />;
}

export function Surface({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={cx("cmi-panel", className)} />;
}

export function StatePanel({
  title,
  body,
  action,
  kind = "empty",
  compact = false,
  className
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  kind?: StateKind;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx("cmi-state", stateKinds[kind], compact && "p-3 text-label", className)}
      data-state-kind={kind}
      role={kind === "error" || kind === "offline" ? "alert" : "status"}
      aria-live={kind === "loading" || kind === "recovering" ? "polite" : undefined}
    >
      <p className="font-semibold text-content-primary">{title}</p>
      {body ? <p className="mt-1">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
