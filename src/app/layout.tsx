import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
