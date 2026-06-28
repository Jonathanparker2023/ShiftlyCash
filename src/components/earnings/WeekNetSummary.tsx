import { centsToDollars } from "@/lib/domain/money";

type CustomNet = {
  id: string;
  name: string;
  color: string;
  netCents: number;
};

type WeekNetSummaryProps = {
  prestigeNetCents: number;
  abilityNetCents: number;
  customNets?: CustomNet[];
  hiddenBuiltins?: string[];
};

export function WeekNetSummary({
  prestigeNetCents,
  abilityNetCents,
  customNets = [],
  hiddenBuiltins = [],
}: WeekNetSummaryProps) {
  // A hidden built-in drops off the bar — but only once it's at zero, so a week
  // that still has its earnings keeps the chip and the breakdown still sums.
  const showPrestige =
    !hiddenBuiltins.includes("prestige") || prestigeNetCents !== 0;
  const showAbility =
    !hiddenBuiltins.includes("ability") || abilityNetCents !== 0;
  // Total NET shift income = the jobs shown here (Prestige + Ability + customs).
  // Excludes "other" / amortized income, which isn't a job.
  const totalShiftNetCents =
    prestigeNetCents +
    abilityNetCents +
    customNets.reduce((sum, net) => sum + net.netCents, 0);
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 shadow-sm backdrop-blur-md">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {showPrestige ? (
          <NetLine
            color="#facc15"
            label="Prestige net"
            value={formatMoney(prestigeNetCents)}
          />
        ) : null}
        {showAbility ? (
          <NetLine
            color="#1d4ed8"
            label="Ability net"
            value={formatMoney(abilityNetCents)}
          />
        ) : null}
        {customNets.map((net) => (
          <NetLine
            color={net.color}
            key={net.id}
            label={`${net.name} net`}
            value={formatMoney(net.netCents)}
          />
        ))}
        <NetLine
          color="var(--text-primary)"
          label="Total"
          value={formatMoney(totalShiftNetCents)}
        />
      </div>
    </div>
  );
}

function NetLine({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className="text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{ color: color ?? "var(--text-tertiary)" }}
      >
        {label}
      </span>
      <span className="text-base font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </span>
    </div>
  );
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(centsToDollars(value)));
}
