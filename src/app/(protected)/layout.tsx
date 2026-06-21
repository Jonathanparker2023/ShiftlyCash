import type { ReactNode } from "react";

import { requireUser } from "@/lib/auth";
import { CAPABILITIES, type EditionCapabilities } from "@/lib/edition";
import { AppNav } from "./AppNav";
import { SwipeNavigation } from "./SwipeNavigation";

export const dynamic = "force-dynamic";

const NAV_LINKS = [
  { href: "/setup", label: "Setup", capability: "showSetup" },
  { href: "/", label: "Dashboard", capability: "showDashboard" },
  { href: "/baseline", label: "Fixed", capability: "showFixed" },
  { href: "/history", label: "History", capability: "showHistory" },
  { href: "/trends", label: "Trends", capability: "showTrends" },
  { href: "/paychecks", label: "Paychecks", capability: "showPaycheckAudit" },
  { href: "/debt", label: "Debt", capability: "showDebt" },
  { href: "/net-worth", label: "Net Worth", capability: "showNetWorth" },
  { href: "/screener", label: "Screener", capability: "showScreener" },
  { href: "/cal", label: "ShiftlyCal", capability: "showCal" },
  {
    href: "/settings/template",
    label: "Templates",
    capability: "showWeeklyTemplate",
  },
] as const satisfies ReadonlyArray<{
  href: string;
  label: string;
  capability: keyof EditionCapabilities | null;
}>;

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const { user } = await requireUser();
  const visibleNavLinks = NAV_LINKS.filter(
    (link) => link.capability === null || CAPABILITIES[link.capability],
  );

  return (
    <>
      <div aria-hidden="true" className="penthouse-bg-layer" />
      <AppNav
        links={visibleNavLinks.map((link) => ({
          href: link.href,
          label: link.label,
        }))}
        userEmail={user.email ?? ""}
      />
      <SwipeNavigation routes={visibleNavLinks.map((link) => link.href)}>
        <div className="w-full max-w-[100vw] overflow-x-hidden lg:pl-60">
          {children}
        </div>
      </SwipeNavigation>
    </>
  );
}
