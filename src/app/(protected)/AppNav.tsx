"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { ThemeToggle } from "@/components/theme/ThemeToggle";

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

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const logo = (
    <Link className="flex shrink-0 items-center gap-2.5" href="/">
      <Image
        alt="Bashflow"
        className="drop-shadow-[0_2px_9px_rgba(212,175,55,0.45)]"
        height={36}
        priority
        src="/logo.svg"
        width={36}
      />
      <span
        className="text-xl font-semibold tracking-tight"
        style={{
          fontFamily: "var(--font-jost), sans-serif",
          color: "#cba135",
          backgroundImage:
            "linear-gradient(120deg,#9c7a24 0%,#c8a32d 30%,#ecca5e 50%,#d4af37 70%,#a9842f 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        Bashflow
      </span>
    </Link>
  );

  const signOut = (
    <form action="/auth/logout" method="post">
      <button
        className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-hover)] px-3 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
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
              ? "border border-[var(--accent-brand-border)] bg-[var(--accent-brand-fill)] font-semibold text-[var(--accent-brand-text)]"
              : "font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]")
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

  const footer = (
    <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
      <div className="space-y-1.5">
        <p className="px-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Theme
        </p>
        <ThemeToggle />
      </div>
      <p className="truncate px-1 text-xs text-[var(--text-tertiary)]">
        {userEmail}
      </p>
      {signOut}
    </div>
  );

  return (
    <>
      {/* Desktop: fixed left side rail (all items visible, no cutoff). */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-60 flex-col gap-4 border-r border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-4 text-[var(--text-primary)] lg:flex">
        <div className="px-1">{logo}</div>
        {navList}
        {footer}
      </aside>

      {/* Mobile: compact identity bar. The menu trigger stays thumb-reachable. */}
      <header className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-3 text-[var(--text-primary)] shadow-[0_10px_30px_rgba(0,0,0,0.18)] lg:hidden">
        {logo}
        <form action="/auth/logout" method="post">
          <button
            className="h-9 rounded-md border border-[var(--border-default)] bg-[var(--surface-hover)] px-3 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            type="submit"
          >
            Sign Out
          </button>
        </form>
      </header>

      {!open ? (
        <button
          aria-controls="mobile-app-nav"
          aria-expanded="false"
          aria-label="Open menu"
          className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-50 flex h-12 w-12 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] text-[var(--text-primary)] transition hover:border-[var(--accent-brand-border)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-brand)] lg:hidden"
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
      ) : null}

      {/* Mobile drawer overlay. */}
      {open ? (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            type="button"
          />
          <aside
            aria-label="Navigation menu"
            aria-modal="true"
            className="mobile-app-drawer absolute inset-y-0 right-0 flex w-72 max-w-[82vw] flex-col gap-4 border-l border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-4 text-[var(--text-primary)]"
            id="mobile-app-nav"
            role="dialog"
          >
            <div className="flex items-center justify-between px-1">
              {logo}
              <button
                aria-label="Close menu"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--surface-hover)] transition hover:border-[var(--border-strong)]"
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
            <div className="mt-auto flex min-h-0 max-h-[calc(100dvh-5rem)] flex-col gap-4 pb-[env(safe-area-inset-bottom)]">
              {navList}
              {footer}
            </div>
          </aside>
          <style>{`
            @keyframes mobile-app-drawer-in {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
            .mobile-app-drawer {
              animation: mobile-app-drawer-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
            }
            @media (prefers-reduced-motion: reduce) {
              .mobile-app-drawer { animation: none; }
            }
          `}</style>
        </div>
      ) : null}
    </>
  );
}
