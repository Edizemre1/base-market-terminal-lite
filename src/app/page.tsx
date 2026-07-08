import { BaseTerminal } from "@/components/BaseTerminal";
import { getMarketTerminalSnapshot } from "@/data/providers";

export const revalidate = 60;

export default async function HomePage() {
  return <BaseTerminal data={await getMarketTerminalSnapshot()} />;
}
