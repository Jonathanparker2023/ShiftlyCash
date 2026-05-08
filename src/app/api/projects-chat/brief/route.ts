import { NextResponse } from "next/server";

import { generateDailyBrief } from "@/lib/claude/dailyBrief";
import { DailyCapExceededError } from "@/lib/claude/usage";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await generateDailyBrief(supabase, user.id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DailyCapExceededError) {
      return NextResponse.json(
        {
          error: "daily_cap_exceeded",
          usedCents: error.usedCents,
          capCents: error.capCents,
          resetsAtIso: error.resetsAtIso,
        },
        { status: 429 },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Project brief request failed.",
      },
      { status: 500 },
    );
  }
}
