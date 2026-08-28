// One-shot: back-apply legacy normalizeTxName to existing transactions.
// Run from shiftlycash/: node scripts/normalize-existing-transactions.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://jrjcajeaduofkhaquzuk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  throw new Error(
    "Missing SUPABASE_SERVICE_ROLE_KEY. Set it in the local environment before running this one-shot script.",
  );
}

const MERCHANT_MAP = [
  ["amazon","Amazon"],["amzn","Amazon"],["walmart","Walmart"],["walmrt","Walmart"],
  ["wmsupercenter","Walmart"],["target","Target"],["starbucks","Starbucks"],["sbux","Starbucks"],
  ["mcdonald","McDonalds"],["dunkin","Dunkin"],["chickfil","Chick-fil-A"],["chipotle","Chipotle"],
  ["subway","Subway"],["tacobell","Taco Bell"],["wendys","Wendys"],["kfc","KFC"],
  ["popeyes","Popeyes"],["panera","Panera"],["domino","Dominos"],["pizzahut","Pizza Hut"],
  ["papajohn","Papa Johns"],["ubereats","Uber Eats"],["uber","Uber"],["lyft","Lyft"],
  ["doordash","DoorDash"],["grubhub","Grubhub"],["postmates","Postmates"],["instacart","Instacart"],
  ["shipt","Shipt"],["spotify","Spotify"],["netflix","Netflix"],["hulu","Hulu"],
  ["disney","Disney+"],["youtube","YouTube"],["hbomax","HBO Max"],["itunes","Apple"],
  ["applecom","Apple"],["appleitunes","Apple"],["apple","Apple"],["google","Google"],
  ["microsoft","Microsoft"],["paypal","PayPal"],["pypl","PayPal"],["venmo","Venmo"],
  ["cashapp","Cash App"],["zelle","Zelle"],["shell","Shell"],["exxon","Exxon"],
  ["chevron","Chevron"],["mobil","Mobil"],["sunoco","Sunoco"],["speedway","Speedway"],
  ["wawa","Wawa"],["sheetz","Sheetz"],["7eleven","7-Eleven"],["circlek","Circle K"],
  ["costco","Costco"],["kroger","Kroger"],["publix","Publix"],["traderjoe","Trader Joes"],
  ["wholefoods","Whole Foods"],["aldi","Aldi"],["safeway","Safeway"],["albertsons","Albertsons"],
  ["bestbuy","Best Buy"],["walgreens","Walgreens"],["cvs","CVS"],["riteaid","Rite Aid"],
  ["homedepot","Home Depot"],["lowes","Lowes"],["ikea","IKEA"],["wayfair","Wayfair"],
  ["etsy","Etsy"],["ebay","eBay"],["dollartree","Dollar Tree"],["dollargeneral","Dollar General"],
  ["familydollar","Family Dollar"],["tjmaxx","TJ Maxx"],["marshalls","Marshalls"],["nordstrom","Nordstrom"],
  ["macys","Macys"],["kohls","Kohls"],["sephora","Sephora"],["ulta","Ulta"],
  ["planetfitness","Planet Fitness"],["xfinity","Xfinity"],["comcast","Comcast"],["verizon","Verizon"],
  ["tmobile","T-Mobile"],["attwireless","AT&T"],["airbnb","Airbnb"],["vrbo","Vrbo"],
  ["expedia","Expedia"],["booking","Booking.com"],["delta","Delta"],["southwest","Southwest"],
  ["jetblue","JetBlue"],["spiritair","Spirit"],["steam","Steam"],["playstation","PlayStation"],
  ["xbox","Xbox"],["nintendo","Nintendo"],["dropbox","Dropbox"],["adobe","Adobe"],
  ["openai","OpenAI"],["chatgpt","ChatGPT"],["anthropic","Anthropic"],["claudeai","Claude"],
  ["github","GitHub"],["notion","Notion"],["figma","Figma"],["twitch","Twitch"],["discord","Discord"],
];

function normalizeTxName(name) {
  if (!name) return "";
  const s = String(name).trim();
  const nl = s.toLowerCase();
  const compact = nl.replace(/[^a-z0-9]/g, "");

  if (nl.includes("only") && nl.includes("fans")) return "Subscription";
  if (compact.includes("onlyfans")) return "Subscription";
  if (compact === "of" || compact.includes("ofcom") || /^of[\s.\*\-_]/.test(nl)) return "Subscription";
  if (/\btransfer\b/.test(nl)) return "Transfer";

  for (const [key, value] of MERCHANT_MAP) {
    if (compact.includes(key)) return value;
  }

  let clean = s;
  clean = clean.replace(/^(tst\s*\*|sq\s*\*|py\s*\*|pyp\s*\*|sp\s+|pos\s+(debit\s+)?|debit\s+card\s+|debit\s+|purchase\s+(authorized\s+(on\s+\S+\s+)?)?|visa\s+(checkcard\s+)?|mc\s+|chk\s+|ach\s+(debit|credit|hold)?\s*|external\s+|bill\s+pay\s+|recurring\s+|web\s+id:?\s*\S*\s*)/i, "");
  clean = clean.replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ");
  clean = clean.replace(/[\s\-_#\*]+\d{2,}[a-z0-9]{0,10}\s*$/i, "");
  clean = clean.replace(/\s+#\s*\d+\s*$/, "");
  clean = clean.replace(/\s+(llc|inc|corp|co|ltd|plc|llp)\.?\s*$/i, "");
  clean = clean.replace(/^[\s\*\-_#:]+/, "").trim();
  clean = clean.replace(/\s+[A-Z]{2}\s*$/, "").trim();
  clean = clean.replace(/\s+/g, " ").trim();
  if (!clean) return s;
  if (clean === clean.toUpperCase() || clean === clean.toLowerCase()) {
    clean = clean.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (clean.length > 22) clean = `${clean.slice(0, 22).trim()}…`;
  return clean;
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: txs, error } = await supabase
  .from("transactions")
  .select("id, merchant_name, raw_name")
  .order("date");

if (error) {
  console.error("Failed to fetch:", error.message);
  process.exit(1);
}

console.log(`Fetched ${txs.length} transactions.`);
let updated = 0;
let unchanged = 0;
const samples = [];

for (const tx of txs) {
  const source = tx.raw_name || tx.merchant_name || "";
  const normalized = normalizeTxName(source);
  if (!normalized || normalized === tx.merchant_name) {
    unchanged++;
    continue;
  }
  const { error: upErr } = await supabase
    .from("transactions")
    .update({ merchant_name: normalized })
    .eq("id", tx.id);
  if (upErr) {
    console.error(`Failed update for ${tx.id}:`, upErr.message);
    continue;
  }
  if (samples.length < 10) {
    samples.push(`  "${tx.merchant_name}" → "${normalized}"`);
  }
  updated++;
}

console.log(`Updated ${updated}. Unchanged ${unchanged}.`);
console.log("Sample changes:");
samples.forEach((s) => console.log(s));
