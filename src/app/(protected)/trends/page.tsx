import { redirect } from "next/navigation";

import { TrendsView } from "@/components/trends/TrendsView";
import { CAPABILITIES } from "@/lib/edition";
import { getTrendsData } from "@/lib/trends/data";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  if (!CAPABILITIES.showTrends) {
    redirect("/");
  }

  const data = await getTrendsData();

  return <TrendsView initialData={data} />;
}
