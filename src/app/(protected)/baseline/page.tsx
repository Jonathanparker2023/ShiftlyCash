import { BaselineEditor } from "@/components/baseline/BaselineEditor";
import { getBaselineData } from "@/lib/baseline/data";

export default async function BaselinePage() {
  const data = await getBaselineData();
  const editorKey = [
    data.todayIso,
    ...data.expenses.map(
      (expense) =>
        `${expense.id}:${expense.name}:${expense.amountCents}:${expense.expirationDate}:${expense.isActive}:${expense.sortOrder}`,
    ),
  ].join("|");

  return <BaselineEditor initialData={data} key={editorKey} />;
}
