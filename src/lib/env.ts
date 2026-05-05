type SupabasePublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export function getSupabasePublicEnv(): SupabasePublicEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  return { supabaseUrl, supabasePublishableKey };
}

export function getSiteUrl(): string {
  const rawUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL ??
    "http://localhost:3000";

  const withProtocol = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  return withProtocol.endsWith("/") ? withProtocol.slice(0, -1) : withProtocol;
}

export type PlaidServerEnv = {
  clientId: string;
  secret: string;
  env: "sandbox" | "development" | "production";
  products: string[];
  countryCodes: string[];
  tokenEncryptionKey: string;
};

const PLAID_ENV_VALUES = ["sandbox", "development", "production"] as const;

export function getPlaidServerEnv(): PlaidServerEnv {
  const result = getOptionalPlaidServerEnv();

  if (!result.config) {
    throw new Error(`Missing Plaid config: ${result.missing.join(", ")}`);
  }

  return result.config;
}

export function getOptionalPlaidServerEnv(): {
  config: PlaidServerEnv | null;
  missing: string[];
} {
  const rawEnv = process.env.PLAID_ENV ?? "sandbox";
  const env = PLAID_ENV_VALUES.find((value) => value === rawEnv);
  const values = {
    PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID,
    PLAID_SECRET: process.env.PLAID_SECRET,
    PLAID_ENV: env,
    PLAID_PRODUCTS: process.env.PLAID_PRODUCTS ?? "transactions",
    PLAID_COUNTRY_CODES: process.env.PLAID_COUNTRY_CODES ?? "US",
    PLAID_ACCESS_TOKEN_ENCRYPTION_KEY:
      process.env.PLAID_ACCESS_TOKEN_ENCRYPTION_KEY,
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (!env && !missing.includes("PLAID_ENV")) {
    missing.push("PLAID_ENV");
  }

  if (missing.length > 0 || !env) {
    return { config: null, missing };
  }

  const clientId = values.PLAID_CLIENT_ID;
  const secret = values.PLAID_SECRET;
  const tokenEncryptionKey = values.PLAID_ACCESS_TOKEN_ENCRYPTION_KEY;

  if (!clientId || !secret || !tokenEncryptionKey) {
    return {
      config: null,
      missing: ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ACCESS_TOKEN_ENCRYPTION_KEY"],
    };
  }

  return {
    config: {
      clientId,
      secret,
      env,
      products: splitCsv(values.PLAID_PRODUCTS),
      countryCodes: splitCsv(values.PLAID_COUNTRY_CODES),
      tokenEncryptionKey,
    },
    missing: [],
  };
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
