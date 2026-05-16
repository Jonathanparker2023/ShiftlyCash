import "server-only";

const FOUNDATION_LEDGER_DB = "95845470-73b6-4b8f-b13e-0106ca7d5737";
const NUTRITION_LEDGER_DB = "807eb9f8-ae1a-4a53-9357-8a250c75dc48";
const BASE_URL = "https://shiftlycash.vercel.app";
const NOTION_VERSION = "2022-06-28";

type JsonRecord = Record<string, unknown>;
type NotionProperties = Record<string, JsonRecord>;
type SyncResult =
  | { action: "created" | "updated"; ok: boolean; pageId: string; status?: number }
  | { skipped: true; reason: string }
  | { error: string; status?: number; details?: unknown };

export async function runNotionSync() {
  const notionKey = process.env.NOTION_API_KEY;
  const ledgerToken = process.env.SHIFTLYCASH_LEDGER_TOKEN;

  if (!notionKey || !ledgerToken) {
    throw new Error("NOTION_API_KEY or SHIFTLYCASH_LEDGER_TOKEN not configured");
  }

  const [ledgerSnapshot, nutritionSnapshot] = await Promise.all([
    fetchSnapshot(`${BASE_URL}/api/export/ledger-fields`, ledgerToken),
    fetchSnapshot(`${BASE_URL}/api/export/nutrition-fields`, ledgerToken),
  ]);

  const results = {
    foundation: await syncFoundationLedger(notionKey, ledgerSnapshot),
    nutrition: await syncNutritionLedger(notionKey, nutritionSnapshot),
  };

  return { ok: true, results, ranAt: new Date().toISOString() };
}

async function syncFoundationLedger(
  notionKey: string,
  snapshot: unknown,
): Promise<SyncResult> {
  const weekStart =
    readString(snapshot, "cashflow", "week_start") ??
    readString(snapshot, "cashflow", "this_week", "start_date") ??
    readString(snapshot, "week_of");

  if (!weekStart) {
    return { skipped: true, reason: "No week start in ledger snapshot" };
  }

  const planRule =
    readNumber(snapshot, "plan_metrics", "plan_rule_per_week") ??
    readNumber(snapshot, "cashflow", "target_weekly_deployable") ??
    readNumber(snapshot, "projection", "wpc");
  const actualCashflow =
    readNumber(snapshot, "cashflow", "actual_deployable_this_week") ??
    readNumber(snapshot, "cashflow", "this_week", "cashflow_dollars");
  const variance =
    actualCashflow !== null && planRule !== null
      ? roundCurrency(actualCashflow - planRule)
      : null;
  const debtFreeDate = readString(
    snapshot,
    "plan_metrics",
    "debt_free_date_iso",
  );

  const autoFillProps = cleanProperties({
    Week: titleProperty(`Week of ${weekStart}`),
    "Week start": dateProperty(weekStart),
    "Plan rule ($/wk)": numberProperty(planRule),
    "Actual cashflow ($)": numberProperty(actualCashflow),
    "Variance ($)": numberProperty(variance),
    Status:
      variance === null
        ? undefined
        : selectProperty(getStatusForVariance(variance)),
    "Active debt ($)": numberProperty(
      readNumber(snapshot, "debt_totals", "total_active_debt") ??
        readNumber(snapshot, "debt_totals", "total_active_dollars"),
    ),
    "Projected debt-free date": dateProperty(debtFreeDate),
  });

  return upsertWeekRow(
    notionKey,
    FOUNDATION_LEDGER_DB,
    weekStart,
    autoFillProps,
  );
}

function getStatusForVariance(variance: number): "OK" | "FLAG" | "EXCEPTION" {
  if (variance >= 0) return "OK";
  if (variance >= -100) return "FLAG";
  return "EXCEPTION";
}

