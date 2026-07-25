// One-call food logging for saved foods, authenticated by the same ledger
// token the nutrition export uses.
//
// Why this exists: logging currently requires opening the app and filling a
// form, and the result is weeks with zero entries — which makes every deficit
// and weight projection on the dashboard fiction. This turns "log the steak
// bowl" into a single request, so it can hang off a Stream Deck key or a voice
// command. No session, no browser.
//
// GET  -> the saved foods available to log (names for the caller to pick from)
// POST -> log one, by name or id, with an optional servings multiplier

import { NextResponse } from "next/server";

import { getTodayIso } from "@/lib/dashboard/dates";
import { createAdminClient } from "@/lib/supabase/admin";

const LEDGER_TOKEN_ENV = "SHIFTLYCASH_LEDGER_TOKEN";
const LEDGER_USER_ID_ENV = "SHIFTLYCASH_LEDGER_USER_ID";

const SAVED_FOOD_COLUMNS =
  "id,name,category,calories,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,added_sugar_g,saturated_fat_g";

type SavedFoodRow = {
  id: string;
  name: string;
  category: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sodium_mg: number | null;
  added_sugar_g: number | null;
  saturated_fat_g: number | null;
};

export async function GET(request: Request) {
  const auth = authorizeLedgerRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createAdminClient();
    const userId = await resolveLedgerUserId(supabase);
    const foods = await listSavedFoods(supabase, userId);
    return NextResponse.json({
      today_iso: getTodayIso(),
      saved_foods: foods.map((f) => ({
        id: f.id,
        name: f.name,
        category: f.category,
        calories: f.calories ?? 0,
        protein_g: f.protein_g,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = authorizeLedgerRequest(request);
  if (!auth.ok) return auth.response;

  let body: {
    food?: unknown;
    servings?: unknown;
    date?: unknown;
    time?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const food = typeof body.food === "string" ? body.food.trim() : "";
  if (!food) {
    return NextResponse.json(
      { error: "food is required (a saved food name or id)." },
      { status: 400 },
    );
  }

  const servings = parseServings(body.servings);
  if (servings === null) {
    return NextResponse.json(
      { error: "servings must be a number greater than 0." },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();
    const userId = await resolveLedgerUserId(supabase);
    const foods = await listSavedFoods(supabase, userId);
    const match = matchSavedFood(foods, food);

    if (match.kind === "none") {
      return NextResponse.json(
        {
          error: `No saved food matches "${food}".`,
          available: foods.map((f) => f.name),
        },
        { status: 404 },
      );
    }
    if (match.kind === "ambiguous") {
      return NextResponse.json(
        {
          error: `"${food}" matches more than one saved food. Be more specific.`,
          candidates: match.candidates.map((f) => f.name),
        },
        { status: 409 },
      );
    }

    const chosen = match.food;
    const date =
      typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date
        : getTodayIso();
    const loggedTime =
      typeof body.time === "string" && /^\d{2}:\d{2}$/.test(body.time)
        ? body.time
        : currentLocalHm();

    // Matches createFoodEntryAction: a real entry replaces the projected plan
    // for that day, otherwise the day double-counts planned + eaten.
    const { error: clearError } = await supabase
      .from("food_entries")
      .delete()
      .eq("user_id", userId)
      .eq("date", date)
      .eq("is_projected_plan", true);
    if (clearError) {
      throw new Error(`Unable to clear projected plan: ${clearError.message}`);
    }

    const scale = (value: number | null) =>
      value === null || value === undefined
        ? null
        : Math.max(0, Math.round(value * servings));

    const { data, error } = await supabase
      .from("food_entries")
      .insert({
        user_id: userId,
        date,
        logged_time: loggedTime,
        meal_name:
          servings === 1 ? chosen.name : `${chosen.name} (${servings}x)`,
        category: chosen.category ?? "other",
        calories: Math.max(0, Math.round((chosen.calories ?? 0) * servings)),
        protein_g: scale(chosen.protein_g),
        carbs_g: scale(chosen.carbs_g),
        fat_g: scale(chosen.fat_g),
        fiber_g: scale(chosen.fiber_g),
        sodium_mg: scale(chosen.sodium_mg),
        added_sugar_g: scale(chosen.added_sugar_g),
        saturated_fat_g: scale(chosen.saturated_fat_g),
        saved_food_id: chosen.id,
        verdict: null,
        verdict_source: "pending",
        verdict_reason: null,
        verdict_context: null,
        is_projected_plan: false,
      })
      .select("id,date,logged_time,meal_name,calories,protein_g")
      .single();

    if (error) throw new Error(error.message);

    // Awaited, not fire-and-forget: this route has no request lifetime to
    // outlive, and a caller logging from a keypress should get back a day
    // that is already consistent.
    try {
      // Imported lazily: the verdict module pulls in the Anthropic SDK, which
      // has no business loading on a request that only writes a row.
      const { upsertDayFoodVerdict } = await import("@/lib/cal/dayVerdict");
      await upsertDayFoodVerdict(supabase, userId, date);
    } catch (verdictError) {
      console.info("[cal/quick-log] verdict refresh skipped", {
        date,
        error: message(verdictError),
      });
    }

    return NextResponse.json({
      ok: true,
      logged: data,
      saved_food: { id: chosen.id, name: chosen.name },
      servings,
    });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 });
  }
}

export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;

function methodNotAllowed() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}

async function listSavedFoods(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<SavedFoodRow[]> {
  const { data, error } = await supabase
    .from("saved_foods")
    .select(SAVED_FOOD_COLUMNS)
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Unable to read saved foods: ${error.message}`);
  return (data ?? []) as SavedFoodRow[];
}

type Match =
  | { kind: "one"; food: SavedFoodRow }
  | { kind: "ambiguous"; candidates: SavedFoodRow[] }
  | { kind: "none" };

/**
 * Resolve a saved food from free text. Exact id wins, then exact name, then a
 * single substring hit. Anything vaguer is reported back rather than guessed —
 * logging the wrong meal silently is worse than not logging it.
 */
export function matchSavedFood(foods: SavedFoodRow[], query: string): Match {
  const q = query.trim().toLowerCase();
  if (!q) return { kind: "none" };

  const byId = foods.find((f) => f.id.toLowerCase() === q);
  if (byId) return { kind: "one", food: byId };

  const exact = foods.filter((f) => f.name.trim().toLowerCase() === q);
  if (exact.length === 1) return { kind: "one", food: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };

  const partial = foods.filter((f) => f.name.toLowerCase().includes(q));
  if (partial.length === 1) return { kind: "one", food: partial[0] };
  if (partial.length > 1) return { kind: "ambiguous", candidates: partial };

  return { kind: "none" };
}

export function parseServings(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 1;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function currentLocalHm(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Quick-log failed.";
}

function authorizeLedgerRequest(
  request: Request,
): { ok: true } | { ok: false; response: NextResponse<{ error: string }> } {
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
  const configured = process.env[LEDGER_USER_ID_ENV];
  if (configured) return configured;

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
  return data.id;
}
