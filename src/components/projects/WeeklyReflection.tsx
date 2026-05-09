import { requireUser } from "@/lib/auth";
import {
  getCurrentWeekReflection,
} from "@/lib/projects/data";

import { WeeklyReflectionClient } from "./WeeklyReflectionClient";

export async function WeeklyReflection({
  todayIso,
  weekStartIso,
}: {
  todayIso: string;
  weekStartIso: string;
}) {
  const { supabase } = await requireUser();
  const reflection = await getCurrentWeekReflection(supabase, weekStartIso);

  if (!shouldRenderWeeklyReflection(todayIso, weekStartIso)) {
    return null;
  }

  return (
    <WeeklyReflectionClient
      reflection={reflection}
      weekStartIso={weekStartIso}
    />
  );
}

export function shouldRenderWeeklyReflection(
  todayIso: string,
  weekStartIso: string,
): boolean {
  const finalDay = new Date(`${weekStartIso}T00:00:00.000Z`);
  finalDay.setUTCDate(finalDay.getUTCDate() + 6);

  return todayIso === finalDay.toISOString().slice(0, 10);
}
