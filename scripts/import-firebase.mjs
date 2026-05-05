#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAY_SETTINGS = {
  abilityRegularNetRate: 15.63,
  abilityOvertimeNetRate: 21.73,
  prestigeRegularNetRate: 14.28,
  prestigeOvertimeNetRate: 21.42,
  incentiveNetMultiplier: 0.7348,
};

main().catch((error) => {
  console.error(`\nImport failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  loadEnvFile(".env.local");
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const mode = args.apply ? "apply" : "dry-run";

  if (args.apply && args.dryRun) {
    throw new Error("Use either --dry-run or --apply, not both.");
  }

  if (!args.file && !args.firebaseUrl) {
    throw new Error("Provide --file path/to/firebase-export.json or --firebase-url.");
  }

  if (args.apply && !args.userEmail && !args.userId) {
    throw new Error("--apply requires --user-email or --user-id so rows attach to the right user.");
  }

  const source = await loadSource(args);
  const backupPath = await backupSource(source.raw, args.backupDir ?? "backups");
  const root = JSON.parse(stripJsonBom(source.raw));
  const extracted = extractShiftlyRoot(root, args.firebaseUid);
  const normalized = normalizeShiftlyData(extracted.shiftly, root);
  const report = buildReport(normalized, {
    sourcePath: source.label,
    firebaseUid: extracted.firebaseUid,
    backupPath,
    mode,
  });

  if (mode === "dry-run") {
    printReport(report);
    await writeReport(report, args.reportPath);
    return;
  }

  const supabase = createServiceClient();
  const userId = await resolveUserId(supabase, args);
  const appliedReport = await applyImport(supabase, userId, normalized, report, source.label);

  printReport(appliedReport);
  await writeReport(appliedReport, args.reportPath);
}

function printHelp() {
  console.log(`
Usage:
  node scripts/import-firebase.mjs --file C:\\path\\firebase-export.json --dry-run
  node scripts/import-firebase.mjs --file C:\\path\\firebase-export.json --apply --user-email you@example.com

Required for --apply:
  SUPABASE_SERVICE_ROLE_KEY in .env.local or shell env
  NEXT_PUBLIC_SUPABASE_URL in .env.local or shell env
  --user-email or --user-id

Options:
  --file <path>             Firebase Console Realtime DB JSON export
  --firebase-url <url>      Live Realtime DB URL; appends .json if needed
  --firebase-token <token>  Optional Firebase auth token for live fetch
  --firebase-uid <uid>      Select users/{uid}/shiftly when multiple users exist
  --dry-run                 Default; no Supabase writes
  --apply                   Write to Supabase
  --user-email <email>      Supabase auth user email for imported rows
  --user-id <uuid>          Supabase auth user id for imported rows
  --backup-dir <path>       Default: backups
  --report <path>           Write JSON report to this path
`);
}

function parseArgs(argv) {
  const args = { dryRun: true };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--apply") {
      args.apply = true;
      args.dryRun = false;
    } else if (arg === "--file") {
      args.file = requireValue(arg, next);
      index += 1;
    } else if (arg === "--firebase-url") {
      args.firebaseUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--firebase-token") {
      args.firebaseToken = requireValue(arg, next);
      index += 1;
    } else if (arg === "--firebase-uid") {
      args.firebaseUid = requireValue(arg, next);
      index += 1;
    } else if (arg === "--user-email") {
      args.userEmail = requireValue(arg, next).trim().toLowerCase();
      index += 1;
    } else if (arg === "--user-id") {
      args.userId = requireValue(arg, next);
      index += 1;
    } else if (arg === "--backup-dir") {
      args.backupDir = requireValue(arg, next);
      index += 1;
    } else if (arg === "--report") {
      args.reportPath = requireValue(arg, next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireValue(flag, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

async function loadSource(args) {
  if (args.file) {
    return {
      raw: await readFile(args.file, "utf8"),
      label: path.resolve(args.file),
    };
  }

  const url = buildFirebaseUrl(args.firebaseUrl, args.firebaseToken);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Firebase fetch failed: ${response.status} ${response.statusText}`);
  }

  return {
    raw: await response.text(),
    label: args.firebaseUrl,
  };
}

function buildFirebaseUrl(input, token) {
  const url = new URL(input.endsWith(".json") ? input : `${input.replace(/\/$/, "")}.json`);

  if (token) {
    url.searchParams.set("auth", token);
  }

  return url.toString();
}

async function backupSource(raw, backupDir) {
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `migration-source-${stamp}.json`);
  await writeFile(backupPath, raw, "utf8");
  return path.resolve(backupPath);
}

