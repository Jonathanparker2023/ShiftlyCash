import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { MobileSwipeNavigator } from "@/components/protected/MobileSwipeNavigator";
import { requireUser } from "@/lib/auth";
import { PROTECTED_NAV, PROTECTED_SETTINGS_NAV } from "@/lib/protected-nav";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const { user } = await requireUser();

  return (
    <>
      <nav className="sticky top-0 z-50 border-b border-[#2f3d52] bg-[#0b1220] px-3 py-3 text-white shadow-[0_10px_30px_rgba(0,0,0,0.24)] sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center justify-between gap-3">
            <Link className="flex min-w-0 items-center gap-2.5 text-sm font-semibold uppercase tracking-[0.2em] sm:tracking-[0.24em]" href="/">
              <Image
                src="/logo.svg"
                alt="ShiftlyCash"
                width={32}
                height={32}
                className="drop-shadow-[0_2px_8px_rgba(16,184,96,0.35)]"
                priority
              />
              <span>ShiftlyCash</span>
            </Link>

            <form action="/auth/logout" className="md:hidden" method="post">
              <button
                className="h-9 rounded-md border border-white/10 bg-white/[0.06] px-3 text-sm font-medium text-zinc-100 transition hover:border-white/30 hover:bg-white/[0.1]"
                type="submit"
              >
                Sign Out
              </button>
            </form>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between md:flex-1">
            <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
              <div className="flex w-max min-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
                {PROTECTED_NAV.map((route) => (
                  <NavLink href={route.href} key={route.href}>
                    {route.label}
                  </NavLink>
                ))}
                {PROTECTED_SETTINGS_NAV.map((route) => (
                  <NavLink href={route.href} key={route.href}>
                    {route.label}
                  </NavLink>
                ))}
              </div>
            </div>

            <div className="hidden items-center gap-3 sm:justify-end md:flex">
              <span className="max-w-[220px] truncate text-sm text-zinc-300">
                {user.email}
              </span>
              <form action="/auth/logout" method="post">
                <button
                  className="h-9 rounded-md border border-white/10 bg-white/[0.06] px-3 text-sm font-medium text-zinc-100 transition hover:border-white/30 hover:bg-white/[0.1]"
                  type="submit"
                >
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </div>
      </nav>
      <MobileSwipeNavigator>{children}</MobileSwipeNavigator>
    </>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-zinc-300 transition hover:bg-white/[0.1] hover:text-white"
      href={href}
    >
      {children}
    </Link>
  );
}
