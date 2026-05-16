import { createHash, timingSafeEqual } from "crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";

import { syncTransactionsActionForItem } from "@/app/(protected)/banking/actions";
import { getPlaidClient } from "@/lib/plaid/client";

export const maxDuration = 60;
export const runtime = "nodejs";

type PlaidWebhookPayload = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
};

export async function POST(request: Request) {
  const verificationHeader = request.headers.get("plaid-verification");
  const rawBody = await request.text();

  if (!verificationHeader) {
    return NextResponse.json(
      { error: "Missing verification header" },
      { status: 401 },
    );
  }

  const verified = await verifyPlaidWebhook(verificationHeader, rawBody);
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: PlaidWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as PlaidWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.info(
    `[plaid/webhook] type=${payload.webhook_type} code=${payload.webhook_code} item_id=${payload.item_id}`,
  );

  if (
    payload.webhook_type === "TRANSACTIONS" &&
    payload.webhook_code === "SYNC_UPDATES_AVAILABLE" &&
    payload.item_id
  ) {
    try {
      const result = await syncTransactionsActionForItem(payload.item_id);
      console.info(
        `[plaid/webhook] synced item ${payload.item_id}: ${result.added} added, ${result.modified} modified`,
      );
      revalidatePath("/");
      revalidatePath("/banking");
    } catch (error) {
      console.error(
        `[plaid/webhook] sync failed for item ${payload.item_id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "plaid/webhook" });
}

async function verifyPlaidWebhook(
  signedJwt: string,
  rawBody: string,
): Promise<boolean> {
  try {
    const header = decodeProtectedHeader(signedJwt);
    if (header.alg !== "ES256" || typeof header.kid !== "string") {
      return false;
    }

    const client = getPlaidClient();
    const keyResponse = await client.webhookVerificationKeyGet({
      key_id: header.kid,
    });
    const publicKey = await importJWK(keyResponse.data.key as JWK, "ES256");
    const { payload } = await jwtVerify(signedJwt, publicKey, {
      algorithms: ["ES256"],
      maxTokenAge: "5 min",
    });

    if (typeof payload.request_body_sha256 !== "string") {
      return false;
    }

    const bodyHash = createHash("sha256").update(rawBody).digest("hex");
    return timingSafeHexEqual(bodyHash, payload.request_body_sha256);
  } catch (error) {
    console.error(
      "[plaid/webhook] verification failed:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

function timingSafeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
