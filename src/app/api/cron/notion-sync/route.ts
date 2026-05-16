import { NextResponse } from "next/server";

import { runNotionSync } from "@/lib/notion-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  try {
    const result = await runNotionSync();
    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "[cron/notion-sync] failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Notion sync failed",
      },
      { status: 500 },
    );
  }
}
