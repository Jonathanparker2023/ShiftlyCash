import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";

// READ-ONLY diagnostic: line up this week's earn_slots against the default
// template_slots + sticky_labels so we can SEE whether a dashboard shift edit
// actually changed the template (hours/job) or only the shared sticky name.
// No writes. Remove after use.
export async function GET(request: Request) {
  const { supabase, user } = await requireUser();
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("week");
  if (!startDate) {
    return NextResponse.json({ error: "Pass ?week=YYYY-MM-DD (a Sunday)" }, { status: 400 });
  }

  const { data: tpl } = await supabase
    .from("weekly_templates")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: templateSlots } = await supabase
    .from("template_slots")
    .select("day_index,slot_index,job_type,pay_type,hours_or_units")
    .eq("user_id", user.id)
    .eq("template_id", tpl?.id ?? "")
    .neq("job_type", "none")
    .order("day_index")
    .order("slot_index");

  const { data: sticky } = await supabase
    .from("sticky_labels")
    .select("day_index,slot_index,label")
    .eq("user_id", user.id);
  const stickyByKey = new Map(
    (sticky ?? []).map((s) => [`${s.day_index}:${s.slot_index}`, s.label]),
  );

  const { data: week } = await supabase
    .from("weeks")
    .select("id")
    .eq("user_id", user.id)
    .eq("start_date", startDate)
    .maybeSingle();
  const { data: days } = await supabase
    .from("days")
    .select("id,day_index,date")
    .eq("user_id", user.id)
    .eq("week_id", week?.id ?? "");
  const dayIds = (days ?? []).map((d) => d.id);
  const dayMeta = new Map((days ?? []).map((d) => [d.id, d]));

  const { data: weekSlots } = await supabase
    .from("earn_slots")
    .select("day_id,slot_index,job_type,pay_type,hours_or_units,label")
    .in("day_id", dayIds.length ? dayIds : ["00000000-0000-0000-0000-000000000000"])
    .neq("job_type", "none");

  const weekByKey = new Map(
    (weekSlots ?? []).map((s) => {
      const d = dayMeta.get(s.day_id) as { day_index: number } | undefined;
      return [`${d?.day_index}:${s.slot_index}`, s];
    }),
  );

  const rows = (templateSlots ?? []).map((t) => {
    const key = `${t.day_index}:${t.slot_index}`;
    const w = weekByKey.get(key) as
      | { job_type: string; hours_or_units: number; label: string | null }
      | undefined;
    return {
      day_index: t.day_index,
      slot_index: t.slot_index,
      template: { job: t.job_type, hours: t.hours_or_units, name: stickyByKey.get(key) ?? null },
      week: w ? { job: w.job_type, hours: w.hours_or_units, name: w.label } : null,
      hoursMatch: w ? Number(w.hours_or_units) === Number(t.hours_or_units) : null,
      jobMatch: w ? w.job_type === t.job_type : null,
    };
  });

  return NextResponse.json({ week: startDate, rows });
}
