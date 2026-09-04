import { redirect } from "next/navigation";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    for (const item of Array.isArray(value) ? value : value ? [value] : []) query.append(key, item);
  }
  redirect(query.size ? `/terminal?${query}` : "/terminal");
}
