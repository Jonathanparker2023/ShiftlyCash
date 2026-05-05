import { HistoryTable } from "@/components/history/HistoryTable";
import { getHistoryData } from "@/lib/history/data";

export default async function HistoryPage() {
  const data = await getHistoryData();
  const tableKey = data.weeks
    .map(
      (week) =>
        `${week.id}:${week.earningsCents}:${week.spendCents}:${week.cashflowCents}:${week.exclusions.earnings}:${week.exclusions.spend}:${week.exclusions.cashflow}`,
    )
    .join("|");

  return <HistoryTable initialData={data} key={tableKey} />;
}