function extractShiftlyRoot(root, requestedUid) {
  if (root?.users && typeof root.users === "object") {
    const uid = requestedUid ?? Object.keys(root.users)[0];
    const shiftly = root.users?.[uid]?.shiftly;

    if (!shiftly) {
      throw new Error(`Could not find users/${uid}/shiftly in Firebase export.`);
    }

    return { shiftly, firebaseUid: uid };
  }

  if (root?.shiftly) {
    return { shiftly: root.shiftly, firebaseUid: requestedUid ?? null };
  }

  return { shiftly: root, firebaseUid: requestedUid ?? null };
}

function normalizeShiftlyData(shiftly, root) {
  const reviewItems = [];
  const weeksByKey = new Map();

  for (const candidate of collectWeekCandidates(shiftly)) {
    const week = normalizeWeekCandidate(candidate, reviewItems);

    if (!week) {
      continue;
    }

    const existing = weeksByKey.get(week.startDate);

    if (existing) {
      reviewItems.push({
        severity: "warning",
        category: "duplicate_week",
        sourcePath: week.sourcePath,
        message: `Duplicate source week for ${week.startDate}; merged rows into the same ISO week.`,
        sourcePayload: summarizePayload(candidate.value),
      });
      existing.days = mergeDays(existing.days, week.days, reviewItems);
      existing.sourcePaths.push(week.sourcePath);
    } else {
      weeksByKey.set(week.startDate, week);
    }
  }

  const transactions = normalizeCachedTransactions(root, reviewItems);
  addVerificationReviewItems(weeksByKey.values(), reviewItems);

  return {
    weeks: Array.from(weeksByKey.values()).sort((left, right) =>
      left.startDate.localeCompare(right.startDate),
    ),
    cachedTransactions: transactions,
    reviewItems,
  };
}

function collectWeekCandidates(shiftly) {
  const candidates = [];
  const directKeys = [
    "activeWeek",
    "currentWeek",
    "current",
    "week",
  ];
  const collectionKeys = [
    "history",
    "historyData",
    "weeks",
    "closedWeeks",
    "weekHistory",
  ];

  for (const key of directKeys) {
    if (shiftly?.[key]) {
      candidates.push({ value: shiftly[key], sourcePath: `shiftly/${key}`, current: true });
    }
  }

  for (const key of collectionKeys) {
    addCollectionCandidates(candidates, shiftly?.[key], `shiftly/${key}`);
  }

  addYearHistoryCandidates(candidates, shiftly?.yearHistory, "shiftly/yearHistory");

  return candidates;
}

function addCollectionCandidates(candidates, collection, sourcePath) {
  if (!collection) return;

  if (Array.isArray(collection)) {
    collection.forEach((value, index) => {
      candidates.push({ value, sourcePath: `${sourcePath}/${index}` });
    });
    return;
  }

  if (typeof collection === "object") {
    Object.entries(collection).forEach(([key, value]) => {
      candidates.push({
        value:
          value && typeof value === "object" && !Array.isArray(value)
            ? { ...value, legacyKey: key }
            : value,
        sourcePath: `${sourcePath}/${key}`,
      });
    });
  }
}

function addYearHistoryCandidates(candidates, yearHistory, sourcePath) {
  if (!yearHistory) return;
  const entries = Array.isArray(yearHistory)
    ? yearHistory.map((value, index) => [String(index), value])
    : Object.entries(yearHistory);

  for (const [key, value] of entries) {
    addCollectionCandidates(
      candidates,
      value?.historyData ?? value?.history ?? value?.weeks,
      `${sourcePath}/${key}/historyData`,
    );
  }
}

function normalizeWeekCandidate(candidate, reviewItems) {
  if (!candidate.value || typeof candidate.value !== "object") {
    reviewItems.push({
      severity: "warning",
      category: "malformed_week",
      sourcePath: candidate.sourcePath,
      message: "Week candidate is not an object.",
      sourcePayload: summarizePayload(candidate.value),
    });
    return null;
  }

  const startDate = normalizeDate(
    firstDefined(
      candidate.value.start_date,
      candidate.value.startDate,
      candidate.value.weekStart,
      candidate.value.start,
      candidate.value.rangeStart,
    ),
  ) ?? parseRangeStart(candidate.value.dateRange ?? candidate.value.range ?? candidate.value.label);
  const endDate = normalizeDate(
    firstDefined(
      candidate.value.end_date,
      candidate.value.endDate,
      candidate.value.weekEnd,
      candidate.value.end,
      candidate.value.rangeEnd,
    ),
  ) ?? (startDate ? addDays(startDate, 6) : null);

  if (!startDate || !isSunday(startDate)) {
    reviewItems.push({
      severity: "error",
      category: "missing_week_date",
      sourcePath: candidate.sourcePath,
      message: "Week could not be mapped because it has no Sunday start_date.",
      sourcePayload: summarizePayload(candidate.value),
    });
    return null;
  }

  const days = normalizeDays(candidate.value, startDate, candidate.sourcePath, reviewItems);

  return {
    legacyId: String(firstDefined(candidate.value.id, candidate.value.legacyKey, startDate)),
    sourcePath: candidate.sourcePath,
    sourcePaths: [candidate.sourcePath],
    startDate,
    endDate: endDate ?? addDays(startDate, 6),
    status: candidate.current ? "active" : "closed",
    archivedAt: candidate.sourcePath.includes("yearHistory")
      ? new Date(`${endDate ?? addDays(startDate, 6)}T23:59:59.000Z`).toISOString()
      : null,
    days,
    expected: {
      earnings: toNumber(firstDefined(candidate.value.earn, candidate.value.earnings, candidate.value.earnings_total)),
      spend: toNumber(firstDefined(candidate.value.spend, candidate.value.spend_total)),
      cashflow: toNumber(firstDefined(candidate.value.cf, candidate.value.cashflow, candidate.value.cashflow_total)),
    },
  };
}

