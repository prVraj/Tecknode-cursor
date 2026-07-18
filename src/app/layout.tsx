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
  metadataBase: new URL("https://tecknode.dev"),
  title: {
    default: "Tecknode — Marketing Intelligence Platform",
    template: "%s | Tecknode",
  },
  description:
    "Monitor competitors, track SEO rankings, and detect brand signals across search and AI with Tecknode's marketing intelligence dashboard.",
  applicationName: "Tecknode",
  openGraph: {
    title: "Tecknode — Marketing Intelligence Platform",
    description:
      "Monitor competitors, track SEO rankings, and detect brand signals across search and AI with Tecknode's marketing intelligence dashboard.",
    siteName: "Tecknode",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tecknode — Marketing Intelligence Platform",
    description:
      "Monitor competitors, track SEO rankings, and detect brand signals across search and AI with Tecknode's marketing intelligence dashboard.",
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
