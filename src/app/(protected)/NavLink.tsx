"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isActive =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={
        "shrink-0 rounded-full px-3 py-1.5 text-sm transition " +
        (isActive
          ? "border border-[var(--border-default)] bg-[var(--surface-hover)] font-semibold text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_8px_24px_rgba(255,255,255,0.12)] backdrop-blur-xl"
          : "font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]")
      }
      href={href}
    >
      {children}
    </Link>
  );
}
