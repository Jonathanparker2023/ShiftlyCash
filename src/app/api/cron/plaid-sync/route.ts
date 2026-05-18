import { NextResponse } from "next/server";

import { syncTransactionsActionForItem } from "@/app/(protected)/banking/actions";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

type Summary = {
  added: number;
  modified: number;
  removed: number;
  normalized: number;
};

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  const provided = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");

  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("plaid_items")
    .select("plaid_item_id,status,access_token_encrypted");

  if (error) {
    return NextResponse.json(
      { error: `Unable to load Plaid items: ${error.message}` },
      { status: 500 },
    );
  }

  const totals: Summary = { added: 0, modified: 0, removed: 0, normalized: 0 };
  const perItem: Array<{
    plaid_item_id: string;
    ok: boolean;
    added?: number;
    modified?: number;
    removed?: number;
    error?: string;
  }> = [];

  for (const item of data ?? []) {
    if (!item.access_token_encrypted || item.status === "login_required") {
      perItem.push({
        plaid_item_id: item.plaid_item_id,
        ok: false,
        error: "skipped (no token or login required)",
      });
      continue;
    }

    try {
      const result = await syncTransactionsActionForItem(item.plaid_item_id);
      totals.added += result.added;
      totals.modified += result.modified;
      totals.removed += result.removed;
      totals.normalized += result.normalized;
      perItem.push({
        plaid_item_id: item.plaid_item_id,
        ok: true,
        added: result.added,
        modified: result.modified,
        removed: result.removed,
      });
    } catch (err) {
      console.error(
        `[cron/plaid-sync] item ${item.plaid_item_id} failed:`,
        err instanceof Error ? err.message : err,
      );
      perItem.push({
        plaid_item_id: item.plaid_item_id,
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ ok: true, totals, items: perItem });
}
