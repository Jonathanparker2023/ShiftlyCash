import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { requireUser } from "@/lib/auth";
import { NavLink } from "./NavLink";
import { SwipeNavigation } from "./SwipeNavigation";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const { user } = await requireUser();

  return (
    <>
      <div aria-hidden="true" className="penthouse-bg-layer" />
      <nav className="sticky top-0 z-50 border-b border-white/15 bg-black/15 px-3 py-3 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
          <div className="flex items-center justify-between gap-3">
            <Link className="flex shrink-0 items-center gap-2.5 text-sm font-semibold uppercase tracking-[0.2em] sm:tracking-[0.24em]" href="/">
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

          <div className="min-w-0">
            <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
              <div className="flex w-max min-w-full items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-md">
                <NavLink href="/">Dashboard</NavLink>
                <NavLink href="/baseline">Fixed</NavLink>
                <NavLink href="/history">History</NavLink>
                <NavLink href="/paychecks">Paychecks</NavLink>
                <NavLink href="/projects">Projects</NavLink>
                <NavLink href="/debt">Debt</NavLink>
                <NavLink href="/net-worth">Net Worth</NavLink>
                <NavLink href="/cal">ShiftlyCal</NavLink>
              </div>
            </div>

          </div>

          <div className="hidden items-center gap-3 justify-self-end lg:flex">
            <span className="max-w-[180px] truncate text-sm text-zinc-300 xl:max-w-[220px]">
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
      </nav>
      <SwipeNavigation>
        <div className="w-full max-w-[100vw] overflow-x-hidden">{children}</div>
      </SwipeNavigation>
    </>
  );
}
