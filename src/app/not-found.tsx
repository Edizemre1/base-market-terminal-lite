import type { Metadata } from "next";
import Link from "next/link";
import { translate } from "@/i18n/dictionaries";
import { getInitialLocale } from "@/i18n/server";
import { APP_NAME } from "@/lib/appInfo";
import { StatePanel } from "@/components/ui/CalmComponents";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getInitialLocale();
  return { title: { absolute: `${translate(locale, "notFound.title")} | ${APP_NAME}` } };
}

export default async function NotFound() {
  const locale = await getInitialLocale();
  return (
    <main id="terminal-main" tabIndex={-1} className="min-h-[calc(100vh-56px)] scroll-mt-16 bg-surface-canvas p-4 outline-none">
      <StatePanel
        className="mx-auto max-w-2xl"
        title={`404 · ${translate(locale, "notFound.title")}`}
        body={translate(locale, "notFound.body")}
        action={<Link href="/" className="cmi-button cmi-button-primary">{translate(locale, "notFound.back")}</Link>}
      />
    </main>
  );
}
