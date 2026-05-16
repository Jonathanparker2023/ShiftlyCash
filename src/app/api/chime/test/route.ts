import { NextResponse } from "next/server";

const SECRET_ENV = "CHIME_INGEST_SECRET";

export async function POST(request: Request) {
  const expected = process.env[SECRET_ENV];
  if (!expected) {
    return NextResponse.json({ error: `${SECRET_ENV} not configured` }, { status: 500 });
  }

  const provided = request.headers.get("x-chime-ingest-key");
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fixture = {
    text: "Spent $12.34 at TEST MERCHANT",
    receivedAt: new Date().toISOString(),
    notificationTitle: "Chime",
    shortcutVersion: "test-fixture",
  };

  const url = new URL("/api/chime/ingest", request.url).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chime-ingest-key": expected,
    },
    body: JSON.stringify(fixture),
  });

  const result = (await res.json()) as unknown;
  return NextResponse.json({ ok: res.ok, ingest_response: result });
}