function normalizeDays(weekValue, startDate, sourcePath, reviewItems) {
  const sourceDays = firstDefined(
    weekValue.days,
    weekValue.daysMeta,
    weekValue.dailyData,
    weekValue.dayData,
    weekValue.entries,
  );
  const dayList = Array.from({ length: 7 }, (_, dayIndex) => ({
    legacyId: `${startDate}:${dayIndex}`,
    sourcePath: `${sourcePath}/days/${dayIndex}`,
    date: addDays(startDate, dayIndex),
    dayIndex,
    baseAmount: dayIndex === 6 ? 57 : 52,
    manualSpendAdjustment: 0,
    spendLocked: false,
    slots: [],
    transactions: [],
    expected: {},
  }));

  if (!sourceDays) {
    reviewItems.push({
      severity: "warning",
      category: "missing_days",
      sourcePath,
      message: "Week has no recognizable day array/object; created empty day shells.",
      sourcePayload: summarizePayload(weekValue),
    });
    return dayList;
  }

  const entries = Array.isArray(sourceDays)
    ? sourceDays.map((value, index) => [String(index), value])
    : Object.entries(sourceDays);

  entries.forEach(([key, value], fallbackIndex) => {
    if (!value || typeof value !== "object") {
      reviewItems.push({
        severity: "warning",
        category: "malformed_day",
        sourcePath: `${sourcePath}/days/${key}`,
        message: "Day entry is not an object.",
        sourcePayload: summarizePayload(value),
      });
      return;
    }

    const date = normalizeDate(value.date ?? value.dayDate) ?? addDays(startDate, fallbackIndex);
    const dayIndex = dateDiff(startDate, date);

    if (dayIndex < 0 || dayIndex > 6) {
      reviewItems.push({
        severity: "warning",
        category: "day_outside_week",
        sourcePath: `${sourcePath}/days/${key}`,
        message: `Day ${date} is outside week ${startDate}; skipped.`,
        sourcePayload: summarizePayload(value),
      });
      return;
    }

    const transactions = normalizeDayTransactions(value, date, `${sourcePath}/days/${key}`, reviewItems);
    const transactionSum = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
    const sourceSpend = toNumber(firstDefined(value.spend, value.manualSpend, value.manual_spend_adjustment));
    const manualSpendAdjustment =
      transactions.length > 0 && sourceSpend !== null
        ? Math.max(0, roundMoney(sourceSpend - transactionSum))
        : sourceSpend ?? 0;

    dayList[dayIndex] = {
      legacyId: String(firstDefined(value.id, value.legacyKey, key, `${startDate}:${dayIndex}`)),
      sourcePath: `${sourcePath}/days/${key}`,
      date,
      dayIndex,
      baseAmount: toNumber(firstDefined(value.base, value.baseAmount, value.base_amount)) ?? (dayIndex === 6 ? 57 : 52),
      manualSpendAdjustment,
      spendLocked: Boolean(firstDefined(value.locked, value.spendLocked, value.spend_locked, false)),
      slots: normalizeSlots(value, `${sourcePath}/days/${key}`, reviewItems),
      transactions,
      expected: {
        earnings: toNumber(firstDefined(value.earn, value.earnings, value.earnings_total)),
        spend: sourceSpend,
        cashflow: toNumber(firstDefined(value.cf, value.cashflow, value.cashflow_total)),
      },
    };
  });

  return dayList;
}

