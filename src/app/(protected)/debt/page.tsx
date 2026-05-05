import { DebtPage } from "@/components/debt/DebtPage";
import { getDebtData } from "@/lib/debt/data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const data = await getDebtData();
  const debtStateKey = data.debts
    .map(
      (debt) =>
        `${debt.id}:${debt.name}:${debt.balanceCents}:${debt.minimumPaymentCents}:${debt.aprBps}:${debt.status}:${debt.priorityOrder}`,
    )
    .join("|");

  return <DebtPage key={debtStateKey} initialData={data} />;
}
