import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(".env.local");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const anthropicModel = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local or the shell.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: transactions, error } = await supabase
  .from("transactions")
  .select("id,merchant_name,raw_name")
  .order("date", { ascending: true });

if (error) {
  console.error(`Unable to fetch transactions: ${error.message}`);
  process.exit(1);
}

const candidates = (transactions ?? []).filter((transaction) =>
  isLikelyUgly(transaction.merchant_name ?? ""),
);
const samples = [];
let changed = 0;
let unchanged = 0;

console.log(
  `${dryRun ? "Dry run" : "Apply"}: ${candidates.length} ugly-looking transactions out of ${
    transactions?.length ?? 0
  }.`,
);

for (const transaction of candidates) {
  const rawName = transaction.raw_name || transaction.merchant_name || "";
  const nextName = await resolveMerchantName(rawName);

  if (!nextName || nextName === transaction.merchant_name) {
    unchanged++;
    continue;
  }

  changed++;

  if (samples.length < 20) {
    samples.push(`"${transaction.merchant_name}" -> "${nextName}"`);
  }

  if (apply) {
    const { error: updateError } = await supabase
      .from("transactions")
      .update({ merchant_name: nextName })
      .eq("id", transaction.id);

    if (updateError) {
      console.warn(`Unable to update ${transaction.id}: ${updateError.message}`);
    }
  }
}

console.log(`Would change ${changed}; unchanged ${unchanged}.`);
console.log("Sample diffs:");
samples.forEach((sample) => console.log(`  ${sample}`));

async function resolveMerchantName(rawName) {
  if (!rawName) return "";

  const rawKey = compactKey(rawName);
  const { data: cached } = await supabase
    .from("merchant_name_cache")
    .select("display_name")
    .eq("raw_key", rawKey)
    .maybeSingle();

  if (cached?.display_name) {
    return cached.display_name;
  }

  const fallback = titleCaseFallback(rawName);
  let displayName = fallback;
  let source = "rule";
  let aiModel = null;

  if (isLikelyUgly(fallback)) {
    const aiName = await aiCleanupName(rawName);

    if (aiName) {
      displayName = aiName;
      source = "ai";
      aiModel = anthropicModel;
    }
  }

  if (apply) {
    const { error: cacheError } = await supabase
      .from("merchant_name_cache")
      .upsert({
        raw_key: rawKey,
        display_name: displayName,
        source,
        ai_model: aiModel,
        updated_at: new Date().toISOString(),
      });

    if (cacheError) {
      console.warn(`Cache write failed for ${rawName}: ${cacheError.message}`);
    }
  }

  return displayName;
}

async function aiCleanupName(rawName) {
  if (!anthropicApiKey) {
    return null;
  }

  try {
    const client = new Anthropic({ apiKey: anthropicApiKey });
    const response = await client.messages.create({
      model: anthropicModel,
      max_tokens: 100,
      system:
        "Normalize messy bank transaction descriptions into one clean merchant display name. Output ONLY title-case merchant name, or UNKNOWN if ambiguous. Strip URLs, suffixes, dates, store numbers, location codes, and payment processor prefixes.",
      messages: [{ role: "user", content: rawName }],
    });
    const textBlock = response.content.find((block) => block.type === "text");
    const text = textBlock?.text?.trim() ?? "";

    if (!text || text.toUpperCase() === "UNKNOWN" || text.length > 40) {
      return null;
    }

    return text;
  } catch (caughtError) {
    console.warn(
      `AI cleanup failed for "${rawName}": ${
        caughtError instanceof Error ? caughtError.message : "unknown error"
      }`,
    );
    return null;
  }
}

function isLikelyUgly(cleanedName) {
  if (!cleanedName) return true;
  if (/\d/.test(cleanedName)) return true;
  if (/^www\b/i.test(cleanedName)) return true;
  if (/www\.|https?:\/\//i.test(cleanedName)) return true;
  if (/\.(com|ai|io|net|org|co|app|dev|gg)\b/i.test(cleanedName)) return true;
  if (cleanedName.split(/\s+/).length > 3) return true;
  if (cleanedName.length > 22) return true;
  if (/^[a-z]+\.[a-z]+/i.test(cleanedName)) return true;
  return false;
}

function compactKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function titleCaseFallback(value) {
  const cleaned = String(value)
    .replace(/^(tst\s*\*|sq\s*\*|py\s*\*|pyp\s*\*|pos\s+(debit\s+)?)/i, "")
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ")
    .replace(/[\s\-_#*]+\d{2,}[a-z0-9]{0,10}\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function loadEnvFile(fileName) {
  const envPath = path.resolve(process.cwd(), fileName);

  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^"|"$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
