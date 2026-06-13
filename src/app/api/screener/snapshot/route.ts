import { NextResponse, type NextRequest } from "next/server";

import {
  isNewerGeneratedAt,
  validateSnapshotPayload,
} from "@/lib/screener/snapshot";
import { createAdminClient } from "@/lib/supabase/admin";

const LEDGER_TOKEN_ENV = "SHIFTLYCASH_LEDGER_TOKEN";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = authorizeSnapshotRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const validation = validateSnapshotPayload(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: latest, error: latestError } = await supabase
    .from("screener_snapshots")
    .select("generated_at")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    console.error(`[screener/snapshot] latest lookup failed: ${latestError.message}`);
    return NextResponse.json({ error: "Snapshot lookup failed." }, { status: 500 });
  }

  const latestGeneratedAt =
    latest && typeof latest.generated_at === "string" ? latest.generated_at : null;

  if (!isNewerGeneratedAt(validation.generatedAt, latestGeneratedAt)) {
    return NextResponse.json({
      skipped: "not newer",
      generated_at: validation.generatedAt,
      latest_generated_at: latestGeneratedAt,
    });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("screener_snapshots")
    .insert({
      snapshot_id: validation.snapshotId,
      as_of: validation.asOf,
      generated_at: validation.generatedAt,
      payload: validation.payload,
    })
    .select("id,generated_at")
    .single();

  if (insertError) {
    console.error(`[screener/snapshot] insert failed: ${insertError.message}`);
    return NextResponse.json({ error: "Snapshot insert failed." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: inserted?.id ?? null,
    generated_at: inserted?.generated_at ?? validation.generatedAt,
  });
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;

function authorizeSnapshotRequest(
  request: Request,
):
  | { ok: true }
  | { ok: false; response: NextResponse<{ error: string }> } {
  const token = process.env[LEDGER_TOKEN_ENV];

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${LEDGER_TOKEN_ENV} is not configured.` },
        { status: 500 },
      ),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (provided !== token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}

function methodNotAllowed() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