function normalizeSlots(dayValue, sourcePath, reviewItems) {
  const slotSource = firstDefined(
    dayValue.earns,
    dayValue.earnSlots,
    dayValue.shifts,
    dayValue.slots,
  );

  if (!slotSource) return [];

  const entries = Array.isArray(slotSource)
    ? slotSource.map((value, index) => [String(index), value])
    : Object.entries(slotSource);

  const slots = [];

  entries.forEach(([key, raw], fallbackIndex) => {
    const parsed = parseSlot(raw);

    if (!parsed) {
      reviewItems.push({
        severity: "warning",
        category: "malformed_slot",
        sourcePath: `${sourcePath}/earns/${key}`,
        message: "Could not parse earn slot.",
        sourcePayload: summarizePayload(raw),
      });
      return;
    }

    const slotIndex = Number(firstDefined(raw?.slot_index, raw?.slotIndex, fallbackIndex));

    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 3) {
      reviewItems.push({
        severity: "warning",
        category: "extra_slot",
        sourcePath: `${sourcePath}/earns/${key}`,
        message: `Slot index ${slotIndex} is outside 0..3; skipped.`,
        sourcePayload: summarizePayload(raw),
      });
      return;
    }

    slots.push({
      legacyId: String(firstDefined(raw?.id, key, slotIndex)),
      slotIndex,
      jobType: parsed.jobType,
      payType: parsed.payType,
      hoursOrUnits: parsed.hoursOrUnits,
      label: parsed.label,
    });
  });

  return slots;
}

function parseSlot(raw) {
  if (!raw) return null;

  if (typeof raw === "string") {
    return parseSlotText(raw);
  }

  const jobType = normalizeJobType(firstDefined(raw.job_type, raw.jobType, raw.job, raw.type));
  const payType = normalizePayType(firstDefined(raw.pay_type, raw.payType, raw.pay, raw.kind));
  const hoursOrUnits = toNumber(firstDefined(raw.hours_or_units, raw.hoursOrUnits, raw.hours, raw.h, raw.amount, raw.value));

  if (!jobType || hoursOrUnits === null) {
    return null;
  }

  return {
    jobType,
    payType: normalizePayTypeForJob(jobType, payType),
    hoursOrUnits,
    label: cleanString(firstDefined(raw.label, raw.name, raw.client, raw.note)) ?? null,
  };
}

function parseSlotText(value) {
  const normalized = value.trim();
  const hoursMatch = normalized.match(/(\$?\d+(?:\.\d+)?)/);
  const hoursOrUnits = hoursMatch ? Number(hoursMatch[1].replace("$", "")) : null;
  const lower = normalized.toLowerCase();
  const jobType = normalizeJobType(lower);
  const payType = normalizePayType(lower);
  const labelMatch = normalized.match(/\(([^)]+)\)/);

  if (!jobType || hoursOrUnits === null || !Number.isFinite(hoursOrUnits)) {
    return null;
  }

  return {
    jobType,
    payType: normalizePayTypeForJob(jobType, payType),
    hoursOrUnits,
    label: labelMatch?.[1]?.trim() ?? null,
  };
}

function normalizeDayTransactions(dayValue, date, sourcePath, reviewItems) {
  const transactionSource = firstDefined(dayValue.txLog, dayValue.transactions, dayValue.transactionLog);
  if (!transactionSource) return [];

  const entries = Array.isArray(transactionSource)
    ? transactionSource.map((value, index) => [String(index), value])
    : Object.entries(transactionSource);

  return entries.flatMap(([key, raw]) => {
    const parsed = normalizeTransaction(raw, date, `${sourcePath}/txLog/${key}`, reviewItems);
    return parsed ? [parsed] : [];
  });
}

function normalizeCachedTransactions(root, reviewItems) {
  const source = root?.shiftboard?.cached_transactions ?? root?.cached_transactions;
  if (!source) return [];
  const entries = Array.isArray(source)
    ? source.map((value, index) => [String(index), value])
    : Object.entries(source);

  return entries.flatMap(([key, raw]) => {
    const parsed = normalizeTransaction(raw, normalizeDate(raw?.date), `shiftboard/cached_transactions/${key}`, reviewItems);
    return parsed ? [parsed] : [];
  });
}

function normalizeTransaction(raw, fallbackDate, sourcePath, reviewItems) {
  if (!raw || typeof raw !== "object") {
    reviewItems.push({
      severity: "warning",
      category: "malformed_transaction",
      sourcePath,
      message: "Transaction is not an object.",
      sourcePayload: summarizePayload(raw),
    });
    return null;
  }

  const date = normalizeDate(firstDefined(raw.date, raw.authorized_date, raw.authorizedDate, fallbackDate));
  const amount = toNumber(firstDefined(raw.amount, raw.value, raw.spend));
  const merchantName = cleanString(firstDefined(raw.merchant_name, raw.merchantName, raw.name, raw.rawName, raw.description));

  if (!date || amount === null || !merchantName) {
    reviewItems.push({
      severity: "warning",
      category: "malformed_transaction",
      sourcePath,
      message: "Transaction is missing date, amount, or merchant name.",
      sourcePayload: summarizePayload(raw),
    });
    return null;
  }

  return {
    legacyId: String(firstDefined(raw.id, raw.transaction_id, raw.transactionId, raw.plaid_transaction_id, sourcePath)),
    sourcePath,
    date,
    amount,
    merchantName,
    rawName: cleanString(firstDefined(raw.raw_name, raw.rawName, raw.original_description, raw.description)) ?? merchantName,
    category: cleanString(Array.isArray(raw.category) ? raw.category.join(" / ") : raw.category),
    pending: Boolean(raw.pending),
  };
}

