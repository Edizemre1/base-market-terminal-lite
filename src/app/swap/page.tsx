import { BaseTerminal } from "@/components/BaseTerminal";
import { getMarketTerminalSnapshot } from "@/data/providers";

export default function SwapPage() {
  return <BaseTerminal data={getMarketTerminalSnapshot()} />;
}
