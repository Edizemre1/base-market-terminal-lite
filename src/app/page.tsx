import { BaseTerminal } from "@/components/BaseTerminal";
import { getMarketTerminalSnapshot } from "@/data/providers";

export default function HomePage() {
  return <BaseTerminal data={getMarketTerminalSnapshot()} />;
}
