import type { DashboardTransaction } from "@/lib/dashboard/types";

type ChronologicalTransaction = {
  id: string;
  date: string;
  time: string | null;
  createdAt: string;
};

const TIMELESS_SORT_VALUE = Number.MAX_SAFE_INTEGER;

export function sortDashboardTransactions(
  transactions: DashboardTransaction[],
): DashboardTransaction[] {
  return sortChronologicalTransactions(transactions);
}

export function splitDashboardTransactionRows(
  appliedTransactions: DashboardTransaction[],
  excludedTransactions: DashboardTransaction[],
): {
  spendingTransactions: DashboardTransaction[];
  exemptTransactions: DashboardTransaction[];
} {
  const spendingTransactions = appliedTransactions.filter(
    (transaction) => {
      if (transaction.isGasAllocated) {
        return transaction.gasRemainderCents > 0;
      }
      if (transaction.isEvChargeAllocated) {
        return transaction.evChargeRemainderCents > 0;
      }
      return true;
    },
  );
  const gasExemptions = appliedTransactions
    .filter(
      (transaction) =>
        transaction.isGasAllocated && transaction.gasAllocatedCents > 0,
    )
    .map((transaction) => ({
      ...transaction,
      amountCents: transaction.gasAllocatedCents,
    }));
  const evChargeExemptions = appliedTransactions
    .filter(
      (transaction) =>
        transaction.isEvChargeAllocated &&
        transaction.evChargeAllocatedCents > 0,
    )
    .map((transaction) => ({
      ...transaction,
      amountCents: transaction.evChargeAllocatedCents,
    }));

  return {
    spendingTransactions: sortDashboardTransactions(spendingTransactions),
    exemptTransactions: sortDashboardTransactions([
      ...excludedTransactions,
      ...gasExemptions,
      ...evChargeExemptions,
    ]),
  };
}

export function sortChronologicalTransactions<T extends ChronologicalTransaction>(
  transactions: T[],
): T[] {
  return [...transactions].sort(compareTransactionsByTime);
}

export function compareTransactionsByTime<T extends ChronologicalTransaction>(
  left: T,
  right: T,
): number {
  const dateCompare = left.date.localeCompare(right.date);

  if (dateCompare !== 0) {
    return dateCompare;
  }

  const timeCompare = transactionTimeSortValue(left) - transactionTimeSortValue(right);

  if (timeCompare !== 0) {
    return timeCompare;
  }

  const createdAtCompare = left.createdAt.localeCompare(right.createdAt);

  if (createdAtCompare !== 0) {
    return createdAtCompare;
  }

  return left.id.localeCompare(right.id);
}

function transactionTimeSortValue(transaction: ChronologicalTransaction): number {
  const rawTime = transaction.time?.trim();

  if (!rawTime) {
    return TIMELESS_SORT_VALUE;
  }

  const timestamp = Date.parse(rawTime);

  if (Number.isFinite(timestamp)) {
    const date = new Date(timestamp);
    return date.getHours() * 60 + date.getMinutes();
  }

  const twelveHourMatch = rawTime.match(
    /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])\.?m\.?$/i,
  );

  if (twelveHourMatch) {
    const hour = Number(twelveHourMatch[1]);
    const minute = Number(twelveHourMatch[2]);
    const period = twelveHourMatch[3].toLowerCase();
    const normalizedHour =
      period === "a" ? hour % 12 : hour === 12 ? 12 : hour + 12;

    return normalizedHour * 60 + minute;
  }

  const twentyFourHourMatch = rawTime.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);

  if (twentyFourHourMatch) {
    return Number(twentyFourHourMatch[1]) * 60 + Number(twentyFourHourMatch[2]);
  }

  return TIMELESS_SORT_VALUE;
}
