import { redirect } from "next/navigation";

import { GoalsExperience } from "@/components/goals/GoalsExperience";
import { CAPABILITIES } from "@/lib/edition";
import { getGoalsData } from "@/lib/goals/data";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  if (!CAPABILITIES.showGoals) {
    redirect("/");
  }

  const data = await getGoalsData();

  return <GoalsExperience data={data} />;
}
