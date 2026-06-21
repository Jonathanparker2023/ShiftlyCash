"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type NavItem = { href: string; label: string };

function isActive(pathname: string | null, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || (pathname?.startsWith(`${href}/`) ?? false);
}

export function AppNav({
  links,
  userEmail,
}: {
  links: NavItem[];
  userEmail: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const logo = (
    <Link
      className="flex shrink-0 items-center gap-2.5 text-sm font-semibold uppercase tracking-[0.2em]"
      href="/"
    >
      <Image
        alt="ShiftlyCash"
        className="drop-shadow-[0_2px_8px_rgba(16,184,96,0.35)]"
        height={30}
        priority
        src="/logo.svg"
        width={30}
      />
      <span>ShiftlyCash</span>
    </Link>
  );

  const signOut = (
    <form action="/auth/logout" method="post">
      <button
        className="h-9 w-full rounded-md border border-white/10 bg-white/[0.06] px-3 text-sm font-medium text-zinc-100 transition hover:border-white/30 hover:bg-white/[0.1]"
        type="submit"
      >
        Sign Out
      </button>
    </form>
  );

  const navList = (
    <nav className="flex-1 space-y-1 overflow-y-auto">
      {links.map((link) => (
        <Link
          aria-current={isActive(pathname, link.href) ? "page" : undefined}
          className={
            "block rounded-lg px-3 py-2 text-sm transition " +
            (isActive(pathname, link.href)
              ? "border border-white/40 bg-white/15 font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
              : "font-medium text-white/70 hover:bg-white/[0.1] hover:text-white")
          }
          href={link.href}
          key={link.href}
          onClick={() => setOpen(false)}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <>
      {/* Desktop: fixed left side rail (all items visible, no cutoff). */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-60 flex-col gap-4 border-r border-white/15 bg-black/25 px-3 py-4 text-white backdrop-blur-xl lg:flex">
        <div className="px-1">{logo}</div>
        {navList}
        <div className="space-y-2 border-t border-white/10 pt-3">
          <p className="truncate px-1 text-xs text-zinc-400">{userEmail}</p>
          {signOut}
        </div>
      </aside>

      {/* Mobile: sticky top bar with a hamburger that opens the drawer. */}
      <header className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-white/15 bg-black/30 px-3 py-3 text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-xl lg:hidden">
        <button
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] transition hover:bg-white/[0.12]"
          onClick={() => setOpen(true)}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {logo}
        <form action="/auth/logout" method="post">
          <button
            className="h-9 rounded-md border border-white/10 bg-white/[0.06] px-3 text-sm font-medium text-zinc-100 transition hover:border-white/30 hover:bg-white/[0.1]"
            type="submit"
          >
            Sign Out
          </button>
        </form>
      </header>

      {/* Mobile drawer overlay. */}
      {open ? (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col gap-4 border-r border-white/15 bg-[#0b1220]/95 px-3 py-4 text-white shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between px-1">
              {logo}
              <button
                aria-label="Close menu"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] transition hover:bg-white/[0.12]"
                onClick={() => setOpen(false)}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {navList}
            <div className="space-y-2 border-t border-white/10 pt-3">
              <p className="truncate px-1 text-xs text-zinc-400">{userEmail}</p>
              {signOut}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
