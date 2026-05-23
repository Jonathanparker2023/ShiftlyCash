"use client";

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

type Props = {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: Variant;
  disabled?: boolean;
  className?: string;
};

function variantStyle(variant: Variant): CSSProperties {
  switch (variant) {
    case "primary":
      return {
        background: "var(--accent-primary)",
        borderColor: "var(--accent-primary-border)",
        color: "var(--text-primary)",
      };
    case "ghost":
      return {
        background: "transparent",
        borderColor: "transparent",
        color: "var(--text-secondary)",
      };
    case "secondary":
    default:
      return {
        background: "var(--surface-elevated)",
        borderColor: "var(--border-default)",
        color: "var(--text-primary)",
      };
  }
}

export function ActionButton({
  children,
  onClick,
  type = "button",
  variant = "secondary",
  disabled = false,
  className,
}: Props) {
  const buttonProps: ButtonHTMLAttributes<HTMLButtonElement> = {
    disabled,
    onClick,
    type,
  };

  const style: CSSProperties = {
    ...variantStyle(variant),
    borderRadius: "var(--radius-control)",
    borderStyle: "solid",
    borderWidth: variant === "ghost" ? 0 : 1,
    minHeight: 36,
    padding: "8px 16px",
  };

  return (
    <button
      {...buttonProps}
      className={[
        "inline-flex items-center justify-center gap-2 text-sm font-semibold transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "ghost" ? "hover:[background-color:var(--surface-hover)]" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {children}
    </button>
  );
}
