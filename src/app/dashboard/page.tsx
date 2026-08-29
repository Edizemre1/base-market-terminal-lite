import { BaseTerminal } from "@/components/BaseTerminal";
import { getMarketTerminalSnapshot, resolveUrlMarketDataMode } from "@/data/providers";

export const revalidate = 60;

type PageProps = {
  searchParams?: Promise<{
    data?: string | string[];
    pair?: string | string[];
    view?: string | string[];
  }>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const mode = resolveUrlMarketDataMode(params?.data);

  return (
    <BaseTerminal
      data={await getMarketTerminalSnapshot(mode)}
      initialPairParam={getFirstSearchParam(params?.pair)}
      initialViewParam={getFirstSearchParam(params?.view)}
    />
  );
}

function getFirstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
