import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";

// ONE-OFF maintenance endpoint: reset a week's earn slots and re-apply the
// CURRENT default template (the app only applies templates at week creation).
// Auth-gated by the normal session; scoped by RLS. Returns the pre-reset slot
// rows as an inline backup plus the refreshed schedule. Remove after use.
export async function GET(request: Request) {
  const { supabase, user } = await requireUser();
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("week");

  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ error: "Pass ?week=YYYY-MM-DD" }, { status: 400 });
  }

  const { data: week, error: weekError } = await supabase
    .from("weeks")
    .select("id,start_date,status")
    .eq("user_id", user.id)
    .eq("start_date", startDate)
    .maybeSingle();
  if (weekError || !week) {
    return NextResponse.json(
      { error: weekError?.message ?? "Week not found." },
      { status: 404 },
    );
  }

  const { data: days, error: daysError } = await supabase
    .from("days")
    .select("id,date,day_index")
    .eq("user_id", user.id)
    .eq("week_id", week.id);
  if (daysError || !days?.length) {
    return NextResponse.json(
      { error: daysError?.message ?? "No days found." },
      { status: 500 },
    );
  }
  const dayIds = days.map((d) => d.id);

  const { data: backup, error: backupError } = await supabase
    .from("earn_slots")
    .select("*")
    .in("day_id", dayIds);
  if (backupError) {
    return NextResponse.json({ error: backupError.message }, { status: 500 });
  }

  const { error: resetError } = await supabase
    .from("earn_slots")
    .update({
      job_type: "none",
      pay_type: "none",
      hours_or_units: 0,
      regular_hours: 0,
      overtime_hours: 0,
      incentive_mode: "none",
      incentive_rate: 0,
      incentive_amount: 0,
      custom_job_id: null,
      label: null,
      source: "template",
    })
    .in("day_id", dayIds)
    .eq("user_id", user.id);
  if (resetError) {
    return NextResponse.json(
      { error: `Reset failed: ${resetError.message}`, backup },
      { status: 500 },
    );
  }

  const { data: filled, error: applyError } = await supabase.rpc(
    "apply_default_template_to_week",
    { p_week_id: week.id },
  );
  if (applyError) {
    return NextResponse.json(
      { error: `Apply failed: ${applyError.message}`, backup },
      { status: 500 },
    );
  }

  const { data: after } = await supabase
    .from("earn_slots")
    .select("day_id,slot_index,job_type,pay_type,hours_or_units,label,custom_job_id")
    .in("day_id", dayIds)
    .neq("job_type", "none")
    .order("slot_index");

  const dateByDayId = new Map(days.map((d) => [d.id, d.date]));
  return NextResponse.json({
    ok: true,
    week: week.start_date,
    slotsFilled: filled,
    schedule: (after ?? [])
      .map((s) => ({ ...s, date: dateByDayId.get(s.day_id) }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.slot_index - b.slot_index),
    backup,
  });
}
