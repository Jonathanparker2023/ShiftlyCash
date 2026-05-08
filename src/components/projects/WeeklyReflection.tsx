import { requireUser } from "@/lib/auth";
import {
  getCurrentWeekReflection,
} from "@/lib/projects/data";
import type { WeeklyReflection as WeeklyReflectionData } from "@/lib/projects/types";

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

  if (!shouldRenderWeeklyReflection(todayIso, reflection)) {
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
  reflection: WeeklyReflectionData | null,
): boolean {
  if (!reflection) {
    return true;
  }

  const day = new Date(`${todayIso}T00:00:00.000Z`).getUTCDay();
  return day === 5 || day === 6 || day === 0;
}
