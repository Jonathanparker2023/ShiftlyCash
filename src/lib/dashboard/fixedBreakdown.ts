import { centsToDollars } from "@/lib/domain/money";

type FixedBreakdownDetail = {
  itemKind: "recurring" | "amortized";
  originalAmountCents: number;
  periodDays: number | null;
};

type FixedBreakdownSortable = {
  appliedCents: number;
  itemName: string;
};

const EXACT_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatFixedBreakdownDetail(
  item: FixedBreakdownDetail,
): string {
  const originalAmount = EXACT_USD.format(
    centsToDollars(item.originalAmountCents),
  );

  if (item.itemKind === "amortized") {
    return `${originalAmount} spread over ${item.periodDays ?? 1}d`;
  }

  return `${originalAmount}/mo`;
}

export function sortFixedBreakdownGreatestFirst<
  T extends FixedBreakdownSortable,
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const amountDifference = b.appliedCents - a.appliedCents;
    return amountDifference === 0
      ? a.itemName.localeCompare(b.itemName)
      : amountDifference;
  });
}
