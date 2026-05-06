/**
 * Legacy ShiftlyCash transaction rules ported from index.html.
 * Applied at Plaid sync time and used for runtime classification.
 */

// Substring matches against merchant_name OR raw_name (case-insensitive).
export const LEGACY_EXEMPT_NAMES: readonly string[] = [
  "scl residential",
  "rent",
  "holyoke",
  "direct debit",
  "ach debit",
  "subscription",
  "netflix",
  "spotify",
  "hulu",
  "disney+",
  "apple.com/bill",
  "google play",
  "google one",
  "google storage",
  "amazon prime",
  "youtube premium",
  "xbox",
  "playstation",
  "monthly fee",
  "monthly plan",
  "monthly charge",
  "perplexity",
  "anthropic",
  "openai",
  "chatgpt",
  "claude.ai",
  "doordashdashpass",
  "dashpass",
  "platinum car wash",
];

// Exact category match (case-insensitive).
export const LEGACY_EXEMPT_CATS: readonly string[] = [
  "subscription",
  "recurring",
  "loan payment",
  "mortgage",
  "insurance",
  "utilities",
];

// Compact-key → display-name pairs. Order matters: first match wins.
export const MERCHANT_MAP: ReadonlyArray<readonly [string, string]> = [
  ["amazon", "Amazon"],
  ["amzn", "Amazon"],
  ["walmart", "Walmart"],
  ["walmrt", "Walmart"],
  ["wmsupercenter", "Walmart"],
  ["target", "Target"],
  ["starbucks", "Starbucks"],
  ["sbux", "Starbucks"],
  ["mcdonald", "McDonalds"],
  ["dunkin", "Dunkin"],
  ["chickfil", "Chick-fil-A"],
  ["chipotle", "Chipotle"],
  ["subway", "Subway"],
  ["tacobell", "Taco Bell"],
  ["wendys", "Wendys"],
  ["kfc", "KFC"],
  ["popeyes", "Popeyes"],
  ["panera", "Panera"],
  ["domino", "Dominos"],
  ["pizzahut", "Pizza Hut"],
  ["papajohn", "Papa Johns"],
  ["ubereats", "Uber Eats"],
  ["uber", "Uber"],
  ["lyft", "Lyft"],
  ["doordash", "DoorDash"],
  ["grubhub", "Grubhub"],
  ["postmates", "Postmates"],
  ["instacart", "Instacart"],
  ["shipt", "Shipt"],
  ["spotify", "Spotify"],
  ["netflix", "Netflix"],
  ["hulu", "Hulu"],
  ["disney", "Disney+"],
  ["youtube", "YouTube"],
  ["hbomax", "HBO Max"],
  ["callofduty", "Call of Duty"],
  ["primeburger", "Primeburger"],
  ["blizzard", "Blizzard"],
  ["activision", "Activision"],
  ["itunes", "Apple"],
  ["applecom", "Apple"],
  ["appleitunes", "Apple"],
  ["apple", "Apple"],
  ["google", "Google"],
  ["microsoft", "Microsoft"],
  ["paypal", "PayPal"],
  ["pypl", "PayPal"],
  ["venmo", "Venmo"],
  ["cashapp", "Cash App"],
  ["zelle", "Zelle"],
  ["shell", "Shell"],
  ["exxon", "Exxon"],
  ["chevron", "Chevron"],
  ["mobil", "Mobil"],
  ["sunoco", "Sunoco"],
  ["speedway", "Speedway"],
  ["wawa", "Wawa"],
  ["sheetz", "Sheetz"],
  ["7eleven", "7-Eleven"],
  ["circlek", "Circle K"],
  ["costco", "Costco"],
  ["kroger", "Kroger"],
  ["publix", "Publix"],
  ["traderjoe", "Trader Joes"],
  ["wholefoods", "Whole Foods"],
  ["aldi", "Aldi"],
  ["safeway", "Safeway"],
  ["albertsons", "Albertsons"],
  ["bestbuy", "Best Buy"],
  ["walgreens", "Walgreens"],
  ["cvs", "CVS"],
  ["riteaid", "Rite Aid"],
  ["homedepot", "Home Depot"],
  ["lowes", "Lowes"],
  ["ikea", "IKEA"],
  ["wayfair", "Wayfair"],
  ["etsy", "Etsy"],
  ["ebay", "eBay"],
  ["dollartree", "Dollar Tree"],
  ["dollargeneral", "Dollar General"],
  ["familydollar", "Family Dollar"],
  ["tjmaxx", "TJ Maxx"],
  ["marshalls", "Marshalls"],
  ["nordstrom", "Nordstrom"],
  ["macys", "Macys"],
  ["kohls", "Kohls"],
  ["sephora", "Sephora"],
  ["ulta", "Ulta"],
  ["planetfitness", "Planet Fitness"],
  ["xfinity", "Xfinity"],
  ["comcast", "Comcast"],
  ["verizon", "Verizon"],
  ["tmobile", "T-Mobile"],
  ["attwireless", "AT&T"],
  ["airbnb", "Airbnb"],
  ["vrbo", "Vrbo"],
  ["expedia", "Expedia"],
  ["booking", "Booking.com"],
  ["delta", "Delta"],
  ["southwest", "Southwest"],
  ["jetblue", "JetBlue"],
  ["spiritair", "Spirit"],
  ["steam", "Steam"],
  ["playstation", "PlayStation"],
  ["xbox", "Xbox"],
  ["nintendo", "Nintendo"],
  ["dropbox", "Dropbox"],
  ["adobe", "Adobe"],
  ["perplexity", "Perplexity"],
  ["openai", "OpenAI"],
  ["chatgpt", "ChatGPT"],
  ["anthropic", "Anthropic"],
  ["claudeai", "Claude"],
  ["github", "GitHub"],
  ["notion", "Notion"],
  ["figma", "Figma"],
  ["twitch", "Twitch"],
  ["discord", "Discord"],
];

