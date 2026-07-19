import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";

// Surgical one-off: set a single transaction's status by id. Session-authed,
// RLS-scoped to the caller. Used to reverse a mistaken status flip on a closed
// week precisely (safer than clicking dedup-duplicated rows in the UI).
// Remove after use.
export async function GET(request: Request) {
  const { supabase, user } = await requireUser();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const status = searchParams.get("status");

  if (!id || (status !== "applied" && status !== "excluded")) {
    return NextResponse.json(
      { error: "Pass ?id=<uuid>&status=applied|excluded" },
      { status: 400 },
    );
  }

  const { data: before } = await supabase
    .from("transactions")
    .select("id,merchant_name,amount,status,date")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("transactions")
    .update({ status })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message, before }, { status: 500 });
  }

  return NextResponse.json({ ok: true, before, nowStatus: status });
}
