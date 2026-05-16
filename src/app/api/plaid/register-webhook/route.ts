import { NextResponse } from "next/server";

import { getPlaidServerEnv } from "@/lib/env";
import { decryptAccessToken } from "@/lib/plaid/crypto";
import { getPlaidClient } from "@/lib/plaid/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * One-shot admin endpoint to register the Plaid webhook URL on every active
 * Plaid Item. Auth via SHIFTLYCASH_LEDGER_TOKEN (same as other admin paths).
 *
 * Run once via curl after deploy:
 *   curl -X POST -H "Authorization: Bearer $TOKEN" \
 *     https://shiftlycash.vercel.app/api/plaid/register-webhook
 *
 * Idempotent — safe to re-run.
 */
export async function POST(request: Request) {
  const expected = process.env.SHIFTLYCASH_LEDGER_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "SHIFTLYCASH_LEDGER_TOKEN not configured" },
      { status: 500 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const webhookUrl = process.env.PLAID_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "PLAID_WEBHOOK_URL not configured" },
      { status: 500 },
    );
  }

  const config = getPlaidServerEnv();
  const supabase = createAdminClient();
  const plaid = getPlaidClient();

  const { data: items, error } = await supabase
    .from("plaid_items")
    .select("id,plaid_item_id,access_token_encrypted,status")
    .not("access_token_encrypted", "is", null);

  if (error) {
    return NextResponse.json(
      { error: `Unable to load Plaid items: ${error.message}` },
      { status: 500 },
    );
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const item of items ?? []) {
    try {
      if (!item.access_token_encrypted) continue;
      const accessToken = decryptAccessToken(
        item.access_token_encrypted as string,
        config.tokenEncryptionKey,
      );
      await plaid.itemWebhookUpdate({
        access_token: accessToken,
        webhook: webhookUrl,
      });
      results.push({ id: item.id as string, ok: true });
    } catch (err) {
      results.push({
        id: item.id as string,
        ok: false,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    webhook_url: webhookUrl,
    items: results.length,
    results,
  });
}
