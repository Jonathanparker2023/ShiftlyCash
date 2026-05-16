import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

const SECRET_ENV = "CHIME_INGEST_SECRET";

export async function POST(request: Request) {
  const expected = process.env[SECRET_ENV];
  if (!expected) {
    return NextResponse.json(
      { error: `${SECRET_ENV} not configured` },
      { status: 500 },
    );
  }

  const provided = request.headers.get("x-chime-ingest-key");
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const obj = body as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  const receivedAt =
    typeof obj.receivedAt === "string" ? obj.receivedAt : new Date().toISOString();

  if (!text) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (profileError || !profile?.id) {
    return NextResponse.json(
      { error: `Unable to resolve user: ${profileError?.message ?? "no profile"}` },
      { status: 500 },
    );
  }

  const sourceMeta: Record<string, unknown> = {};
  if (typeof obj.notificationTitle === "string") {
    sourceMeta.title = obj.notificationTitle;
  }
  if (typeof obj.appBundle === "string") {
    sourceMeta.appBundle = obj.appBundle;
  }
  if (typeof obj.shortcutVersion === "string") {
    sourceMeta.shortcutVersion = obj.shortcutVersion;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("chime_raw_captures")
    .insert({
      user_id: profile.id as string,
      raw_text: text,
      received_at: receivedAt,
      source_meta: Object.keys(sourceMeta).length > 0 ? sourceMeta : null,
    })
    .select("id")
    .single();

  if (insertError) {
    return NextResponse.json(
      { error: `Insert failed: ${insertError.message}` },
      { status: 500 },
    );
  }

  console.info(`[chime/ingest] captured ${inserted.id}: ${text.slice(0, 80)}`);

  return NextResponse.json({ ok: true, id: inserted.id });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "chime/ingest",
    mode: "capture-only",
  });
}
