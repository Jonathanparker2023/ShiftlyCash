import { centsToDollars } from "@/lib/domain/money";

type WeekNetSummaryProps = {
  prestigeNetCents: number;
  abilityNetCents: number;
};

export function WeekNetSummary({
  prestigeNetCents,
  abilityNetCents,
}: WeekNetSummaryProps) {
  return (
    <div className="rounded-md border border-white/15 bg-black/15 px-3 py-2 shadow-sm backdrop-blur-md">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <NetLine label="Prestige net" value={formatMoney(prestigeNetCents)} />
        <NetLine label="Ability net" value={formatMoney(abilityNetCents)} />
      </div>
    </div>
  );
}

function NetLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/65">
        {label}
      </span>
      <span className="text-base font-semibold tabular-nums text-white">
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
