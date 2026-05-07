import { NextResponse } from "next/server";

import { getDailyUsageCents } from "@/lib/claude/usage";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const usage = await getDailyUsageCents(supabase, user.id);
    return NextResponse.json(usage);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load chat usage.",
      },
      { status: 500 },
    );
  }
}
