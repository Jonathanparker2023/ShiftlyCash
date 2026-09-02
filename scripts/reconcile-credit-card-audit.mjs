import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

export function validateAuditPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") return ["Payload must be an object."];
  if (typeof payload.profileEmail !== "string" || !payload.profileEmail.includes("@")) {
    errors.push("profileEmail must be a valid email address.");
  }
  if (!Array.isArray(payload.accounts) || payload.accounts.length === 0) {
    errors.push("accounts must contain at least one card account.");
  }
  if (!Array.isArray(payload.transactions)) {
    errors.push("transactions must be an array.");
  }
  if (!Array.isArray(payload.expenses)) {
    errors.push("expenses must be an array.");
  }

  const accountNames = new Set();
  for (const [index, account] of (payload.accounts ?? []).entries()) {
    if (!account?.name) errors.push(`accounts[${index}].name is required.`);
    if (!account?.debtName) errors.push(`accounts[${index}].debtName is required.`);
    if (account?.name && accountNames.has(account.name)) {
      errors.push(`Duplicate account name: ${account.name}.`);
    }
    accountNames.add(account?.name);
    if (!Number.isFinite(account?.planningBalance) || account.planningBalance < 0) {
      errors.push(`accounts[${index}].planningBalance must be non-negative.`);
    }
    if (
      account?.scheduledPaymentAmount !== undefined &&
      account.scheduledPaymentAmount !== null &&
      (!Number.isFinite(account.scheduledPaymentAmount) ||
        account.scheduledPaymentAmount <= 0)
    ) {
      errors.push(
        `accounts[${index}].scheduledPaymentAmount must be positive or null.`,
      );
    }
    if (
      account?.scheduledPaymentDate !== undefined &&
      account.scheduledPaymentDate !== null &&
      !/^\d{4}-\d{2}-\d{2}$/.test(account.scheduledPaymentDate)
    ) {
      errors.push(
        `accounts[${index}].scheduledPaymentDate must be YYYY-MM-DD or null.`,
      );
    }
    const hasScheduledAmount = account?.scheduledPaymentAmount != null;
    const hasScheduledDate = account?.scheduledPaymentDate != null;
    if (hasScheduledAmount !== hasScheduledDate) {
      errors.push(
        `accounts[${index}] scheduled payment amount and date must be provided together.`,
      );
    }
  }

  const importKeys = new Set();
  for (const [index, transaction] of (payload.transactions ?? []).entries()) {
    if (!accountNames.has(transaction?.accountName)) {
      errors.push(`transactions[${index}] references an unknown account.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transaction?.date ?? "")) {
      errors.push(`transactions[${index}].date must be YYYY-MM-DD.`);
    }
    if (!transaction?.importKey) {
      errors.push(`transactions[${index}].importKey is required.`);
    } else if (importKeys.has(transaction.importKey)) {
      errors.push(`Duplicate transaction importKey: ${transaction.importKey}.`);
    }
    importKeys.add(transaction?.importKey);
    if (!Number.isFinite(transaction?.amount) || transaction.amount < 0) {
      errors.push(`transactions[${index}].amount must be non-negative.`);
    }
    if (!["applied", "excluded", "pending_review"].includes(transaction?.status)) {
      errors.push(`transactions[${index}].status is invalid.`);
    }
    if (!["legitimate", "disputed", "recurring", "unknown"].includes(transaction?.classification)) {
      errors.push(`transactions[${index}].classification is invalid.`);
    }
  }

  return errors;
}

function parseArgs(argv) {
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : argv[index + 1] ?? null;
  };
  return {
    input: valueAfter("--input"),
    apply: argv.includes("--apply"),
    validateOnly: argv.includes("--validate-only"),
    backupDir: valueAfter("--backup-dir") ?? path.resolve("backups"),
  };
}

async function selectAffectedState(supabase, userId, payload) {
  const debtNames = [...new Set(payload.accounts.flatMap((account) => [account.debtName, ...(account.debtMatchNames ?? [])]))];
  const accountNames = payload.accounts.map((account) => account.name);
  const expenseNames = [...new Set(payload.expenses.flatMap((expense) => [expense.name, ...(expense.matchNames ?? [])]))];
  const importKeys = payload.transactions.map((transaction) => transaction.importKey);

  const [debts, accounts, expenses, transactions] = await Promise.all([
    supabase.from("debts").select("*").eq("user_id", userId).in("name", debtNames),
    supabase.from("credit_card_accounts").select("*").eq("user_id", userId).in("name", accountNames),
    supabase.from("expenses").select("*").eq("user_id", userId).in("name", expenseNames),
    importKeys.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase.from("transactions").select("*").eq("user_id", userId).in("import_key", importKeys),
  ]);

  for (const [label, result] of Object.entries({ debts, accounts, expenses, transactions })) {
    if (result.error) throw new Error(`Unable to read affected ${label}: ${result.error.message}`);
  }
  return {
    debts: debts.data ?? [],
    accounts: accounts.data ?? [],
    expenses: expenses.data ?? [],
    transactions: transactions.data ?? [],
  };
}

function normalizeMerchant(value) {
  return value
    .replace(/^.*?\s—\s/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function findPotentialCollisions(supabase, userId, transactions) {
  if (transactions.length === 0) return new Map();
  const dates = [...new Set(transactions.map((transaction) => transaction.date))];
  const amounts = [...new Set(transactions.map((transaction) => transaction.amount))];
  const { data, error } = await supabase
    .from("transactions")
    .select("id,date,amount,merchant_name,source,status,import_key")
    .eq("user_id", userId)
    .in("date", dates)
    .in("amount", amounts);
  if (error) throw new Error(`Unable to check transaction collisions: ${error.message}`);

  const byImportKey = new Map();
  for (const incoming of transactions) {
    const incomingMerchant = normalizeMerchant(incoming.merchant);
    const collision = (data ?? []).find((existing) => {
      if (existing.import_key === incoming.importKey) return true;
      if (existing.date !== incoming.date || Number(existing.amount) !== incoming.amount) return false;
      const existingMerchant = normalizeMerchant(existing.merchant_name);
      return (
        incomingMerchant.length >= 4 &&
        existingMerchant.length >= 4 &&
        (incomingMerchant.includes(existingMerchant) || existingMerchant.includes(incomingMerchant))
      );
    });
    if (collision) byImportKey.set(incoming.importKey, collision);
  }
  return byImportKey;
}

async function ensureDebt(supabase, userId, account, currentDebts) {
  const candidates = [account.debtName, ...(account.debtMatchNames ?? [])];
  const existing = currentDebts.find((debt) => candidates.includes(debt.name));
  const patch = {
    name: account.debtName,
    balance: account.planningBalance,
    minimum_payment: account.minimumDue ?? 0,
    status: account.planningBalance > 0 ? "active" : "paid",
    ...(account.apr == null ? {} : { apr: account.apr }),
  };
  if (existing) {
    const { data, error } = await supabase.from("debts").update(patch).eq("id", existing.id).eq("user_id", userId).select("*").single();
    if (error) throw new Error(`Unable to update debt ${account.debtName}: ${error.message}`);
    Object.assign(existing, data);
    return data;
  }

  const priorityOrder = Math.max(0, ...currentDebts.map((debt) => Number(debt.priority_order ?? 0))) + 10;
  const { data, error } = await supabase.from("debts").insert({ user_id: userId, priority_order: priorityOrder, apr: account.apr ?? 0, ...patch }).select("*").single();
  if (error) throw new Error(`Unable to insert debt ${account.debtName}: ${error.message}`);
  currentDebts.push(data);
  return data;
}

async function saveAccount(supabase, userId, account, debtId, currentAccounts) {
  const existing = currentAccounts.find((row) => row.name.toLowerCase() === account.name.toLowerCase());
  const patch = {
    user_id: userId,
    debt_id: debtId,
    name: account.name,
    issuer: account.issuer,
    last_four: account.lastFour ?? null,
    account_kind: account.accountKind ?? "credit_card",
    account_status: account.accountStatus ?? "active",
    raw_current_balance: account.rawCurrentBalance ?? null,
    planning_balance: account.planningBalance,
    statement_balance: account.statementBalance ?? null,
    statement_date: account.statementDate ?? null,
    pending_total: account.pendingTotal ?? null,
    credit_limit: account.creditLimit ?? null,
    available_credit: account.availableCredit ?? null,
    minimum_due: account.minimumDue ?? null,
    due_date: account.dueDate ?? null,
    ...(Object.hasOwn(account, "scheduledPaymentAmount")
      ? { scheduled_payment_amount: account.scheduledPaymentAmount }
      : {}),
    ...(Object.hasOwn(account, "scheduledPaymentDate")
      ? { scheduled_payment_date: account.scheduledPaymentDate }
      : {}),
    autopay_status: account.autopayStatus ?? "unknown",
    autopay_mode: account.autopayMode ?? null,
    autopay_day: account.autopayDay ?? null,
    autopay_source_label: account.autopaySourceLabel ?? null,
    apr: account.apr ?? null,
    monthly_fee: account.monthlyFee ?? null,
    annual_fee: account.annualFee ?? null,
    credit_protection_amount: account.creditProtectionAmount ?? null,
    verification_status: account.verificationStatus ?? "unverified",
    verified_at: account.verifiedAt ?? null,
    disputed_total: account.disputedTotal ?? 0,
    risk_status: account.riskStatus ?? "unverified",
    notes: account.notes ?? null,
    updated_at: new Date().toISOString(),
  };
  const query = existing
    ? supabase.from("credit_card_accounts").update(patch).eq("id", existing.id).eq("user_id", userId)
    : supabase.from("credit_card_accounts").insert(patch);
  const { data, error } = await query.select("*").single();
  if (error) throw new Error(`Unable to save card ${account.name}: ${error.message}`);
  if (existing) Object.assign(existing, data);
  else currentAccounts.push(data);
  return data;
}

async function saveTransactions(supabase, userId, payload, cardsByName, existingTransactions, collisionByImportKey) {
  const dates = [...new Set(payload.transactions.map((transaction) => transaction.date))];
  const { data: days, error: daysError } = await supabase.from("days").select("id,date").eq("user_id", userId).in("date", dates);
  if (daysError) throw new Error(`Unable to resolve transaction days: ${daysError.message}`);
  const dayByDate = new Map((days ?? []).map((day) => [day.date, day.id]));
  const existingByKey = new Map(existingTransactions.map((transaction) => [transaction.import_key, transaction]));

  for (const transaction of payload.transactions) {
    const dayId = dayByDate.get(transaction.date);
    if (!dayId) throw new Error(`No BashFlow day exists for ${transaction.date}.`);
    const card = cardsByName.get(transaction.accountName);
    const row = {
      user_id: userId,
      day_id: dayId,
      credit_card_account_id: card.id,
      source: "manual",
      status: transaction.status,
      review_reason: transaction.status === "pending_review" ? transaction.reviewReason ?? "Card audit requires review" : null,
      import_key: transaction.importKey,
      date: transaction.date,
      merchant_name: transaction.merchant,
      raw_name: transaction.rawName ?? transaction.merchant,
      amount: transaction.amount,
      category: transaction.category ?? "credit_card",
      pending: transaction.pending ?? false,
      excluded_at: transaction.status === "excluded" ? transaction.excludedAt ?? payload.auditTimestamp : null,
      notes: transaction.notes ?? null,
      card_transaction_classification: transaction.classification,
      updated_at: new Date().toISOString(),
    };
    const existing = existingByKey.get(transaction.importKey) ?? collisionByImportKey.get(transaction.importKey);
    const result = existing
      ? await supabase
          .from("transactions")
          .update({ ...row, source: existing.source, import_key: transaction.importKey })
          .eq("id", existing.id)
          .eq("user_id", userId)
      : await supabase.from("transactions").insert(row);
    if (result.error) throw new Error(`Unable to save transaction ${transaction.importKey}: ${result.error.message}`);
  }
}

async function saveExpenses(supabase, userId, expenses, currentExpenses) {
  let sortOrder = Math.max(0, ...currentExpenses.map((expense) => Number(expense.sort_order ?? 0)));
  for (const expense of expenses) {
    const candidates = [expense.name, ...(expense.matchNames ?? [])];
    const existing = currentExpenses.find((row) => candidates.includes(row.name));
    const patch = {
      name: expense.name,
      amount: expense.amount,
      is_active: expense.isActive ?? true,
      ...(expense.withdrawalDay === undefined ? {} : { withdrawal_day: expense.withdrawalDay }),
      ...(expense.startsOn === undefined ? {} : { starts_on: expense.startsOn }),
    };
    if (existing) {
      const { error } = await supabase.from("expenses").update(patch).eq("id", existing.id).eq("user_id", userId);
      if (error) throw new Error(`Unable to update expense ${expense.name}: ${error.message}`);
      Object.assign(existing, patch);
    } else {
      sortOrder += 10;
      const { data, error } = await supabase.from("expenses").insert({ user_id: userId, sort_order: sortOrder, withdrawal_day: expense.withdrawalDay ?? null, expiration_date: null, ...patch }).select("*").single();
      if (error) throw new Error(`Unable to insert expense ${expense.name}: ${error.message}`);
      currentExpenses.push(data);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) throw new Error("Usage: node scripts/reconcile-credit-card-audit.mjs --input <payload.json> [--validate-only|--apply]");
  const payload = JSON.parse(await readFile(path.resolve(args.input), "utf8"));
  const validationErrors = validateAuditPayload(payload);
  if (validationErrors.length > 0) throw new Error(`Invalid audit payload:\n- ${validationErrors.join("\n- ")}`);
  if (args.validateOnly) {
    console.log(`Payload valid: ${payload.accounts.length} accounts, ${payload.transactions.length} transactions, ${payload.expenses.length} expenses.`);
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await supabase.from("profiles").select("id,email").eq("email", payload.profileEmail).single();
  if (profileError || !profile) throw new Error(`Unable to resolve profile: ${profileError?.message ?? "not found"}`);

  const before = await selectAffectedState(supabase, profile.id, payload);
  const collisionByImportKey = await findPotentialCollisions(
    supabase,
    profile.id,
    payload.transactions,
  );
  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    target: payload.profileEmail,
    accounts: payload.accounts.length,
    transactions: payload.transactions.length,
    existingTransactions: before.transactions.length,
    matchedExistingRows: collisionByImportKey.size,
    expenses: payload.expenses.length,
  };
  if (!args.apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  await mkdir(args.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = path.join(args.backupDir, `credit-card-reconcile-${stamp}.json`);
  await writeFile(backupPath, `${JSON.stringify({ createdAt: new Date().toISOString(), profileId: profile.id, before }, null, 2)}\n`, { mode: 0o600 });

  const cardsByName = new Map();
  for (const account of payload.accounts) {
    const debt = await ensureDebt(supabase, profile.id, account, before.debts);
    const card = await saveAccount(supabase, profile.id, account, debt.id, before.accounts);
    cardsByName.set(account.name, card);
  }
  await saveTransactions(
    supabase,
    profile.id,
    payload,
    cardsByName,
    before.transactions,
    collisionByImportKey,
  );
  await saveExpenses(supabase, profile.id, payload.expenses, before.expenses);

  const { error: baselineError } = await supabase.rpc("apply_baseline_to_future_days", { p_user_id: profile.id });
  if (baselineError) throw new Error(`Card data saved, but baseline restamp failed: ${baselineError.message}`);
  const after = await selectAffectedState(supabase, profile.id, payload);
  console.log(JSON.stringify({ ...summary, backupPath, savedAccounts: after.accounts.length, savedTransactions: after.transactions.length }, null, 2));
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
