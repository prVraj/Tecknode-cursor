import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://signals.dev"),
  title: {
    default: "Signals — Marketing Intelligence Platform",
    template: "%s | Signals",
  },
  description:
    "Monitor competitors, track SEO rankings, and detect brand signals across search and AI with Signals' marketing intelligence dashboard.",
  applicationName: "Signals",
  openGraph: {
    title: "Signals — Marketing Intelligence Platform",
    description:
      "Monitor competitors, track SEO rankings, and detect brand signals across search and AI with Signals' marketing intelligence dashboard.",
    siteName: "Signals",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Signals — Marketing Intelligence Platform",
    description:
      "Monitor competitors, track SEO rankings, and detect brand signals across search and AI with Signals' marketing intelligence dashboard.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
