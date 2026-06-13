import { redirect } from "next/navigation";

import { ScreenerView } from "@/components/screener/ScreenerView";
import { CAPABILITIES } from "@/lib/edition";
import { getLatestScreenerSnapshot } from "@/lib/screener/snapshot";

export const dynamic = "force-dynamic";

export default async function ScreenerPage() {
  if (!CAPABILITIES.showScreener) {
    redirect("/");
  }

  const state = await getLatestScreenerSnapshot();

  return <ScreenerView state={state} />;
}
