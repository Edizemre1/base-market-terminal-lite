import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { APP_DESCRIPTION, APP_METADATA_TITLE, APP_NAME, APP_URL } from "@/lib/appInfo";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getInitialLocale } from "@/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: APP_METADATA_TITLE,
    template: `%s | ${APP_NAME}`
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico"
  },
  openGraph: {
    title: APP_METADATA_TITLE,
    description: APP_DESCRIPTION,
    url: APP_URL,
    siteName: APP_NAME,
    type: "website"
  },
  twitter: {
    card: "summary",
    title: APP_METADATA_TITLE,
    description: APP_DESCRIPTION
  }
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialLocale = await getInitialLocale();
  return (
    <html lang={initialLocale}>
      <body>
        <I18nProvider initialLocale={initialLocale}>
          <AppShell>{children}</AppShell>
        </I18nProvider>
      </body>
    </html>
  );
}