function buildReport(normalized, meta) {
  const weekCount = normalized.weeks.length;
  const dayCount = normalized.weeks.reduce((sum, week) => sum + week.days.length, 0);
  const slotCount = normalized.weeks.reduce(
    (sum, week) => sum + week.days.reduce((daySum, day) => daySum + day.slots.length, 0),
    0,
  );
  const dayTransactionCount = normalized.weeks.reduce(
    (sum, week) => sum + week.days.reduce((daySum, day) => daySum + day.transactions.length, 0),
    0,
  );

  return {
    ...meta,
    generatedAt: new Date().toISOString(),
    summary: {
      weeks: weekCount,
      days: dayCount,
      earnSlots: slotCount,
      dayTransactions: dayTransactionCount,
      cachedTransactions: normalized.cachedTransactions.length,
      reviewItems: normalized.reviewItems.length,
    },
    weeks: normalized.weeks.map((week) => ({
      startDate: week.startDate,
      endDate: week.endDate,
      status: week.status,
      archivedAt: week.archivedAt,
      dayCount: week.days.length,
      earnSlots: week.days.reduce((sum, day) => sum + day.slots.length, 0),
      transactions: week.days.reduce((sum, day) => sum + day.transactions.length, 0),
      sourcePaths: week.sourcePaths,
    })),
    reviewItems: normalized.reviewItems,
    verification: buildVerificationReport(normalized.weeks),
    apply: {
      wroteToSupabase: false,
      migrationRunId: null,
      insertedOrUpdated: {},
    },
  };
}

async function applyImport(supabase, userId, normalized, report, sourcePath) {
  const run = await insertRow(supabase, "migration_runs", {
    user_id: userId,
    source: "firebase",
    source_path: sourcePath,
    mode: "apply",
    status: "running",
    summary: report.summary,
  });

  const counts = {
    weeks: 0,
    days: 0,
    earnSlots: 0,
    transactions: 0,
    reviewItems: 0,
    identityMap: 0,
  };

  try {
    await insertRow(supabase, "state_snapshots", {
      user_id: userId,
      snapshot_type: "pre_migration",
      payload: {
        sourcePath,
        reportSummary: report.summary,
        note: "Snapshot marker before Firebase import. Raw source is backed up on disk.",
      },
    });

    const daysByDate = new Map();

    for (const week of normalized.weeks) {
      const weekRow = await upsertWeek(supabase, userId, week);
      counts.weeks += 1;
      await upsertIdentityMap(supabase, userId, run.id, "firebase", week.sourcePath, week.legacyId, "weeks", weekRow.id);
      counts.identityMap += 1;

      for (const day of week.days) {
        const dayRow = await upsertDay(supabase, userId, weekRow.id, day);
        counts.days += 1;
        daysByDate.set(day.date, dayRow.id);
        await upsertIdentityMap(supabase, userId, run.id, "firebase", day.sourcePath, day.legacyId, "days", dayRow.id);
        counts.identityMap += 1;

        for (const slot of day.slots) {
          const slotRow = await upsertEarnSlot(supabase, userId, dayRow.id, slot);
          counts.earnSlots += 1;
          await upsertIdentityMap(
            supabase,
            userId,
            run.id,
            "firebase",
            `${day.sourcePath}/earns/${slot.legacyId}`,
            `${day.legacyId}:${slot.slotIndex}`,
            "earn_slots",
            slotRow.id,
          );
          counts.identityMap += 1;
        }

        for (const transaction of day.transactions) {
          await upsertTransaction(supabase, userId, transaction, dayRow.id, "migration");
          counts.transactions += 1;
        }
      }
    }

    for (const transaction of normalized.cachedTransactions) {
      await upsertTransaction(
        supabase,
        userId,
        transaction,
        daysByDate.get(transaction.date) ?? null,
        "migration",
      );
      counts.transactions += 1;
    }

    for (const item of normalized.reviewItems) {
      await insertRow(supabase, "migration_review_items", {
        migration_run_id: run.id,
        user_id: userId,
        severity: item.severity,
        category: item.category,
        source_path: item.sourcePath,
        source_payload: item.sourcePayload ?? null,
        message: item.message,
      });
      counts.reviewItems += 1;
    }

    await updateRows(supabase, "migration_runs", run.id, {
      finished_at: new Date().toISOString(),
      status: "succeeded",
      summary: { ...report.summary, applied: counts },
    });

    return {
      ...report,
      apply: {
        wroteToSupabase: true,
        migrationRunId: run.id,
        insertedOrUpdated: counts,
      },
    };
  } catch (error) {
    await updateRows(supabase, "migration_runs", run.id, {
      finished_at: new Date().toISOString(),
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
      summary: { ...report.summary, failedAfter: counts },
    });
    throw error;
  }
}

