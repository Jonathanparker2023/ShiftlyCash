import type { CSSProperties } from "react";

type Tone = "positive" | "warning" | "negative" | "neutral";

type Props = {
  value: string | number;
  label?: string;
  tone?: Tone;
  className?: string;
};

function valueColor(tone: Tone): string {
  switch (tone) {
    case "positive":
      return "var(--accent-primary-text)";
    case "warning":
      return "var(--accent-warning-text)";
    case "negative":
      return "var(--accent-negative-text)";
    case "neutral":
    default:
      return "var(--text-primary)";
  }
}

export function MetricValue({ value, label, tone = "neutral", className }: Props) {
  const valueStyle: CSSProperties = {
    color: valueColor(tone),
  };

  const labelStyle: CSSProperties = {
    color: "var(--text-tertiary)",
  };

  return (
    <div className={className}>
      <div className="text-3xl font-bold tracking-tight" style={valueStyle}>
        {value}
      </div>
      {label ? (
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em]" style={labelStyle}>
          {label}
        </div>
      ) : null}
    </div>
  );
}
