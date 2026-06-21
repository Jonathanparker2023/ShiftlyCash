import { requireUserWithBootstrapStatus } from "@/lib/auth";
import { dollarsToCents } from "@/lib/domain/money";

export type JobsCustomJob = {
  id: string;
  name: string;
  color: string;
  regularRateCents: number;
  otRateCents: number;
  active: boolean;
};

export type JobsBuiltin = {
  key: "ability" | "prestige" | "prestige_ilst";
  label: string;
  color: string; // the (currently fixed) display color, for reference
  regularRateCents: number;
  otRateCents: number;
};

export type JobsData = {
  customJobs: JobsCustomJob[];
  builtins: JobsBuiltin[];
};

type NumericValue = number | string | null;

function toNumber(value: NumericValue): number {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getJobsData(): Promise<JobsData> {
  const { supabase, user } = await requireUserWithBootstrapStatus();

  const [
    { data: jobData, error: jobError },
    { data: settingsData, error: settingsError },
  ] = await Promise.all([
    supabase
      .from("custom_jobs")
      .select("id,name,color,regular_rate_cents,ot_rate_cents,active")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("settings")
      .select(
        "ability_regular_net_rate,ability_ot_net_rate,prestige_regular_net_rate,prestige_ot_net_rate,prestige_ilst_net_rate,prestige_ilst_ot_net_rate",
      )
      .eq("user_id", user.id)
      .single(),
  ]);

  if (jobError) {
    throw new Error(`Unable to load custom jobs: ${jobError.message}`);
  }
  if (settingsError) {
    throw new Error(`Unable to load pay settings: ${settingsError.message}`);
  }

  const s = settingsData as Record<string, NumericValue>;
  const customJobs = (
    (jobData ?? []) as {
      id: string;
      name: string;
      color: string;
      regular_rate_cents: NumericValue;
      ot_rate_cents: NumericValue;
      active: boolean;
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    regularRateCents: Math.round(toNumber(row.regular_rate_cents)),
    otRateCents: Math.round(toNumber(row.ot_rate_cents)),
    active: row.active,
  }));

  const builtins: JobsBuiltin[] = [
    {
      key: "ability",
      label: "Ability",
      color: "#1d4ed8",
      regularRateCents: dollarsToCents(toNumber(s.ability_regular_net_rate)),
      otRateCents: dollarsToCents(toNumber(s.ability_ot_net_rate)),
    },
    {
      key: "prestige",
      label: "Prestige",
      color: "#facc15",
      regularRateCents: dollarsToCents(toNumber(s.prestige_regular_net_rate)),
      otRateCents: dollarsToCents(toNumber(s.prestige_ot_net_rate)),
    },
    {
      key: "prestige_ilst",
      label: "Prestige ILST",
      color: "#facc15",
      regularRateCents: dollarsToCents(toNumber(s.prestige_ilst_net_rate)),
      otRateCents: dollarsToCents(toNumber(s.prestige_ilst_ot_net_rate)),
    },
  ];

  return { customJobs, builtins };
}
