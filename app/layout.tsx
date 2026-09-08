import type { Metadata } from "next";
import { Geist_Mono, Manrope } from "next/font/google";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/src/components/theme-provider";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Solo Company OS — Know what’s next. Get it done.",
    template: "%s · Solo Company OS",
  },
  description:
    "A bilingual, approval-first operating portal for consultants, creators, and freelancers.",
  openGraph: {
    title: "Solo Company OS",
    description: "Know what’s next. Get it done.",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "Solo Company OS — Know what’s next. Get it done." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Solo Company OS",
    description: "Know what’s next. Get it done.",
    images: ["/og.png"],
  },
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-Hant" className={`${manrope.variable} ${geistMono.variable}`}>
      <body>
        <ThemeProvider>
          {children}
          <footer className="site-copyright">
            Copyright © 2026 Demo User. All rights reserved.
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
