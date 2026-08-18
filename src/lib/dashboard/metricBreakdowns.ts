import { calculateEarnSlot, type PaySettings } from "@/lib/domain/pay";
import type { DashboardDay, DashboardSlot } from "@/lib/dashboard/types";

export type IncomeBreakdownRow = {
  key: string;
  label: string;
  cents: number;
  /** The job's own colour, so a breakdown row matches its shift tab. */
  color?: string;
};

export type IncomeBreakdown = {
  jobs: IncomeBreakdownRow[];
  other: IncomeBreakdownRow[];
  laborIncomeCents: number;
  otherIncomeCents: number;
  totalCents: number;
};

export type CashflowBreakdown = IncomeBreakdown & {
  spendCents: number;
  fixedCents: number;
  laborCashflowCents: number;
  cashflowCents: number;
};

// The Earn card separates work that required labor from money that changed the
// total without a shift ("Other" slots and Amortized Income credits). Keeping
// this beside the weekly totals means the card always follows live edits before
// the server refresh returns.
export function buildIncomeBreakdown(
  days: Pick<DashboardDay, "slots">[],
  settings: PaySettings,
  expectedTotalCents: number,
): IncomeBreakdown {
  const jobs = new Map<string, IncomeBreakdownRow>();
  const other = new Map<string, IncomeBreakdownRow>();

  for (const day of days) {
    for (const slot of day.slots) {
      const row = incomeRowForSlot(slot, settings);
      if (!row || row.cents === 0) {
        continue;
      }

      const target = row.kind === "labor" ? jobs : other;
      const existing = target.get(row.key);
      target.set(row.key, {
        key: row.key,
        label: row.label,
        cents: (existing?.cents ?? 0) + row.cents,
        color: existing?.color ?? row.color,
      });
    }
  }

  const jobRows = sortIncomeRows(Array.from(jobs.values()));
  const otherRows = sortIncomeRows(Array.from(other.values()));
  const laborIncomeCents = sumRows(jobRows);
  const rawOtherIncomeCents = sumRows(otherRows);
  // A final adjustment keeps this UI mathematically tied to the already
  // authoritative weekly Earn number even if a future synthetic row type is
  // added before this display helper knows how to label it.
  const adjustmentCents =
    expectedTotalCents - laborIncomeCents - rawOtherIncomeCents;
  const adjustedOtherRows =
    adjustmentCents === 0
      ? otherRows
      : [
          ...otherRows,
          {
            key: "income-adjustment",
            label: "Income adjustment",
            cents: adjustmentCents,
          },
        ];
  const otherIncomeCents = sumRows(adjustedOtherRows);

  return {
    jobs: jobRows,
    other: sortIncomeRows(adjustedOtherRows),
    laborIncomeCents,
    otherIncomeCents,
    totalCents: laborIncomeCents + otherIncomeCents,
  };
}

export function buildCashflowBreakdown(
  income: IncomeBreakdown,
  spendCents: number,
  fixedCents: number,
  cashflowCents: number,
): CashflowBreakdown {
  return {
    ...income,
    spendCents,
    fixedCents,
    // Removing non-labor income from total cash flow leaves the cash generated
    // by work after every expense, not an artificial pro-rata allocation.
    laborCashflowCents: cashflowCents - income.otherIncomeCents,
    cashflowCents,
  };
}

function incomeRowForSlot(
  slot: DashboardSlot,
  settings: PaySettings,
): (IncomeBreakdownRow & { kind: "labor" | "other" }) | null {
  if (slot.kind === "bucket") {
    return {
      key: `bucket:${slot.bucketId ?? slot.label}`,
      label: slot.label.trim() || "Amortized income",
      cents: slot.creditCents ?? 0,
      kind: "other",
    };
  }

  const cents = calculateEarnSlot(slot, settings).earningsCents;
  if (slot.jobType === "none") {
    return null;
  }

  if (slot.jobType === "other") {
    const label = slot.label.trim() || "Other income";
    return {
      key: `other:${label.toLowerCase()}`,
      label,
      cents,
      kind: "other",
    };
  }

  const job = laborJobLabel(slot);
  return {
    key: job.key,
    label: job.label,
    cents,
    color: laborJobColor(slot),
    kind: "labor",
  };
}

// Matches the shift tabs. A custom job carries its own colour; the two
// built-ins are the palette the shift bars already use.
function laborJobColor(slot: DashboardSlot): string | undefined {
  if (slot.customColor) return slot.customColor;
  if (slot.jobType === "prestige" || slot.jobType === "prestige_ilst") {
    return "#facc15";
  }
  if (slot.jobType === "ability" || slot.jobType === "ability_incentive" || slot.jobType === "incentive") {
    return "#1d4ed8";
  }
  return undefined;
}

function laborJobLabel(slot: DashboardSlot): { key: string; label: string } {
  switch (slot.jobType) {
    case "ability":
    case "ability_incentive":
      return { key: "ability", label: "Ability" };
    case "incentive":
      return { key: "ability-incentive", label: "Ability incentive" };
    case "prestige":
      return { key: "prestige", label: "Prestige" };
    case "prestige_ilst":
      return { key: "prestige-ilst", label: "Prestige ILST" };
    case "custom": {
      const label = slot.customName?.trim() || slot.label.trim() || "Custom job";
      return {
        key: `custom:${slot.customJobId ?? label.toLowerCase()}`,
        label,
      };
    }
    default:
      return { key: slot.jobType, label: "Labor income" };
  }
}

function sumRows(rows: IncomeBreakdownRow[]): number {
  return rows.reduce((sum, row) => sum + row.cents, 0);
}

function sortIncomeRows(rows: IncomeBreakdownRow[]): IncomeBreakdownRow[] {
  return [...rows].sort((a, b) => {
    const difference = Math.abs(b.cents) - Math.abs(a.cents);
    return difference === 0 ? a.label.localeCompare(b.label) : difference;
  });
}
