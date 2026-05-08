import { PaycheckAuditPage } from "@/components/paychecks/PaycheckAuditPage";
import { getPaycheckAuditData } from "@/lib/paychecks/data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const data = await getPaycheckAuditData();

  return <PaycheckAuditPage initialData={data} />;
}
