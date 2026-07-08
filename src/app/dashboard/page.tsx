import { BaseTerminal } from "@/components/BaseTerminal";
import { getMarketTerminalSnapshot, resolveUrlMarketDataMode } from "@/data/providers";

export const revalidate = 60;

type PageProps = {
  searchParams?: Promise<{
    data?: string | string[];
  }>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const mode = resolveUrlMarketDataMode(params?.data);

  return <BaseTerminal data={await getMarketTerminalSnapshot(mode)} />;
}
