import { NextResponse, type NextRequest } from "next/server";

import { getPlaidServerEnv } from "@/lib/env";
import { getDeployableBalance } from "@/lib/plaid/deployableBalance";
import { createAdminClient } from "@/lib/supabase/admin";

const LEDGER_TOKEN_ENV = "SHIFTLYCASH_LEDGER_TOKEN";
const LEDGER_USER_ID_ENV = "SHIFTLYCASH_LEDGER_USER_ID";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = authorizeLedgerRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const supabase = createAdminClient();
    const userId = await resolveLedgerUserId(supabase);
    const config = getPlaidServerEnv();
    const payload = await getDeployableBalance({
      supabase,
      userId,
      encryptionKey: config.tokenEncryptionKey,
      forcePlaidFailure: shouldForceCachePath(request),
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Deployable balance lookup failed.",
      },
      { status: 500 },
    );
  }
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;

function authorizeLedgerRequest(
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

async function resolveLedgerUserId(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string> {
  const configuredUserId = process.env[LEDGER_USER_ID_ENV];

  if (configuredUserId) {
    return configuredUserId;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error || !data?.id) {
    throw new Error(
      `Unable to resolve ledger user: ${error?.message ?? "missing profile"}`,
    );
  }

  return data.id as string;
}

function shouldForceCachePath(request: NextRequest): boolean {
  if (request.nextUrl.searchParams.get("force_cache") !== "1") {
    return false;
  }

  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ALLOW_DEPLOYABLE_BALANCE_TEST_FAILURE === "true"
  );
}

function methodNotAllowed() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
