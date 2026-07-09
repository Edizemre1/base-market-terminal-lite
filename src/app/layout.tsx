import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { APP_DESCRIPTION, APP_METADATA_TITLE, APP_NAME, APP_URL } from "@/lib/appInfo";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: APP_METADATA_TITLE,
    template: `%s | ${APP_NAME}`
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
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

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
