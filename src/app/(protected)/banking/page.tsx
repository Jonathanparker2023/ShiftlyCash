import { BankingClient } from "@/components/banking/BankingClient";
import { getBankingData } from "@/lib/banking/data";

export default async function BankingPage() {
  const data = await getBankingData();
  const pageKey = [
    data.config.isConfigured,
    `${data.liveBalance.hasFetched}:${data.liveBalance.asOf}:${data.liveBalance.availableCashCents}`,
    data.items.map((item) => `${item.id}:${item.status}:${item.lastSyncedAt}`).join("|"),
    data.pendingTransactions
      .map((transaction) => `${transaction.id}:${transaction.dayId}:${transaction.status}`)
      .join("|"),
  ].join("::");

  return <BankingClient initialData={data} key={pageKey} />;
}
