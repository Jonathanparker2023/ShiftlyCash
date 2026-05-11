export type ProtectedNavRoute = {
  href: string;
  label: string;
};

// Order is the source of truth for the nav bar and for mobile swipe navigation.
export const PROTECTED_NAV: readonly ProtectedNavRoute[] = [
  { href: "/", label: "Dashboard" },
  { href: "/baseline", label: "Baseline" },
  { href: "/history", label: "History" },
  { href: "/debt", label: "Debt" },
  { href: "/net-worth", label: "Net Worth" },
  { href: "/banking", label: "Banking" },
];

export const PROTECTED_SETTINGS_NAV: readonly ProtectedNavRoute[] = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/template", label: "Settings" },
];
