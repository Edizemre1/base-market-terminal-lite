import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { resolveMarketDataMode } from "@/data/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Base Market Terminal Lite",
  description: "Public demo market terminal for Base token discovery."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppShell marketDataMode={resolveMarketDataMode()}>{children}</AppShell>
      </body>
    </html>
  );
}
