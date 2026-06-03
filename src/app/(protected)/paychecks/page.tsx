import { redirect } from "next/navigation";

import { PaycheckAuditPage } from "@/components/paychecks/PaycheckAuditPage";
import { CAPABILITIES } from "@/lib/edition";
import { getPaycheckAuditData } from "@/lib/paychecks/data";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!CAPABILITIES.showPaycheckAudit) {
    redirect("/");
  }

  const data = await getPaycheckAuditData();

  return <PaycheckAuditPage initialData={data} />;
}
