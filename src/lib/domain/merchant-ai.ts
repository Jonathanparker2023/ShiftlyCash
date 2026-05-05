import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeTxName } from "@/lib/domain/legacyRules";

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";
const MAX_AI_NAME_LENGTH = 40;

export type MerchantNameCacheSource = "rule" | "ai" | "user";

type MerchantCacheRow = {
  display_name: string;
};

type MerchantCacheWrite = {
  raw_key: string;
  display_name: string;
  source: MerchantNameCacheSource;
  ai_model: string | null;
  updated_at: string;
};

export function merchantRawKey(rawName: string): string {
  return rawName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isLikelyUglyMerchantName(cleanedName: string): boolean {
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

export async function resolveMerchantName(
  rawName: string | null | undefined,
  supabaseAdmin: SupabaseClient,
): Promise<string> {
  if (!rawName) return "";

  const rawKey = merchantRawKey(rawName);

  if (!rawKey) {
    return rawName;
  }

  const { data: cached, error: cacheError } = await supabaseAdmin
    .from("merchant_name_cache")
    .select("display_name")
    .eq("raw_key", rawKey)
    .maybeSingle();

  if (cacheError) {
    console.warn("merchant_name_cache lookup failed:", cacheError.message);
  }

  if (cached) {
    return (cached as MerchantCacheRow).display_name;
  }

  const cleaned = normalizeTxName(rawName);
  let final = cleaned;
  let source: MerchantNameCacheSource = "rule";
  let aiModel: string | null = null;

  if (isLikelyUglyMerchantName(cleaned)) {
    const aiResult = await aiCleanupName(rawName);

    if (aiResult) {
      final = aiResult;
      source = "ai";
      aiModel = getAnthropicModel();
      console.info(`AI normalized merchant "${rawName}" -> "${final}"`);
    }
  }

  writeMerchantCache(supabaseAdmin, {
    raw_key: rawKey,
    display_name: final,
    source,
    ai_model: aiModel,
    updated_at: new Date().toISOString(),
  });

  return final;
}

export async function aiCleanupName(rawName: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: getAnthropicModel(),
      max_tokens: 100,
      system: `You normalize messy bank transaction descriptions into clean merchant display names.

Rules:
- Output ONLY the clean merchant name in title case (e.g., "Perplexity", "Chick-fil-A").
- If you cannot identify a real merchant with high confidence, output exactly "UNKNOWN".
- Never invent merchants. If the input is ambiguous (e.g., "TST* CORE"), output "UNKNOWN".
- Strip URLs, domain suffixes, store numbers, dates, location codes, payment processor prefixes (TST*, SQ*, PYP*).
- Do NOT include explanations, quotes, punctuation around the answer, or any extra text.

Examples:
Input: "www.perplexity.ai"          -> Perplexity
Input: "AMZN MKTP US*1A2B3"         -> Amazon
Input: "TST* CORE BURGER NY"        -> UNKNOWN
Input: "STARBUCKS #12345 CHICAGO"   -> Starbucks`,
      messages: [{ role: "user", content: rawName }],
    });
    const text = extractAnthropicText(response.content).trim();

    if (!text || text.toUpperCase() === "UNKNOWN") {
      return null;
    }

    if (text.length > MAX_AI_NAME_LENGTH) {
      return null;
    }

    return text;
  } catch (error) {
    console.warn(
      "Anthropic merchant normalization failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}

function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
}

function writeMerchantCache(
  supabaseAdmin: SupabaseClient,
  payload: MerchantCacheWrite,
) {
  void supabaseAdmin
    .from("merchant_name_cache")
    .upsert(payload)
    .then(({ error }) => {
      if (error) {
        console.warn("merchant_name_cache upsert failed:", error.message);
      }
    });
}

function extractAnthropicText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  const textBlock = content.find(
    (block): block is { type: string; text?: string } =>
      Boolean(block) &&
      typeof block === "object" &&
      "type" in block &&
      (block as { type?: unknown }).type === "text",
  );

  return textBlock?.text ?? "";
}
