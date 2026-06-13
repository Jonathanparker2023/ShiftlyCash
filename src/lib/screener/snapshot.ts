import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

export type ScreenerPosition = {
  ticker: string;
  entry: number | null;
  current: number | null;
  pnlPct: number | null;
};

export type ScreenerQueueItem = {
  ticker: string;
  score: number | null;
  band: string | null;
  queueRank: number | null;
  shadowFlagged: boolean;
};

export type ScreenerFearItem = {
  ticker: string;
  variant: string | null;
  kind: string | null;
  drawdownPct: number | null;
};

export type ScreenerSnapshotPayload = {
  snapshotId: string;
  asOf: string | null;
  generatedAt: string;
  clock: {
    started: string | null;
    day: number | null;
    of: number | null;
  };
  hero: {
    portfolioValue: number | null;
    costBasis: number | null;
    pnlPct: number | null;
    unvalidated: boolean;
  };
  positions: ScreenerPosition[];
  queue: ScreenerQueueItem[];
  fear: ScreenerFearItem[];
};

export type ScreenerSnapshotState =
  | { status: "empty" }
  | {
      status: "ready";
      payload: ScreenerSnapshotPayload;
      receivedAt: string | null;
      stale: boolean;
    };

export type SnapshotValidationResult =
  | { ok: true; payload: JsonRecord; generatedAt: string; asOf: string | null; snapshotId: string }
  | { ok: false; error: string };

type SnapshotRow = {
  snapshot_id: string;
  as_of: string | null;
  generated_at: string;
  payload: unknown;
  received_at: string | null;
};

export async function getLatestScreenerSnapshot(): Promise<ScreenerSnapshotState> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("screener_snapshots")
    .select("snapshot_id,as_of,generated_at,payload,received_at")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Screener snapshot lookup failed: ${error.message}`);
  }

  if (!data) {
    return { status: "empty" };
  }

  const row = data as SnapshotRow;
  const payload = normalizePayload(row.payload, row);
  const generatedTime = Date.parse(payload.generatedAt);

  return {
    status: "ready",
    payload,
    receivedAt: row.received_at ?? null,
    stale: Number.isFinite(generatedTime) ? Date.now() - generatedTime > STALE_AFTER_MS : true,
  };
}

export function validateSnapshotPayload(body: unknown): SnapshotValidationResult {
  if (!isRecord(body)) {
    return { ok: false, error: "Body must be a snapshot object." };
  }

  const generatedAt = requiredIsoString(body.generated_at);
  if (!generatedAt) {
    return { ok: false, error: "generated_at must be a valid ISO timestamp." };
  }

  const snapshotId = nonEmptyString(body.snapshot_id);
  if (!snapshotId) {
    return { ok: false, error: "snapshot_id is required." };
  }

  const asOf = optionalIsoString(body.as_of);
  if (body.as_of !== undefined && !asOf) {
    return { ok: false, error: "as_of must be a valid ISO timestamp when provided." };
  }

  if (!isRecord(body.clock)) {
    return { ok: false, error: "clock is required." };
  }

  if (!isRecord(body.hero)) {
    return { ok: false, error: "hero is required." };
  }

  for (const key of ["positions", "queue", "fear"] as const) {
    if (!Array.isArray(body[key])) {
      return { ok: false, error: `${key} must be an array.` };
    }
  }

  return { ok: true, payload: body, generatedAt, asOf, snapshotId };
}

export function isNewerGeneratedAt(incoming: string, latest: string | null | undefined): boolean {
  if (!latest) {
    return true;
  }

  const incomingTime = Date.parse(incoming);
  const latestTime = Date.parse(latest);

  return Number.isFinite(incomingTime) && Number.isFinite(latestTime)
    ? incomingTime > latestTime
    : incoming > latest;
}

function normalizePayload(payload: unknown, row: SnapshotRow): ScreenerSnapshotPayload {
  const source = isRecord(payload) ? payload : {};
  const clock = isRecord(source.clock) ? source.clock : {};
  const hero = isRecord(source.hero) ? source.hero : {};

  return {
    snapshotId: nonEmptyString(source.snapshot_id) ?? row.snapshot_id,
    asOf: optionalString(source.as_of) ?? row.as_of,
    generatedAt: optionalString(source.generated_at) ?? row.generated_at,
    clock: {
      started: optionalString(clock.started),
      day: optionalNumber(clock.day),
      of: optionalNumber(clock.of),
    },
    hero: {
      portfolioValue: optionalNumber(hero.portfolio_value),
      costBasis: optionalNumber(hero.cost_basis),
      pnlPct: optionalNumber(hero.pnl_pct),
      unvalidated: hero.unvalidated !== false,
    },
    positions: normalizePositions(source.positions),
    queue: normalizeQueue(source.queue),
    fear: normalizeFear(source.fear),
  };
}

function normalizePositions(value: unknown): ScreenerPosition[] {
  return asRecords(value).map((item) => ({
    ticker: nonEmptyString(item.ticker) ?? "",
    entry: optionalNumber(item.entry),
    current: optionalNumber(item.current),
    pnlPct: optionalNumber(item.pnl_pct),
  })).filter((item) => item.ticker);
}

function normalizeQueue(value: unknown): ScreenerQueueItem[] {
  return asRecords(value).map((item) => ({
    ticker: nonEmptyString(item.ticker) ?? "",
    score: optionalNumber(item.score),
    band: optionalString(item.band),
    queueRank: optionalNumber(item.queue_rank),
    shadowFlagged: item.shadow_flagged === true,
  })).filter((item) => item.ticker);
}

function normalizeFear(value: unknown): ScreenerFearItem[] {
  return asRecords(value).map((item) => ({
    ticker: nonEmptyString(item.ticker) ?? "",
    variant: optionalString(item.variant),
    kind: optionalString(item.kind),
    drawdownPct: optionalNumber(item.drawdown_pct),
  })).filter((item) => item.ticker);
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredIsoString(value: unknown): string | null {
  const text = nonEmptyString(value);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function optionalIsoString(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return requiredIsoString(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
