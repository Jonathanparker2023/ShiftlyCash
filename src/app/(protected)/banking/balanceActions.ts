"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { getPlaidServerEnv } from "@/lib/env";
import { refreshDeployableBalance } from "@/lib/plaid/deployableBalance";
import { createAdminClient } from "@/lib/supabase/admin";

export type RefreshLiveBalancesResult = {
  ok: true;
  asOf: string;
  deployableBalance: number;
};

export async function refreshLiveBalancesAction(): Promise<RefreshLiveBalancesResult> {
  const { user } = await requireUser();
  const config = getPlaidServerEnv();
  const payload = await refreshDeployableBalance({
    supabase: createAdminClient(),
    userId: user.id,
    encryptionKey: config.tokenEncryptionKey,
  });

  revalidatePath("/");
  revalidatePath("/banking");
  revalidatePath("/debt");
  revalidatePath("/goals");
  revalidatePath("/net-worth");

  return {
    ok: true,
    asOf: payload.as_of,
    deployableBalance: payload.deployable_balance,
  };
}
