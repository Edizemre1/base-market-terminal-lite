"use client";

import { WalletCards } from "lucide-react";
import { useWallet } from "@/components/WalletContext";
import { cx } from "@/lib/format";
import { shortenWalletAddress } from "@/lib/wallet";
import { useI18n } from "@/i18n/I18nProvider";

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const wallet = useWallet();
  const { t } = useI18n();
  const walletAddress = wallet.address;
  const connected = wallet.status === "connected" && Boolean(walletAddress);
  const label = connected && walletAddress
    ? shortenWalletAddress(walletAddress)
    : wallet.status === "connecting"
      ? t("wallet.connecting")
      : t("wallet.connect");

  return (
    <button
      type="button"
      data-testid="connect-wallet-button"
      data-wallet-ready={wallet.ready ? "true" : "false"}
      onClick={wallet.openPicker}
      disabled={wallet.status === "connecting"}
      className={cx(
        "inline-flex h-9 shrink-0 items-center justify-center gap-2 border px-2 font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait disabled:opacity-70 lg:h-8",
        connected
          ? wallet.wrongNetwork
            ? "border-freshness-delayed/50 bg-freshness-delayed/10 text-freshness-delayed"
            : "border-operation-success/45 bg-operation-success/10 text-operation-success"
          : "border-brand-action bg-brand-action text-content-on-accent hover:bg-brand-action/90",
        compact ? "w-9 px-0 text-meta sm:w-auto sm:max-w-[136px] sm:px-2 xl:min-w-[124px]" : "text-meta"
      )}
      aria-label={connected ? t("wallet.openDetails", { address: label }) : t("wallet.connect")}
    >
      <WalletCards size={13} aria-hidden="true" />
      <span className={cx("truncate", compact && "hidden sm:inline")}>{label}</span>
    </button>
  );
}
