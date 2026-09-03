import { centsToDollars } from "@/lib/domain/money";

type FixedBreakdownDetail = {
  itemKind: "recurring" | "amortized";
  originalAmountCents: number;
  periodDays: number | null;
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