async function upsertWeek(supabase, userId, week) {
  const existing = await maybeSingle(
    supabase
      .from("weeks")
      .select("id,status")
      .eq("user_id", userId)
      .eq("start_date", week.startDate),
    "load existing week",
  );
  const status = existing?.status === "active" ? "active" : week.status;
  const payload = {
    user_id: userId,
    start_date: week.startDate,
    end_date: week.endDate,
    status,
    closed_at: status === "closed" ? new Date().toISOString() : null,
    archived_at: week.archivedAt,
  };

  if (existing) {
    return updateRows(supabase, "weeks", existing.id, payload);
  }

  return insertRow(supabase, "weeks", payload);
}

async function upsertDay(supabase, userId, weekId, day) {
  const existing = await maybeSingle(
    supabase
      .from("days")
      .select("id")
      .eq("user_id", userId)
      .eq("week_id", weekId)
      .eq("day_index", day.dayIndex),
    "load existing day",
  );
  const payload = {
    user_id: userId,
    week_id: weekId,
    date: day.date,
    day_index: day.dayIndex,
    base_amount: day.baseAmount,
    manual_spend_adjustment: day.manualSpendAdjustment,
    spend_locked: day.spendLocked,
  };

  if (existing) {
    return updateRows(supabase, "days", existing.id, payload);
  }

  return insertRow(supabase, "days", payload);
}

async function upsertEarnSlot(supabase, userId, dayId, slot) {
  const existing = await maybeSingle(
    supabase
      .from("earn_slots")
      .select("id")
      .eq("user_id", userId)
      .eq("day_id", dayId)
      .eq("slot_index", slot.slotIndex),
    "load existing earn slot",
  );
  const payload = {
    user_id: userId,
    day_id: dayId,
    slot_index: slot.slotIndex,
    job_type: slot.jobType,
    pay_type: slot.payType,
    hours_or_units: slot.hoursOrUnits,
    label: slot.label,
    source: "migration",
  };

  if (existing) {
    return updateRows(supabase, "earn_slots", existing.id, payload);
  }

  return insertRow(supabase, "earn_slots", payload);
}

async function upsertTransaction(supabase, userId, transaction, dayId, source) {
  const importKey = transaction.legacyId;
  const existing = await maybeSingle(
    supabase
      .from("transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("source", source)
      .eq("import_key", importKey),
    "load existing transaction",
  );
  const payload = {
    user_id: userId,
    day_id: dayId,
    source,
    status: dayId ? "applied" : "pending_review",
    review_reason: dayId ? null : "no_matching_day",
    import_key: importKey,
    date: transaction.date,
    merchant_name: transaction.merchantName,
    raw_name: transaction.rawName,
    amount: transaction.amount,
    category: transaction.category,
    pending: transaction.pending,
    notes: `Imported from ${transaction.sourcePath}`,
  };

  if (existing) {
    return updateRows(supabase, "transactions", existing.id, payload);
  }

  return insertRow(supabase, "transactions", payload);
}

async function upsertIdentityMap(supabase, userId, runId, source, legacyPath, legacyId, targetTable, targetId) {
  const { data, error } = await supabase
    .from("migration_identity_map")
    .upsert(
      {
        migration_run_id: runId,
        user_id: userId,
        source,
        legacy_path: legacyPath,
        legacy_id: legacyId,
        target_table: targetTable,
        target_id: targetId,
      },
      { onConflict: "user_id,source,target_table,legacy_id" },
    )
    .select("id")
    .single();

  if (error) {
    throw new Error(`Unable to upsert identity map: ${error.message}`);
  }

  return data;
}

async function resolveUserId(supabase, args) {
  if (args.userId) {
    return args.userId;
  }

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    throw new Error(`Unable to list Supabase users: ${error.message}`);
  }

  const user = data.users.find((candidate) => candidate.email?.toLowerCase() === args.userEmail);
  if (!user) {
    throw new Error(`No Supabase auth user found for ${args.userEmail}.`);
  }

  return user.id;
}

