import type { Metadata } from "next";
import { Geist, Geist_Mono, Jost } from "next/font/google";
import { cookies } from "next/headers";

import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { THEME_COOKIE_KEY, isTheme, type Theme } from "@/components/theme/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Brand wordmark font (matches the gold "Bashflow" logotype).
const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Bashflow",
  description: "Personal cashflow tracking for shift work.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const stored = cookieStore.get(THEME_COOKIE_KEY)?.value;
  const theme: Theme = isTheme(stored) ? stored : "linear";

  return (
    <html
      lang="en"
      data-theme={theme}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${jost.variable} h-full`}
    >
      <body className="flex min-h-full flex-col antialiased">
        <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
