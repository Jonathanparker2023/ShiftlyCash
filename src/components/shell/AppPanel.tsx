import type { CSSProperties, ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
};

export function AppPanel({ children, className, elevated = false }: Props) {
  const style: CSSProperties = {
    background: elevated ? "var(--surface-elevated)" : "var(--surface-base)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-panel)",
    padding: "1rem",
  };

  return (
    <section className={["transition-colors", className].filter(Boolean).join(" ")} style={style}>
      {children}
    </section>
  );
}
