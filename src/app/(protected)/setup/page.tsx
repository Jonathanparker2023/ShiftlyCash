import { redirect } from "next/navigation";

import { SetupWizard } from "@/components/setup/SetupWizard";
import { CAPABILITIES } from "@/lib/edition";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!CAPABILITIES.showSetup) {
    redirect("/");
  }

  return <SetupWizard />;
}
