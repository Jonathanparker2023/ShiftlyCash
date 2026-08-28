import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { dollarsToCents } from "@/lib/domain/money";
import { getDeployableBalance } from "@/lib/plaid/deployableBalance";

export type ProjectionCashBalance = {
  availableCashCents: number;
  asOf: string | null;
  source: "plaid" | "cache" | "unavailable";
  stale: boolean;
};

export async function getProjectionCashBalance({
  supabase,
  userId,
}: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<ProjectionCashBalance> {
  try {
    const payload = await getDeployableBalance({
      supabase,
      userId,
    });

    if (!payload.has_fetched) {
      return unavailableCashBalance();
    }

    return {
      availableCashCents: dollarsToCents(payload.deployable_balance),
      asOf: payload.as_of,
      source: payload.source,
      stale: payload.stale,
    };
  } catch {
    return unavailableCashBalance();
  }
}

function unavailableCashBalance(): ProjectionCashBalance {
  return {
    availableCashCents: 0,
    asOf: null,
    source: "unavailable",
    stale: true,
  };
}
