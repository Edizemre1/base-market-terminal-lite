"use client";

import Image from "next/image";
import { WalletCards } from "lucide-react";
import { useWallet } from "@/components/WalletContext";
import { cx } from "@/lib/format";
import { shortenWalletAddress } from "@/lib/wallet";
import { useI18n } from "@/i18n/I18nProvider";

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const wallet = useWallet();
  const { t } = useI18n();
  const walletAddress = wallet.address;
  const connected = wallet.accountConnected && Boolean(walletAddress);
  const label = connected && walletAddress
    ? shortenWalletAddress(walletAddress)
    : wallet.status === "connecting"
      ? t("wallet.connecting")
      : wallet.status === "reconnect_required" || wallet.status === "disconnected_by_user" || wallet.status === "locked_or_no_accounts"
        ? t("wallet.reconnect")
        : t("wallet.connect");

  return (
    <button
      type="button"
      data-testid="connect-wallet-button"
      data-wallet-ready={wallet.ready ? "true" : "false"}
      data-wallet-status={wallet.status}
      data-balance-status={wallet.balanceStatus}
      data-connection-origin={wallet.connectionOrigin}
      onClick={wallet.openPicker}
      disabled={wallet.status === "connecting"}
      className={cx(
        "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-control border px-2 font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait disabled:opacity-70 lg:h-8",
        connected
          ? wallet.wrongNetwork
            ? "border-freshness-delayed/50 bg-freshness-delayed/10 text-freshness-delayed"
            : "border-operation-success/45 bg-operation-success/10 text-operation-success"
          : "border-brand-action bg-brand-action text-content-on-accent hover:bg-brand-action/90",
        compact ? "w-9 px-0 text-meta sm:w-auto sm:max-w-[136px] sm:px-2 xl:min-w-[124px]" : "text-meta"
      )}
      aria-label={connected ? t("wallet.openDetails", { address: label }) : label}
    >
      {wallet.selectedProvider?.icon ? <Image unoptimized src={wallet.selectedProvider.icon} alt="" width={16} height={16} className="h-4 w-4 rounded-control" /> : <WalletCards size={13} aria-hidden="true" />}
      <span className={cx("min-w-0 text-left", compact && "hidden sm:block")}>
        <span className="block truncate">{connected ? `${wallet.selectedProvider?.name ?? t("wallet.connected")} · ${label}` : label}</span>
        {connected ? <span className="hidden truncate font-mono text-[10px] font-normal opacity-80 xl:block">{wallet.wrongNetwork ? t("wallet.wrongNetworkShort") : `Base · ${wallet.balanceStatus === "balance_loading" ? t("common.checking") : wallet.balanceEth !== undefined ? `${wallet.balanceEth} ETH` : t("common.unavailable")}`}</span> : null}
      </span>
    </button>
  );
}
