import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPA_URL, process.env.SUPA_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Locked net rates (from projections defaults)
const ABIL_REG = 15.63;
const ABIL_OT = 21.73;
const PREST_REG = 14.62;
const PREST_OT = 21.93;
const JOB3_GROSS = 19.0;
const JOB3_NET_RATIO = 15.63 / 19.055; // mirror Ability's effective withholding
const JOB3_REG = JOB3_GROSS * JOB3_NET_RATIO;
const RECURRING_BASE = 30; // Ability night shift hrs/wk

const { data: profile } = await supabase
  .from("profiles")
  .select("id")
  .order("created_at", { ascending: true })
  .limit(1)
  .single();
const userId = profile.id;

const { data: weeks } = await supabase
  .from("v_week_totals")
  .select("week_id,start_date,display_week_number,status")
  .eq("user_id", userId)
  .order("start_date", { ascending: false })
  .limit(20);
weeks.reverse();

const { data: days } = await supabase
  .from("days")
  .select("id,week_id")
  .eq("user_id", userId)
  .in("week_id", weeks.map((w) => w.week_id));

const dayToWeek = new Map(days.map((d) => [d.id, d.week_id]));
const { data: slots } = await supabase
  .from("earn_slots")
  .select("day_id,job_type,pay_type,hours_or_units,regular_hours,overtime_hours")
  .eq("user_id", userId)
  .in("day_id", days.map((d) => d.id));

const num = (v) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const byWeek = new Map(
  weeks.map((w) => [
    w.week_id,
    { start: w.start_date, num: w.display_week_number, status: w.status,
      aReg: 0, aOT: 0, pReg: 0, pOT: 0 },
  ]),
);

for (const s of slots) {
  const wk = byWeek.get(dayToWeek.get(s.day_id));
  if (!wk) continue;
  let reg = 0, ot = 0;
  if (s.pay_type === "split") { reg = num(s.regular_hours); ot = num(s.overtime_hours); }
  else if (s.pay_type === "regular") { reg = num(s.regular_hours) || num(s.hours_or_units); }
  else if (s.pay_type === "overtime") { ot = num(s.overtime_hours) || num(s.hours_or_units); }
  if (s.job_type === "ability" || s.job_type === "ability_incentive") { wk.aReg += reg; wk.aOT += ot; }
  else if (s.job_type === "prestige" || s.job_type === "prestige_ilst") { wk.pReg += reg; wk.pOT += ot; }
}

const rows = [...byWeek.values()];
console.log("wk#  start       | A reg | A OT | A total | pickups | P reg | P OT | flag");
const clean = [];
for (const w of rows) {
  const aTotal = w.aReg + w.aOT;
  const pickups = aTotal - RECURRING_BASE;
  let flag = "";
  if (aTotal === 0) flag = "ZERO-WEEK (excluded)";
  else if (pickups <= 0) flag = "no-pickups (excluded)";
  else if (aTotal > 40 && w.aOT === 0) flag = "OT-anomaly (excluded)";
  else if (w.status === "active") flag = "active (excluded)";
  else clean.push({ ...w, aTotal, pickups });
  console.log(
    `${String(w.num).padStart(3)}  ${w.start} | ${w.aReg.toFixed(1).padStart(5)} | ${w.aOT.toFixed(1).padStart(4)} | ${aTotal.toFixed(1).padStart(7)} | ${pickups.toFixed(1).padStart(7)} | ${w.pReg.toFixed(1).padStart(5)} | ${w.pOT.toFixed(1).padStart(4)} | ${flag}`,
  );
}

const last10 = clean.slice(-10);
console.log("\nClean weeks used:", last10.map((w) => w.num).join(", "));

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const pickups = last10.map((w) => w.pickups);
const aRegAvg = avg(last10.map((w) => w.aReg));
const aOTAvg = avg(last10.map((w) => w.aOT));
// Prestige clean = weeks with OT>0 (his locked recurring pattern)
const prestClean = last10.filter((w) => w.pOT > 0);
const pRegAvg = prestClean.length ? avg(prestClean.map((w) => w.pReg)) : 40;
const pOTAvg = prestClean.length ? avg(prestClean.map((w) => w.pOT)) : 8;

console.log(`\nAbility pickups/wk: avg ${avg(pickups).toFixed(1)}, median ${med(pickups).toFixed(1)}`);
console.log(`Ability reg avg ${aRegAvg.toFixed(1)}, OT avg ${aOTAvg.toFixed(1)}`);
console.log(`Prestige clean weeks: ${prestClean.length}/${last10.length} -> reg ${pRegAvg.toFixed(1)}, OT ${pOTAvg.toFixed(1)}`);

// Today's net baseline from the same clean weeks
const todayNet =
  aRegAvg * ABIL_REG + aOTAvg * ABIL_OT + pRegAvg * PREST_REG + pOTAvg * PREST_OT;

// SCENARIO A: night shift pulled. Pickups stay, OT only where pickups alone > 40.
// Prestige loses 12 hrs (8 OT + 4 reg). Job 3: 4 nights.
const scenA_ability = last10.map((w) => {
  const reg = Math.min(40, w.pickups);
  const ot = Math.max(0, w.pickups - 40);
  return reg * ABIL_REG + ot * ABIL_OT;
});
const pNetCut = Math.max(0, pRegAvg - 4) * PREST_REG + 0 * PREST_OT;

// SCENARIO B: keep ALL ability as-is, cut prestige 12 hrs, add job 3.
const scenB_ability = aRegAvg * ABIL_REG + aOTAvg * ABIL_OT;

for (const nightLen of [8, 10, 12]) {
  const hrs = nightLen * 4;
  const j3 =
    Math.min(40, hrs) * JOB3_REG +
    Math.max(0, hrs - 40) * JOB3_REG * 1.5;
  const A = avg(scenA_ability) + pNetCut + j3;
  const B = scenB_ability + pNetCut + j3;
  console.log(
    `\n4x${nightLen}h nights (${hrs} hrs, job3 net $${j3.toFixed(0)}):` +
      `\n  Scenario A (night shift pulled): $${A.toFixed(0)}/wk net` +
      `\n  Scenario B (keep ability, cut prestige 12h): $${B.toFixed(0)}/wk net`,
  );
}
console.log(`\nToday's baseline (same clean weeks): $${todayNet.toFixed(0)}/wk net`);
console.log(`Job3 net rate used: $${JOB3_REG.toFixed(2)}/hr (Ability-style withholding)`);
