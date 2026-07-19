import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";

// READ-ONLY diagnostic: dump a week's transactions plus recent transaction
// audit-log entries so a mistaken status flip can be identified and reversed
// precisely. No writes. Remove after use.
export async function GET(request: Request) {
  const { supabase, user } = await requireUser();
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("week");
  if (!startDate) {
    return NextResponse.json({ error: "Pass ?week=YYYY-MM-DD" }, { status: 400 });
  }

  const { data: week } = await supabase
    .from("weeks")
    .select("id")
    .eq("user_id", user.id)
    .eq("start_date", startDate)
    .maybeSingle();
  if (!week) {
    return NextResponse.json({ error: "Week not found" }, { status: 404 });
  }

  const { data: days } = await supabase
    .from("days")
    .select("id,date")
    .eq("user_id", user.id)
    .eq("week_id", week.id);
  const dayIds = (days ?? []).map((d) => d.id);
  const dateByDay = new Map((days ?? []).map((d) => [d.id, d.date]));

  const { data: txs } = await supabase
    .from("transactions")
    .select("id,day_id,merchant_name,amount,status,pending")
    .in("day_id", dayIds)
    .order("date", { ascending: true });

  const txIds = (txs ?? []).map((t) => t.id);

  // Recent audit rows for these transactions (status flips carry old/new).
  const { data: audit } = await supabase
    .from("audit_log")
    .select("row_id,action,changed_at,old_data,new_data")
    .eq("table_name", "transactions")
    .in("row_id", txIds)
    .order("changed_at", { ascending: false })
    .limit(40);

  return NextResponse.json({
    week: startDate,
    transactions: (txs ?? []).map((t) => ({
      id: t.id,
      date: dateByDay.get(t.day_id),
      merchant: t.merchant_name,
      amount: t.amount,
      status: t.status,
    })),
    recentAudit: (audit ?? []).map((a) => {
      const oldStatus = (a.old_data as { status?: string } | null)?.status;
      const newStatus = (a.new_data as { status?: string } | null)?.status;
      return {
        txId: a.row_id,
        action: a.action,
        at: a.changed_at,
        statusChange:
          oldStatus !== newStatus ? `${oldStatus} -> ${newStatus}` : null,
        merchant: (a.new_data as { merchant_name?: string } | null)?.merchant_name,
      };
    }),
  });
}