/**
 * Collapse noisy bank descriptions to short labels.
 * Examples:
 *   "AMZN MKTP US*1A2B3" → "Amazon"
 *   "STARBUCKS #12345 NY" → "Starbucks"
 *   "OnlyFans.com" / "OF*MEMBER" → "Subscription"
 *   "Transfer to Chime ABC123" → "Transfer"
 */
export function normalizeTxName(name: string | null | undefined): string {
  if (!name) return "";
  const s = String(name).trim();
  const nl = s.toLowerCase();
  const compact = nl.replace(/[^a-z0-9]/g, "");

  if (nl.includes("only") && nl.includes("fans")) return "Subscription";
  if (compact.includes("onlyfans")) return "Subscription";
  if (
    compact === "of" ||
    compact.includes("ofcom") ||
    /^of[\s.\*\-_]/.test(nl)
  )
    return "Subscription";
  if (/\btransfer\b/.test(nl)) return "Transfer";

  for (const [key, value] of MERCHANT_MAP) {
    if (compact.includes(key)) return value;
  }

  let clean = s;
  clean = clean.replace(
    /^(spo\s*\*|tst\s*\*|sq\s*\*|py\s*\*|pyp\s*\*|sp\s+|pos\s+(debit\s+)?|debit\s+card\s+|debit\s+|purchase\s+(authorized\s+(on\s+\S+\s+)?)?|visa\s+(checkcard\s+)?|mc\s+|chk\s+|ach\s+(debit|credit|hold)?\s*|external\s+|bill\s+pay\s+|recurring\s+|web\s+id:?\s*\S*\s*)/i,
    "",
  );
  clean = clean.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ");
  clean = clean.replace(/[\s\-_#\*]+\d{2,}[a-z0-9]{0,10}\s*$/i, "");
  clean = clean.replace(/\s+#\s*\d+\s*$/, "");
  clean = clean.replace(/\s+(llc|inc|corp|co|ltd|plc|llp)\.?\s*$/i, "");
  clean = clean.replace(/^[\s\*\-_#:]+/, "").trim();
  clean = clean.replace(/\s+[A-Z]{2}\s*$/, "").trim();
  clean = clean.replace(/\s+/g, " ").trim();
  if (!clean) return s;

  if (clean === clean.toUpperCase() || clean === clean.toLowerCase()) {
    clean = clean
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (clean.length > 22) clean = `${clean.slice(0, 22).trim()}…`;
  return clean;
}

/**
 * Returns true if a transaction should be auto-excluded based on legacy rules.
 * Checks merchant_name, raw_name, and category against the legacy lists.
 */
export function isLegacyExempt(input: {
  merchantName?: string | null;
  rawName?: string | null;
  category?: string | null;
}): boolean {
  const haystack = [
    (input.merchantName ?? "").toLowerCase(),
    (input.rawName ?? "").toLowerCase(),
  ].join(" ");
  if (LEGACY_EXEMPT_NAMES.some((needle) => haystack.includes(needle))) {
    return true;
  }
  const cat = (input.category ?? "").toLowerCase().trim();
  if (cat && LEGACY_EXEMPT_CATS.includes(cat)) {
    return true;
  }
  return false;
}

export type CashflowTone = "positive" | "amber" | "negative";

/**
 * Dashboard daily cashflow color tier:
 *   >= $200     -> green
 *   $75 .. $195 -> amber
 *   <  $75      -> red
 */
export function cashflowDailyColor(cents: number): string {
  return cashflowColorFromTone(cashflowDailyTone(cents));
}

export function cashflowDailyTone(cents: number): CashflowTone {
  if (cents >= 20000) return "positive";
  if (cents >= 7500) return "amber";
  return "negative";
}

/**
 * Legacy weekly cashflow color tier (history rows):
 *   < 0      → red
 *   < $900   → amber
 *   else     → green
 */
export function cashflowWeeklyColor(cents: number): string {
  return cashflowColorFromTone(cashflowWeeklyTone(cents));
}

export function cashflowWeeklyTone(cents: number): CashflowTone {
  if (cents < 0) return "negative";
  if (cents < 90000) return "amber";
  return "positive";
}

export function cashflowColorFromTone(tone: CashflowTone): string {
  // NOTE on class choice:
  //   `text-amber-500` is intentional. `globals.css` overrides
  //   `.text-amber-600` to `var(--shift-orange) = #c2410c`, which renders as
  //   a dark brown-orange and reads as red. `text-amber-500` is NOT in the
  //   override list, so it renders as the actual Tailwind amber (#f59e0b)
  //   — clearly amber/yellow-orange. If you ever change this token, audit
  //   `globals.css` to make sure the new class isn't overridden too.
  if (tone === "positive") return "text-green-600";
  if (tone === "amber") return "text-amber-500";
  return "text-red-600";
}

/** Round cents to nearest whole dollar (legacy display style). */
export function roundCentsToWholeDollar(cents: number): number {
  return Math.round(cents / 100) * 100;
}
