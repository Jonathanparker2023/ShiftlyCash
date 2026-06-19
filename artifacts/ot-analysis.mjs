import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPA_URL, process.env.SUPA_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: profile } = await supabase
  .from("profiles")
  .select("id")
  .order("created_at", { ascending: true })
  .limit(1)
  .single();
const userId = profile.id;

// Last 12 weeks (closed + active)
const { data: weeks, error: weekErr } = await supabase
  .from("v_week_totals")
  .select("week_id,start_date,end_date,display_week_number,status")
  .eq("user_id", userId)
  .order("start_date", { ascending: false })
  .limit(12);
if (weekErr) throw new Error(weekErr.message);
weeks.reverse();

const weekIds = weeks.map((w) => w.week_id);
const { data: days, error: dayErr } = await supabase
  .from("days")
  .select("id,week_id,date")
  .eq("user_id", userId)
  .in("week_id", weekIds);
if (dayErr) throw new Error(dayErr.message);

const dayToWeek = new Map(days.map((d) => [d.id, d.week_id]));
const { data: slots, error: slotErr } = await supabase
  .from("earn_slots")
  .select(
    "day_id,job_type,pay_type,hours_or_units,regular_hours,overtime_hours,label,source",
  )
  .eq("user_id", userId)
  .in("day_id", days.map((d) => d.id));
if (slotErr) throw new Error(slotErr.message);

const num = (v) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const byWeek = new Map();
for (const w of weeks) {
  byWeek.set(w.week_id, {
    start: w.start_date,
    num: w.display_week_number,
    status: w.status,
    abilityReg: 0,
    abilityOT: 0,
    prestigeReg: 0,
    prestigeOT: 0,
    abilitySlots: 0,
    prestigeSlots: 0,
  });
}

for (const s of slots) {
  const wk = byWeek.get(dayToWeek.get(s.day_id));
  if (!wk) continue;
  let reg = 0;
  let ot = 0;
  if (s.pay_type === "split") {
    reg = num(s.regular_hours);
    ot = num(s.overtime_hours);
  } else if (s.pay_type === "regular") {
    reg = num(s.regular_hours) || num(s.hours_or_units);
  } else if (s.pay_type === "overtime") {
    ot = num(s.overtime_hours) || num(s.hours_or_units);
  }
  if (s.job_type === "ability" || s.job_type === "ability_incentive") {
    wk.abilityReg += reg;
    wk.abilityOT += ot;
    wk.abilitySlots += 1;
  } else if (s.job_type === "prestige" || s.job_type === "prestige_ilst") {
    wk.prestigeReg += reg;
    wk.prestigeOT += ot;
    wk.prestigeSlots += 1;
  }
}

console.log(
  "wk#  start       status  | Abil reg | Abil OT | Prest reg | Prest OT",
);
for (const w of byWeek.values()) {
  console.log(
    `${String(w.num).padStart(3)}  ${w.start}  ${w.status.padEnd(6)} | ${w.abilityReg.toFixed(1).padStart(8)} | ${w.abilityOT.toFixed(1).padStart(7)} | ${w.prestigeReg.toFixed(1).padStart(9)} | ${w.prestigeOT.toFixed(1).padStart(8)}`,
  );
}

const closed = [...byWeek.values()].filter((w) => w.status === "closed");
const last10 = closed.slice(-10);
const abilOT = last10.map((w) => w.abilityOT);
const prestOT = last10.map((w) => w.prestigeOT);
const sum = (a) => a.reduce((x, y) => x + y, 0);
console.log("\n--- last", last10.length, "closed weeks ---");
console.log("Ability OT hrs/wk:", abilOT.map((v) => v.toFixed(1)).join(", "));
console.log(
  "  avg:",
  (sum(abilOT) / abilOT.length).toFixed(2),
  "| weeks with OT>0:",
  abilOT.filter((v) => v > 0).length,
  "/",
  abilOT.length,
  "| avg when >0:",
  (sum(abilOT) / Math.max(1, abilOT.filter((v) => v > 0).length)).toFixed(2),
);
console.log("Prestige OT hrs/wk:", prestOT.map((v) => v.toFixed(1)).join(", "));
console.log(
  "  avg:",
  (sum(prestOT) / prestOT.length).toFixed(2),
  "| weeks with OT>0:",
  prestOT.filter((v) => v > 0).length,
  "/",
  prestOT.length,
);

