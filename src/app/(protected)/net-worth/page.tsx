import { NetWorthPage } from "@/components/net-worth/NetWorthPage";
import { getNetWorthData } from "@/lib/net-worth/data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const data = await getNetWorthData();

  return <NetWorthPage initialData={data} />;
}
