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
          ? "bg-white text-[#0b1220] font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
          : "font-medium text-zinc-300 hover:bg-white/[0.1] hover:text-white")
      }
      href={href}
    >
      {children}
    </Link>
  );
}