async function insertRow(supabase, table, payload) {
  const { data, error } = await supabase.from(table).insert(payload).select("*").single();
  if (error) {
    throw new Error(`Unable to insert ${table}: ${error.message}`);
  }
  return data;
}

async function updateRows(supabase, table, id, payload) {
  const { data, error } = await supabase
    .from(table)
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Unable to update ${table}: ${error.message}`);
  }
  return data;
}

async function maybeSingle(query, label) {
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`Unable to ${label}: ${error.message}`);
  }
  return data;
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  }
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY. Add it only locally; never expose it to the browser.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function writeReport(report, reportPath) {
  if (!reportPath) {
    return;
  }

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
}

function printReport(report) {
  console.log("\nFirebase import report");
  console.log("======================");
  console.log(`Mode: ${report.mode}`);
  console.log(`Source: ${report.sourcePath}`);
  console.log(`Backup: ${report.backupPath}`);
  console.log(`Weeks: ${report.summary.weeks}`);
  console.log(`Days: ${report.summary.days}`);
  console.log(`Earn slots: ${report.summary.earnSlots}`);
  console.log(`Day transactions: ${report.summary.dayTransactions}`);
  console.log(`Cached transactions: ${report.summary.cachedTransactions}`);
  console.log(`Review items: ${report.summary.reviewItems}`);
  const verificationIssues = report.verification.filter((item) => item.hasIssue);
  console.log(`Verification deltas > $1: ${verificationIssues.length}`);

  if (report.apply.wroteToSupabase) {
    console.log(`Migration run: ${report.apply.migrationRunId}`);
    console.log(`Applied: ${JSON.stringify(report.apply.insertedOrUpdated)}`);
  }

  if (report.reviewItems.length > 0) {
    console.log("\nReview queue preview:");
    report.reviewItems.slice(0, 20).forEach((item) => {
      console.log(`- [${item.severity}] ${item.category}: ${item.message} (${item.sourcePath})`);
    });
    if (report.reviewItems.length > 20) {
      console.log(`... ${report.reviewItems.length - 20} more`);
    }
  }

  if (verificationIssues.length > 0) {
    console.log("\nVerification preview:");
    verificationIssues.slice(0, 10).forEach((item) => {
      console.log(
        `- ${item.startDate}: earnings ${formatDelta(item.earningsDelta)}, spend ${formatDelta(
          item.spendDelta,
        )}, cashflow ${formatDelta(item.cashflowDelta)}`,
      );
    });
    if (verificationIssues.length > 10) {
      console.log(`... ${verificationIssues.length - 10} more`);
    }
  }
}

function mergeDays(leftDays, rightDays, reviewItems) {
  const merged = [...leftDays];

  rightDays.forEach((day) => {
    const existing = merged[day.dayIndex];
    if (!existing || existing.slots.length === 0) {
      merged[day.dayIndex] = day;
      return;
    }

    reviewItems.push({
      severity: "warning",
      category: "duplicate_day",
      sourcePath: day.sourcePath,
      message: `Duplicate day ${day.date}; kept the first populated version.`,
      sourcePayload: null,
    });
  });

  return merged;
}

function normalizeJobType(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("ability")) return "ability";
  if (normalized.includes("prestige")) return "prestige";
  if (normalized.includes("incentive")) return "incentive";
  if (normalized.includes("other")) return "other";
  if (normalized === "none") return "none";
  return null;
}

function normalizePayType(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("over") || normalized === "ot") return "overtime";
  if (normalized.includes("reg")) return "regular";
  if (normalized.includes("unit")) return "unit";
  if (normalized === "none") return "none";
  return null;
}

function normalizePayTypeForJob(jobType, payType) {
  if (jobType === "incentive" || jobType === "other") return "unit";
  if (jobType === "none") return "none";
  return payType === "overtime" ? "overtime" : "regular";
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : null;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return toIsoDate(value);
  const stringValue = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) return stringValue;
  const parsed = new Date(stringValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return toIsoDate(parsed);
}

function parseRangeStart(value) {
  if (!value) return null;
  const match = String(value).match(/([A-Za-z]{3,9})\s+(\d{1,2}).*?(\d{4})/);
  if (!match) return null;
  return normalizeDate(`${match[1]} ${match[2]}, ${match[3]}`);
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, count) {
  return toIsoDate(new Date(new Date(`${date}T00:00:00.000Z`).getTime() + count * DAY_MS));
}

function dateDiff(startDate, endDate) {
  return Math.round(
    (new Date(`${endDate}T00:00:00.000Z`).getTime() -
      new Date(`${startDate}T00:00:00.000Z`).getTime()) /
      DAY_MS,
  );
}

function isSunday(date) {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay() === 0;
}

function summarizePayload(value) {
  if (value === undefined) return null;
  const stringValue = JSON.stringify(value);
  if (!stringValue) return null;
  if (stringValue.length > 2000) {
    return {
      truncated: true,
      preview: stringValue.slice(0, 2000),
    };
  }
  return JSON.parse(stringValue);
}

function loadEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex === -1) return;
      const key = trimmed.slice(0, equalsIndex).trim();
      const value = trimmed.slice(equalsIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    });
  } catch {
    // .env.local is optional for dry-run.
  }
}

function addVerificationReviewItems(weeks, reviewItems) {
  for (const week of weeks) {
    const actual = calculateWeekVerificationTotals(week);
    const expected = week.expected;

    maybePushVerificationIssue(
      reviewItems,
      week,
      "earnings",
      actual.earnings,
      expected.earnings,
    );
    maybePushVerificationIssue(reviewItems, week, "spend", actual.spend, expected.spend);
    maybePushVerificationIssue(
      reviewItems,
      week,
      "cashflow",
      actual.cashflow,
      expected.cashflow,
    );
  }
}

function maybePushVerificationIssue(reviewItems, week, field, actual, expected) {
  if (expected === null || expected === undefined) return;
  const delta = roundMoney(actual - expected);
  if (Math.abs(delta) <= 1) return;

  reviewItems.push({
    severity: "warning",
    category: "verification_delta",
    sourcePath: week.sourcePath,
    message: `Imported ${field} differs from Firebase ${field} by ${formatDelta(delta)} for week ${week.startDate}.`,
    sourcePayload: {
      weekStart: week.startDate,
      field,
      imported: actual,
      sourceExpected: expected,
      delta,
    },
  });
}

function buildVerificationReport(weeks) {
  return weeks.map((week) => {
    const actual = calculateWeekVerificationTotals(week);
    const earningsDelta = differenceOrNull(actual.earnings, week.expected.earnings);
    const spendDelta = differenceOrNull(actual.spend, week.expected.spend);
    const cashflowDelta = differenceOrNull(actual.cashflow, week.expected.cashflow);

    return {
      startDate: week.startDate,
      endDate: week.endDate,
      sourcePaths: week.sourcePaths,
      imported: actual,
      expected: week.expected,
      earningsDelta,
      spendDelta,
      cashflowDelta,
      hasIssue: [earningsDelta, spendDelta, cashflowDelta].some(
        (delta) => delta !== null && Math.abs(delta) > 1,
      ),
    };
  });
}

function differenceOrNull(actual, expected) {
  if (expected === null || expected === undefined) return null;
  return roundMoney(actual - expected);
}

function calculateWeekVerificationTotals(week) {
  return week.days.reduce(
    (weekTotals, day) => {
      const dayTotals = calculateDayVerificationTotals(day);
      return {
        earnings: roundMoney(weekTotals.earnings + dayTotals.earnings),
        spend: roundMoney(weekTotals.spend + dayTotals.spend),
        base: roundMoney(weekTotals.base + dayTotals.base),
        cashflow: roundMoney(weekTotals.cashflow + dayTotals.cashflow),
      };
    },
    { earnings: 0, spend: 0, base: 0, cashflow: 0 },
  );
}

function calculateDayVerificationTotals(day) {
  const earnings = day.slots.reduce(
    (sum, slot) => roundMoney(sum + calculateSlotEarnings(slot)),
    0,
  );
  const spend = roundMoney(
    day.manualSpendAdjustment +
      day.transactions.reduce((sum, transaction) => sum + transaction.amount, 0),
  );
  const base = day.baseAmount;

  return {
    earnings,
    spend,
    base,
    cashflow: roundMoney(earnings - spend - base),
  };
}

function calculateSlotEarnings(slot) {
  const amount = Math.max(0, slot.hoursOrUnits ?? 0);
  if (slot.jobType === "none" || amount === 0) return 0;

  if (slot.jobType === "ability") {
    const rate =
      slot.payType === "overtime"
        ? DEFAULT_PAY_SETTINGS.abilityOvertimeNetRate
        : DEFAULT_PAY_SETTINGS.abilityRegularNetRate;
    return roundMoney(amount * rate);
  }

  if (slot.jobType === "prestige") {
    const rate =
      slot.payType === "overtime"
        ? DEFAULT_PAY_SETTINGS.prestigeOvertimeNetRate
        : DEFAULT_PAY_SETTINGS.prestigeRegularNetRate;
    return roundMoney(amount * rate);
  }

  if (slot.jobType === "incentive") {
    return roundMoney(amount * DEFAULT_PAY_SETTINGS.incentiveNetMultiplier);
  }

  return roundMoney(amount);
}

function formatDelta(value) {
  if (value === null || value === undefined) return "n/a";
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}$${Math.abs(value).toFixed(2)}`;
}

function stripJsonBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
