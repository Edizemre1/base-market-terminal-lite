import { BaseTerminal } from "@/components/BaseTerminal";
import { getMarketTerminalSnapshot } from "@/data/providers";

export default function DashboardPage() {
  return <BaseTerminal data={getMarketTerminalSnapshot()} />;
}
