import type { CSSProperties, ReactNode } from "react";

type Tone = "positive" | "warning" | "negative";

type Props = {
  children: ReactNode;
  tone: Tone;
  className?: string;
};

function toneStyle(tone: Tone): CSSProperties {
  switch (tone) {
    case "positive":
      return {
        background: "var(--accent-primary-fill)",
        borderColor: "var(--accent-primary-border)",
        color: "var(--accent-primary-text)",
      };
    case "warning":
      return {
        background: "var(--accent-warning-fill)",
        borderColor: "var(--accent-warning-border)",
        color: "var(--accent-warning-text)",
      };
    case "negative":
      return {
        background: "var(--accent-negative-fill)",
        borderColor: "var(--accent-negative-border)",
        color: "var(--accent-negative-text)",
      };
  }
}

export function SemanticChip({ children, tone, className }: Props) {
  const style: CSSProperties = {
    ...toneStyle(tone),
    borderRadius: 999,
    borderStyle: "solid",
    borderWidth: 1,
    padding: "2px 8px",
  };

  return (
    <span
      className={[
        "inline-flex items-center text-[11px] font-semibold uppercase tracking-[0.05em]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {children}
    </span>
  );
}
