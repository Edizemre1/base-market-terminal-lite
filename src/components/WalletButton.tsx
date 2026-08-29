"use client";

import { WalletCards } from "lucide-react";
import { useWallet } from "@/components/WalletContext";
import { cx } from "@/lib/format";
import { shortenWalletAddress } from "@/lib/wallet";

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const wallet = useWallet();
  const walletAddress = wallet.address;
  const connected = wallet.status === "connected" && Boolean(walletAddress);
  const label = connected && walletAddress
    ? shortenWalletAddress(walletAddress)
    : wallet.status === "connecting"
      ? "Connecting..."
      : "Connect wallet";

  return (
    <button
      type="button"
      data-testid="connect-wallet-button"
      onClick={() => void wallet.connect()}
      disabled={wallet.status === "connecting"}
      className={cx(
        "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 border px-2 font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-base-mint/50 disabled:cursor-wait disabled:opacity-70 lg:h-8",
        connected
          ? wallet.wrongNetwork
            ? "border-base-amber/50 bg-base-amber/10 text-base-amber"
            : "border-base-mint/45 bg-base-mint/10 text-base-mint"
          : "border-base-mint bg-base-mint text-white hover:bg-base-mint/90",
        compact ? "max-w-[116px] text-[10px]" : "text-[11px]"
      )}
      aria-label={connected ? `Wallet ${label}` : "Connect wallet"}
    >
      <WalletCards size={13} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}
