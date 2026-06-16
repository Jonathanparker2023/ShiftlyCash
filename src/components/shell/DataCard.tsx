import type { CSSProperties, ReactNode } from "react";

type Tone = "positive" | "warning" | "negative" | "neutral";

type Props = {
  children: ReactNode;
  className?: string;
  tone?: Tone;
};

function toneStyle(tone: Tone | undefined): CSSProperties {
  switch (tone) {
    case "positive":
      return {
        background: "var(--accent-primary-fill)",
        borderColor: "var(--accent-primary-border)",
      };
    case "warning":
      return {
        background: "var(--accent-warning-fill)",
        borderColor: "var(--accent-warning-border)",
      };
    case "negative":
      return {
        background: "var(--accent-negative-fill)",
        borderColor: "var(--accent-negative-border)",
      };
    default:
      return {};
  }
}

export function DataCard({ children, className, tone = "neutral" }: Props) {
  const style: CSSProperties = {
    background: "var(--surface-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-data)",
    padding: "0.75rem",
    ...toneStyle(tone),
  };

  return (
    <div className={["transition-colors", className].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
  );
}