async function syncNutritionLedger(
  notionKey: string,
  snapshot: unknown,
): Promise<SyncResult> {
  const weekStart = readString(snapshot, "current_week", "start");

  if (!weekStart) {
    return { skipped: true, reason: "No week start in nutrition snapshot" };
  }

  const days = readArray(snapshot, "current_week", "days");
  const weights = days
    .map((day) => readNumber(day, "weight_lbs"))
    .filter((weight): weight is number => weight !== null);
  const weightStart = weights[0] ?? null;
  const weightEnd = weights.at(-1) ?? null;
  const weightDelta =
    weightStart !== null && weightEnd !== null
      ? roundWeight(weightEnd - weightStart)
      : null;
  const targetTdee = readNumber(snapshot, "targets", "tdee_cal");
  const targetProtein = readNumber(snapshot, "targets", "protein_g");
  const targetFiber = readNumber(snapshot, "targets", "fiber_g");
  const avgCal = readNumber(snapshot, "current_week", "avg_daily_logged", "cal");
  const avgProtein = readNumber(
    snapshot,
    "current_week",
    "avg_daily_logged",
    "protein_g",
  );
  const avgFiber = readNumber(
    snapshot,
    "current_week",
    "avg_daily_logged",
    "fiber_g",
  );
  const avgCalVsTdee =
    targetTdee !== null && avgCal !== null ? roundInteger(avgCal - targetTdee) : null;
  const proteinHitPct =
    targetProtein !== null && targetProtein > 0 && avgProtein !== null
      ? roundPercent(avgProtein / targetProtein)
      : null;
  const fiberHitPct =
    targetFiber !== null && targetFiber > 0 && avgFiber !== null
      ? roundPercent(avgFiber / targetFiber)
      : null;

  const autoFillProps = cleanProperties({
    Week: titleProperty(`Week of ${weekStart}`),
    "Week start": dateProperty(weekStart),
    "Avg cal vs TDEE": numberProperty(avgCalVsTdee),
    "Avg protein hit %": numberProperty(proteinHitPct),
    "Avg fiber hit %": numberProperty(fiberHitPct),
    "Weight start (lbs)": numberProperty(weightStart),
    "Weight end (lbs)": numberProperty(weightEnd),
    "Weight delta (lbs)": numberProperty(weightDelta),
  });

  return upsertWeekRow(
    notionKey,
    NUTRITION_LEDGER_DB,
    weekStart,
    autoFillProps,
  );
}

async function upsertWeekRow(
  notionKey: string,
  databaseId: string,
  weekStart: string,
  autoFillProps: NotionProperties,
): Promise<SyncResult> {
  const queryRes = await notionRequest(notionKey, `/databases/${databaseId}/query`, {
    filter: {
      property: "Week start",
      date: { equals: weekStart },
    },
    page_size: 1,
  });

  if (!queryRes.ok) {
    return {
      error: "Notion query failed",
      status: queryRes.status,
      details: queryRes.body,
    };
  }

  const results = readArray(queryRes.body, "results");
  const existing = firstRecord(results);

  if (existing) {
    const pageId = readString(existing, "id");

    if (!pageId) {
      return { error: "Notion query returned a page without an id" };
    }

    const updateRes = await notionRequest(notionKey, `/pages/${pageId}`, {
      properties: autoFillProps,
    }, "PATCH");

    return {
      action: "updated",
      pageId,
      ok: updateRes.ok && readString(updateRes.body, "object") === "page",
      status: updateRes.status,
    };
  }

  const createRes = await notionRequest(notionKey, "/pages", {
    parent: { database_id: databaseId },
    properties: autoFillProps,
  });
  const pageId = readString(createRes.body, "id");

  if (!createRes.ok || !pageId) {
    return {
      error: "Notion create failed",
      status: createRes.status,
      details: createRes.body,
    };
  }

  return {
    action: "created",
    pageId,
    ok: true,
    status: createRes.status,
  };
}

async function fetchSnapshot(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `Export fetch failed for ${url}: ${response.status} ${JSON.stringify(body)}`,
    );
  }

  return body;
}

async function notionRequest(
  notionKey: string,
  path: string,
  body: unknown,
  method = "POST",
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => null);

  return { ok: response.ok, status: response.status, body: responseBody };
}

function titleProperty(content: string): JsonRecord {
  return { title: [{ text: { content } }] };
}

function dateProperty(start: string | null): JsonRecord {
  return { date: start ? { start } : null };
}

function numberProperty(value: number | null): JsonRecord {
  return { number: value };
}

function selectProperty(name: string): JsonRecord {
  return { select: { name } };
}

function cleanProperties(
  properties: Record<string, JsonRecord | undefined>,
): NotionProperties {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  ) as NotionProperties;
}

function readString(value: unknown, ...path: string[]): string | null {
  const found = readPath(value, path);
  return typeof found === "string" && found.trim() ? found : null;
}

function readNumber(value: unknown, ...path: string[]): number | null {
  const found = readPath(value, path);

  if (typeof found === "number") {
    return Number.isFinite(found) ? found : null;
  }
  if (typeof found === "string") {
    const parsed = Number(found);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readArray(value: unknown, ...path: string[]): unknown[] {
  const found = readPath(value, path);
  return Array.isArray(found) ? found : [];
}

function readPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[key];
  }, value);
}

function firstRecord(values: unknown[]): JsonRecord | null {
  const first = values[0];
  return isRecord(first) ? first : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundWeight(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundInteger(value: number): number {
  return Math.round(value);
}
