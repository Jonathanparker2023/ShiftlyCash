#!/usr/bin/env node

import { createDecipheriv, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

const DEFAULT_WEBHOOK_URL = "https://shiftlycash.vercel.app/api/plaid/webhook";
const TOKEN_ALGORITHM = "aes-256-gcm";

loadEnvFile(".env.local");

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const webhookUrl =
    process.argv[2] || process.env.PLAID_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;
  validateUrl(webhookUrl);

  const plaidEnv = process.env.PLAID_ENV || "production";
  const basePath = PlaidEnvironments[plaidEnv];

  if (!basePath) {
    throw new Error(
      `Invalid PLAID_ENV "${plaidEnv}". Use sandbox, development, or production.`,
    );
  }

  const clientId = requireEnv("PLAID_CLIENT_ID");
  const secret = requireEnv("PLAID_SECRET");
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const tokenEncryptionKey = requireEnv("PLAID_ACCESS_TOKEN_ENCRYPTION_KEY");

  const plaid = new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret,
        },
      },
    }),
  );
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: items, error } = await supabase
    .from("plaid_items")
    .select("id,plaid_item_id,access_token_encrypted")
    .not("access_token_encrypted", "is", null);

  if (error) {
    throw new Error(`Unable to load Plaid items: ${error.message}`);
  }

  if (!items?.length) {
    console.log("No Plaid items to update.");
    return;
  }

  const failures = [];
  let updated = 0;

  for (const item of items) {
    try {
      const accessToken = decryptAccessToken(
        item.access_token_encrypted,
        tokenEncryptionKey,
      );
      await plaid.itemWebhookUpdate({
        access_token: accessToken,
        webhook: webhookUrl,
      });
      updated++;
    } catch (error) {
      failures.push(
        `${item.plaid_item_id ?? item.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Updated ${updated} item(s), but ${failures.length} failed:\n${failures.join(
        "\n",
      )}`,
    );
  }

  console.log(`Webhook URL set to ${webhookUrl} for ${updated} item(s).`);
}

function decryptAccessToken(encryptedToken, secret) {
  const [version, ivRaw, tagRaw, encryptedRaw] = encryptedToken.split(":");

  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Invalid encrypted Plaid token format.");
  }

  const decipher = createDecipheriv(
    TOKEN_ALGORITHM,
    deriveKey(secret),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function deriveKey(secret) {
  return createHash("sha256").update(secret).digest();
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.local or the shell.`);
  }

  return value;
}

function validateUrl(value) {
  const url = new URL(value);

  if (url.protocol !== "https:") {
    throw new Error("Plaid webhook URL must use https.");
  }
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
