"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { waitUntil } from "@vercel/functions";

import { requireUser } from "@/lib/auth";
import { estimateFood, type FoodEstimate } from "@/lib/cal/estimate";
import { getShiftlyCalData } from "@/lib/cal/data";
import type { FoodCategory, FoodVerdict } from "@/lib/cal/types";
import { scoreEntry, type VerdictInput } from "@/lib/cal/verdict";
import { addDaysIso, getTodayIso } from "@/lib/dashboard/dates";
import { createAdminClient } from "@/lib/supabase/admin";

type NullableMacroInput = number | string | null | undefined;
const FOOD_CATEGORIES = new Set<FoodCategory>([
  "meal",
  "healthy_snack",
  "unhealthy_snack",
  "drink",
  "other",
]);
const FOOD_VERDICTS = new Set<FoodVerdict>(["good", "fine", "bad"]);
const JON_FALLBACK_WEIGHT_LBS = 201.9;
const VERDICT_SCORING_TIMEOUT_MS = 45_000;

type VerdictEntryRow = {
  id: string;
  user_id: string;
  date: string;
  meal_name: string;
  category: string | null;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sodium_mg: number | null;
  added_sugar_g: number | null;
  saturated_fat_g: number | null;
};

type VerdictSettingsRow = {
  age: number | null;
  sex: string | null;
  height_cm: number | string | null;
  activity_level: string | null;
  current_phase: string | null;
  goals_text: string | null;
  health_flags: string[] | null;
  tdee_calories: number | null;
  protein_target_g: number | null;
  fiber_target_g: number | null;
  sodium_target_mg: number | null;
  added_sugar_target_g: number | null;
  saturated_fat_target_g: number | null;
};

type VerdictWeekEntryRow = {
  date: string;
  category: string | null;
  calories: number;
  protein_g: number | null;
  fiber_g: number | null;
  sodium_mg: number | null;
  added_sugar_g: number | null;
  saturated_fat_g: number | null;
};

export async function createFoodEntryAction(input: {
  date?: string;
  loggedTime?: string | null;
  mealName?: string | null;
  category?: FoodCategory | string | null;
  calories: number | string;
  proteinG?: NullableMacroInput;
  carbsG?: NullableMacroInput;
  fatG?: NullableMacroInput;
  fiberG?: NullableMacroInput;
  sodiumMg?: NullableMacroInput;
  addedSugarG?: NullableMacroInput;
  saturatedFatG?: NullableMacroInput;
  savedFoodId?: string | null;
}): Promise<{ ok: true; id: string }> {
  const { supabase, user } = await requireUser();
  const calories = requireNonNegativeInteger(input.calories, "Calories");
  const date = normalizeIsoDate(input.date);
  const mealName = input.mealName?.trim() ?? "";
  const category = parseCategory(input.category);

  const { data, error } = await supabase
    .from("food_entries")
    .insert({
      user_id: user.id,
      date,
      logged_time: normalizeTimeInput(input.loggedTime) ?? getCurrentLocalTimeHm(),
      meal_name: mealName,
      category,
      calories,
      protein_g: optionalNonNegativeInteger(input.proteinG, "Protein"),
      carbs_g: optionalNonNegativeInteger(input.carbsG, "Carbs"),
      fat_g: optionalNonNegativeInteger(input.fatG, "Fat"),
      fiber_g: optionalNonNegativeInteger(input.fiberG, "Fiber"),
      sodium_mg: optionalNonNegativeInteger(input.sodiumMg, "Sodium"),
      added_sugar_g: optionalNonNegativeInteger(input.addedSugarG, "Added sugar"),
      saturated_fat_g: optionalNonNegativeInteger(input.saturatedFatG, "Saturated fat"),
      saved_food_id: input.savedFoodId || null,
      verdict: null,
      verdict_source: "pending",
      verdict_reason: null,
      verdict_context: null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  scheduleScoreFoodEntry(data.id, user.id);
  return { ok: true, id: data.id };
}

export async function estimateFoodAction(input: {
  description: string;
}): Promise<FoodEstimate> {
  await requireUser();
  return estimateFood(input.description);
}

export async function generateMealOrderPromptAction(input?: {
  locationHint?: string;
}): Promise<{ ok: true; prompt: string }> {
  const data = await getShiftlyCalData();
  const today =
    data.currentWeek.days.find((day) => day.date === data.todayIso) ??
    data.currentWeek.days[0];
  const locationHint = input?.locationHint?.trim() || "[your zip code]";
  const hasHbp = data.targets.healthFlags.includes("high_blood_pressure");

  const lines = [
    "You are Perplexity Comet, an agentic browser. I'm ordering my final meal of the day on DoorDash. Browse DoorDash directly, find real options that fit my remaining macro budget, and report back.",
    "",
    "## My current state (today, after meals logged so far)",
    "",
    renderBudgetLine(
      "Calories",
      data.targets.tdeeCalories,
      today.totals.calories,
      "cal",
      "left",
    ),
    renderNeedLine(
      "Protein needed",
      data.targets.proteinTargetG,
      today.totals.proteinG,
      "g",
      "daily floor",
    ),
    renderNeedLine(
      "Fiber needed",
      data.targets.fiberTargetG,
      today.totals.fiberG,
      "g",
      "daily floor",
    ),
    renderBudgetLine(
      "Sodium HEADROOM",
      data.targets.sodiumTargetMg,
      today.totals.sodiumMg,
      "mg",
      hasHbp ? "left (DASH ceiling)" : "left",
      hasHbp
        ? "I have mild high blood pressure, so this is a hard cap"
        : undefined,
    ),
    renderSimpleBudgetLine(
      "Added sugar budget",
      data.targets.addedSugarTargetG,
      today.totals.addedSugarG,
      "g",
      "remaining",
    ),
    renderSimpleBudgetLine(
      "Saturated fat budget",
      data.targets.saturatedFatTargetG,
      today.totals.saturatedFatG,
      "g",
      "remaining",
    ),
    hasHbp &&
    data.targets.sodiumTargetMg !== null &&
    today.totals.sodiumMg >= data.targets.sodiumTargetMg
      ? "- **WARNING: I've already hit my sodium ceiling today.** Find the lowest-sodium option available and tell me to skip salt-heavy components."
      : null,
    "",
    "## Context",
    "",
    `- I'm ${data.targets.age ?? 28}, ${data.targets.sex ?? "male"}, 5'9", 202 lb, sedentary${hasHbp ? " with mild HBP" : ""}`,
    `- On a cut targeting ~1.2 lb/wk loss (TDEE target ${data.targets.tdeeCalories ?? 1650} cal/day)`,
    "- This is my final meal - eat for satiety + macro closure",
    hasHbp
      ? "- Avoid liquid sugars (juice, soda, sweetened coffee drinks) - they spike BP"
      : "- Avoid liquid sugars (juice, soda, sweetened coffee drinks)",
    "- Prefer whole-food meals with real protein and fiber over processed/refined",
    "",
    "## Your task",
    "",
    `1. Browse DoorDash near ${locationHint} and find 4 real meal options that best fit the gaps above. Use the actual DoorDash UI — don't make up restaurants or items.`,
    "",
    "   **DO NOT take shortcuts. Read this twice:**",
    "   - **You MUST evaluate at least 8-12 restaurants** before settling on the 4 you'll recommend. Don't grab the first restaurant that has the keyword. Browse a real list.",
    "   - **For each restaurant you seriously consider, scroll the FULL menu** — not just the featured items, not just page 1. The best macro fit is often a side dish, a build-your-own bowl, or a lesser-known menu item buried deep in the menu. Featured items are the most popular, not the most macro-aligned.",
    "   - **Reject your first instinct.** If your first impulse is a name you've heard of, that's the path of least friction. Override it. Hunt for the option that genuinely fits the macro gaps, not the option that's easy to find.",
    "   - When you finish browsing, name 2-3 restaurants you EVALUATED but rejected, with one-line reasons, so I know you actually searched. Put this list at the bottom under '**Considered but rejected**'.",
    "",
    "   **Mix requirement (this matters):**",
    "   - **Option 1 MUST be a major fast-casual chain** with published nutrition data — Cava, Chipotle, Sweetgreen, Wingstop, Chick-fil-A, Panera, Just Salad, Dig, etc. This is the 'safe predictable' option. Use the chain's official nutrition page for exact numbers.",
    "   - **Options 2, 3, 4 should be lesser-known local places / mom-and-pop spots / hidden gems** on DoorDash. Avoid the obvious chains for these three.",
    "",
    "   **Nutritional research for the hidden gems (critical):** lesser-known restaurants rarely publish macros. Use this method to estimate them:",
    "   - Look at the dish description on DoorDash. Identify the type of food and preparation method.",
    "   - Find a published-nutrition equivalent at a major chain or USDA reference (e.g., 'their grilled chicken bowl is similar to Wingstop's grilled chicken with rice — use those macros as the basis').",
    "   - Account for portion-size differences (mom-and-pops often serve 1.3-1.5x chain portions).",
    "   - Account for known-bad ingredients (heavy butter, sugary sauces, fried prep) — adjust estimates upward.",
    "   - In the option's portioning section, name the proxy you used: 'Estimated macros via Wingstop grilled chicken + rice as proxy; portion looks ~1.3x.'",
    "",
    "2. **Present each option as a simple list with macros in the x/total format my app uses.** x = my running daily total INCLUDING this meal; total = my target. Format exactly like this for each option:",
    "",
    "   ```",
    "   **Option 1: <restaurant> — <dish name>** (price, DoorDash link)",
    "   - Calories: <consumed_today + meal>/<tdee_target>",
    "   - Protein: <consumed + meal>/<target>g",
    "   - Fiber: <consumed + meal>/<target>g",
    "   - Sodium: <consumed + meal>/<target>mg",
    "   - Added sugar: <consumed + meal>/<target>g",
    "   - Saturated fat: <consumed + meal>/<target>g",
    "   - Portioning: <instruction if needed, else 'eat as-is'>",
    "   ```",
    "",
    "   Use the actual today-so-far numbers from my context above as the starting `consumed`. Add the meal's contribution to get the projected end-of-day total.",
    "",
    "3. **Portioning instructions are required**: if a meal exceeds one of my limits (e.g., projected sodium would land at 1900/1500 when I only have 400mg headroom, or projected calories would land at 2100/1650), DON'T rule it out — tell me exactly how to portion it so the projected totals stay within the targets. Examples:",
    '   - "Eat 60% of the bowl, save the rest for tomorrow\'s breakfast"',
    '   - "Skip the side of rice"',
    '   - "Get the half-portion / kid\'s size if available"',
    '   - "Eat the protein and veg, skip the bread/dressing/sauce"',
    "   When you give a portioning instruction, the macros in the list above should reflect the PORTIONED amount, not the full meal.",
    `4. Rank the 4 options by best-fit for my remaining macros${hasHbp ? " AND BP-friendliness" : ""}.`,
    "5. Note which one is your top pick and why in one sentence.",
    "",
    "Browse now and return the 4 options with their DoorDash links.",
  ];

  return { ok: true, prompt: lines.filter(Boolean).join("\n") };
}

export async function generateHomeRecipePromptAction(): Promise<{
  ok: true;
  prompt: string;
}> {
  const data = await getShiftlyCalData();
  const today =
    data.currentWeek.days.find((day) => day.date === data.todayIso) ??
    data.currentWeek.days[0];
  const hasHbp = data.targets.healthFlags.includes("high_blood_pressure");

  const lines = [
    "You are Perplexity Comet, an agentic browser. I'm cooking my final meal of the day at home. Browse real recipe sites (NYT Cooking, Serious Eats, Bon Appétit, Cooking Light, food blogs, etc.), find recipes that fit my remaining macro budget, and report back with PRECISE ingredient measurements.",
    "",
    "## My current state (today, after meals logged so far)",
    "",
    renderBudgetLine(
      "Calories",
      data.targets.tdeeCalories,
      today.totals.calories,
      "cal",
      "left",
    ),
    renderNeedLine(
      "Protein needed",
      data.targets.proteinTargetG,
      today.totals.proteinG,
      "g",
      "daily floor",
    ),
    renderNeedLine(
      "Fiber needed",
      data.targets.fiberTargetG,
      today.totals.fiberG,
      "g",
      "daily floor",
    ),
    renderBudgetLine(
      "Sodium HEADROOM",
      data.targets.sodiumTargetMg,
      today.totals.sodiumMg,
      "mg",
      hasHbp ? "left (DASH ceiling, hard cap)" : "left",
    ),
    renderSimpleBudgetLine(
      "Added sugar budget",
      data.targets.addedSugarTargetG,
      today.totals.addedSugarG,
      "g",
      "remaining",
    ),
    renderSimpleBudgetLine(
      "Saturated fat budget",
      data.targets.saturatedFatTargetG,
      today.totals.saturatedFatG,
      "g",
      "remaining",
    ),
    "",
    "## Context",
    "",
    `- I'm ${data.targets.age ?? 28}, ${data.targets.sex ?? "male"}, 5'9\", 202 lb, sedentary${hasHbp ? " with mild HBP" : ""}`,
    `- On a cut targeting ~1.2 lb/wk loss (TDEE target ${data.targets.tdeeCalories ?? 1650} cal/day)`,
    "- This is my final meal — cooking lets ME control sodium and added sugar, so I want recipes that LEAN INTO that advantage",
    "- Prefer recipes with whole-food protein (chicken, fish, lean beef, eggs, beans) + a fiber source (veg, legumes, whole grains)",
    "- Skip dessert / baked-good recipes for this round",
    "",
    "## Your task",
    "",
    "**STEP 0 — ASK BEFORE YOU SEARCH.** Recipes don't matter if I don't have the ingredients. Before recommending anything, ASK me these questions and WAIT for my answers:",
    "",
    "   a. What **proteins** do you have on hand right now? (chicken, fish, eggs, tofu, beans, etc.)",
    "   b. What **vegetables / sides** do you have? (any specific staples, fresh greens, frozen veg, rice, pasta, potatoes, etc.)",
    "   c. Anything you specifically want to use up tonight (something perishable, leftovers, etc.)?",
    "   d. **Honest gate:** is it worth me cooking right now, or am I tired? If tired, say so — I'll redirect you.",
    "",
    "**Don't proceed to step 1 until I've answered.** Just ask, wait, then proceed.",
    "",
    "**STEP 0.5 — HONEST DEAD-END.** Based on my answers from step 0, decide if a good recipe is actually achievable tonight:",
    "",
    "   - If I have a viable protein + at least one side that combine into something low-sodium and macro-aligned: proceed to step 1.",
    "   - If my ingredients are sparse, mismatched, or none fit the macro gaps: **DO NOT compromise on a sub-par recipe.** Tell me one of these instead:",
    "     - **\"Go to the store\"** — give me a 5-item shopping list (low-sodium chicken breast, fresh greens, etc.) that would unlock 2-3 good options",
    "     - **\"Order DoorDash instead\"** — explicitly tell me to use the Order final meal button (the green one) because cooking won't work tonight",
    "     - **\"Skip the meal\"** — if my calorie headroom is tiny (<300) and I've hit protein already, a glass of water and an early bed beat a forced meal",
    "",
    "   Pick the honest answer. Do not invent a recipe from ingredients I don't have just to fill the 4-option quota.",
    "",
    "**STEP 1 — IF AND ONLY IF step 0.5 says proceed**, find 4 recipes from real sources that fit BOTH my remaining macros AND the ingredients I actually have.",
    "",
    "   **DO NOT take shortcuts. Read this twice:**",
    "   - **Evaluate at least 8-12 candidate recipes** before settling on the 4 you'll recommend. The first 3 results in a search are almost always the most-published, not the most macro-aligned. Hunt deeper.",
    "   - **For each recipe you seriously consider, read the FULL ingredient list and method** — don't skim. Sodium and added sugar hide in obvious places (salt, soy sauce, brown sugar) AND non-obvious places (broth, miso, bottled sauces, marinades, dressings).",
    "   - **Reject your first instinct.** Famous chefs and well-trafficked sites are not automatically the best fit. Hunt for recipes that genuinely match the macro gaps, not the ones that are easy to find.",
    "   - When you finish browsing, name 2-3 recipes you EVALUATED but rejected, with one-line reasons (e.g., 'NYT Sticky Sesame Chicken — 1900mg sodium per serving even with halved sauce, too high'). Put this list at the bottom under '**Considered but rejected**'.",
    "",
    "   **Mix requirement:**",
    "   - **Recipe 1 MUST be from a mainstream high-quality source** (NYT Cooking, Serious Eats, Bon Appétit, America's Test Kitchen, Cooking Light, etc.) — predictable, well-tested.",
    "   - **Recipes 2, 3, 4 should be lesser-known food blogs or chef sites** — hidden gems. Skip the obvious mainstream sources for these.",
    "",
    "2. **CRITICAL — precise measurements.** Because I'm cooking, I control the salt and sugar exactly. For EACH recipe, give me:",
    "",
    "   ```",
    "   **Recipe N: <Recipe name>** by <author/site> ([link])",
    "   Prep: <min> | Cook: <min> | Serves: <N>",
    "",
    "   Ingredients (per single serving I'll eat):",
    "   - <amount> <ingredient> — <sodium_mg>mg sodium, <added_sugar_g>g added sugar, <protein_g>g protein, <fiber_g>g fiber, <calories>cal",
    "   - ...",
    "",
    "   Per-serving totals:",
    "   - Calories: <consumed_today + this serving>/<tdee_target>",
    "   - Protein: <consumed + this serving>/<protein_target>g",
    "   - Fiber: <consumed + this serving>/<fiber_target>g",
    "   - Sodium: <consumed + this serving>/<sodium_target>mg",
    "   - Added sugar: <consumed + this serving>/<sugar_target>g",
    "   - Saturated fat: <consumed + this serving>/<sat_fat_target>g",
    "",
    "   What you need to BUY vs PANTRY:",
    "   - Buy: <items not in a typical pantry>",
    "   - Pantry assumed: <items I likely already have (salt, olive oil, garlic, lemon, etc.)>",
    "",
    "   Modifications applied for my targets:",
    "   - <e.g. \"Halved the salt to 1/2 tsp (saves 1160mg sodium)\">",
    "   - <e.g. \"Skipped the brown sugar glaze (saves 12g added sugar)\">",
    "   - <e.g. \"Used boneless skinless thigh instead of skin-on (saves 4g saturated fat)\">",
    "   ```",
    "",
    "3. **Sodium and added sugar amounts must be exact, not rounded.** Use 1/8 tsp / 1/4 tsp / 1/2 tsp / 1 tsp granularity for salt. Use grams for added sugar. Convert teaspoons to mg using: 1 tsp table salt = ~2300mg sodium; 1/2 tsp = 1160mg; 1/4 tsp = 580mg; 1/8 tsp = 290mg. Cite your ingredient sodium values from USDA FoodData Central or the recipe author when possible.",
    "",
    "4. **If a recipe as published exceeds my sodium or sugar headroom, MODIFY THE RECIPE with exact reduction**. Don't just say 'use less salt' — say 'reduce salt from 1 tsp to 1/2 tsp.' Replace high-sodium ingredients with low-sodium alternatives where natural (e.g., low-sodium soy sauce + rice vinegar instead of regular soy sauce; fresh garlic + lemon instead of garlic salt). Account for the modifications in the per-serving totals.",
    "",
    `5. Rank the 4 recipes by best-fit for my remaining macros${hasHbp ? " AND BP-friendliness (low sodium, herbs/acid for flavor instead of salt)" : ""}.`,
    "6. Note which is your top pick and why in one sentence — especially if one stands out for flavor-per-sodium ratio.",
    "",
    "Browse now and return the 4 recipes with precise measurements and real source links.",
  ];

  return { ok: true, prompt: lines.filter(Boolean).join("\n") };
}

export async function deleteFoodEntryAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();

  const { error } = await supabase
    .from("food_entries")
    .delete()
    .eq("user_id", user.id)
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true };
}

export async function updateFoodEntryAction(input: {
  id: string;
  loggedTime?: string | null;
  mealName?: string | null;
  category?: FoodCategory | string | null;
  calories: number | string;
  proteinG?: NullableMacroInput;
  carbsG?: NullableMacroInput;
  fatG?: NullableMacroInput;
  fiberG?: NullableMacroInput;
  sodiumMg?: NullableMacroInput;
  addedSugarG?: NullableMacroInput;
  saturatedFatG?: NullableMacroInput;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const calories = requireNonNegativeInteger(input.calories, "Calories");

  const { data: current, error: currentError } = await supabase
    .from("food_entries")
    .select("verdict_source")
    .eq("user_id", user.id)
    .eq("id", input.id)
    .single();

  if (currentError) throw new Error(currentError.message);

  const { error } = await supabase
    .from("food_entries")
    .update({
      meal_name: input.mealName?.trim() ?? "",
      logged_time: normalizeTimeInput(input.loggedTime),
      category: parseCategory(input.category),
      calories,
      protein_g: optionalNonNegativeInteger(input.proteinG, "Protein"),
      carbs_g: optionalNonNegativeInteger(input.carbsG, "Carbs"),
      fat_g: optionalNonNegativeInteger(input.fatG, "Fat"),
      fiber_g: optionalNonNegativeInteger(input.fiberG, "Fiber"),
      sodium_mg: optionalNonNegativeInteger(input.sodiumMg, "Sodium"),
      added_sugar_g: optionalNonNegativeInteger(input.addedSugarG, "Added sugar"),
      saturated_fat_g: optionalNonNegativeInteger(input.saturatedFatG, "Saturated fat"),
      ...(current?.verdict_source === "manual_override"
        ? {}
        : {
            verdict: null,
            verdict_reason: null,
            verdict_source: "pending",
            verdict_context: null,
          }),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  if (current?.verdict_source !== "manual_override") {
    scheduleScoreFoodEntry(input.id, user.id);
  }
  return { ok: true };
}

export async function regenerateVerdictAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();

  const { error } = await supabase
    .from("food_entries")
    .update({
      verdict: null,
      verdict_reason: null,
      verdict_source: "pending",
      verdict_context: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  await scoreEntryAndUpdate(input.id, user.id);
  return { ok: true };
}

export async function overrideVerdictAction(input: {
  id: string;
  verdict: FoodVerdict | string;
  verdictReason?: string | null;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const verdict = parseVerdict(input.verdict);

  const { error } = await supabase
    .from("food_entries")
    .update({
      verdict,
      verdict_reason: input.verdictReason?.trim() || null,
      verdict_source: "manual_override",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true };
}

export async function createSavedFoodAction(input: {
  name: string;
  category?: FoodCategory | string | null;
  calories: number | string;
  proteinG?: NullableMacroInput;
  carbsG?: NullableMacroInput;
  fatG?: NullableMacroInput;
  fiberG?: NullableMacroInput;
  sodiumMg?: NullableMacroInput;
  addedSugarG?: NullableMacroInput;
  saturatedFatG?: NullableMacroInput;
}): Promise<{ ok: true; id: string }> {
  const { supabase, user } = await requireUser();
  const name = input.name.trim();
  if (!name) throw new Error("Saved food name is required.");

  const { data: maxRow, error: maxError } = await supabase
    .from("saved_foods")
    .select("sort_order")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) throw new Error(maxError.message);

  const { data, error } = await supabase
    .from("saved_foods")
    .insert({
      user_id: user.id,
      name,
      category: parseCategory(input.category),
      calories: requireNonNegativeInteger(input.calories, "Calories"),
      protein_g: optionalNonNegativeInteger(input.proteinG, "Protein"),
      carbs_g: optionalNonNegativeInteger(input.carbsG, "Carbs"),
      fat_g: optionalNonNegativeInteger(input.fatG, "Fat"),
      fiber_g: optionalNonNegativeInteger(input.fiberG, "Fiber"),
      sodium_mg: optionalNonNegativeInteger(input.sodiumMg, "Sodium"),
      added_sugar_g: optionalNonNegativeInteger(input.addedSugarG, "Added sugar"),
      saturated_fat_g: optionalNonNegativeInteger(input.saturatedFatG, "Saturated fat"),
      sort_order: Number(maxRow?.sort_order ?? -1) + 1,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true, id: data.id };
}

export async function archiveSavedFoodAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();

  const { error } = await supabase
    .from("saved_foods")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true };
}

export async function logWeightAction(input: {
  date?: string;
  weightLbs: number | string;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const weightLbs = Number(input.weightLbs);
  if (!Number.isFinite(weightLbs) || weightLbs <= 0) {
    throw new Error("Weight must be greater than zero.");
  }

  const { error } = await supabase.from("weight_logs").upsert(
    {
      user_id: user.id,
      date: normalizeIsoDate(input.date),
      weight_lbs: weightLbs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,date" },
  );

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true };
}

export async function logWaterAction(input: {
  date?: string;
  amountOz: number | string;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();
  const amountOz = requireNonNegativeInteger(input.amountOz, "Water");
  if (amountOz <= 0) throw new Error("Water must be greater than zero.");

  const { error } = await supabase.from("water_logs").insert({
    user_id: user.id,
    date: normalizeIsoDate(input.date),
    amount_oz: amountOz,
  });

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true };
}

export async function saveCalTargetsAction(input: {
  tdeeCalories?: NullableMacroInput;
  proteinTargetG?: NullableMacroInput;
  carbsTargetG?: NullableMacroInput;
  fatTargetG?: NullableMacroInput;
  fiberTargetG?: NullableMacroInput;
  sodiumTargetMg?: NullableMacroInput;
  addedSugarTargetG?: NullableMacroInput;
  saturatedFatTargetG?: NullableMacroInput;
  waterTargetOz?: NullableMacroInput;
}): Promise<{ ok: true }> {
  const { supabase, user } = await requireUser();

  const { error } = await supabase
    .from("settings")
    .update({
      tdee_calories: optionalPositiveInteger(input.tdeeCalories, "TDEE"),
      protein_target_g: optionalNonNegativeInteger(input.proteinTargetG, "Protein target"),
      carbs_target_g: optionalNonNegativeInteger(input.carbsTargetG, "Carbs target"),
      fat_target_g: optionalNonNegativeInteger(input.fatTargetG, "Fat target"),
      fiber_target_g: optionalPositiveInteger(input.fiberTargetG, "Fiber target"),
      sodium_target_mg: optionalPositiveInteger(input.sodiumTargetMg, "Sodium target"),
      added_sugar_target_g: optionalPositiveInteger(input.addedSugarTargetG, "Added sugar target"),
      saturated_fat_target_g: optionalPositiveInteger(input.saturatedFatTargetG, "Saturated fat target"),
      water_target_oz: optionalPositiveInteger(input.waterTargetOz, "Water target"),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/cal");
  return { ok: true };
}

function renderBudgetLine(
  label: string,
  target: number | null,
  consumed: number,
  unit: string,
  leftLabel: string,
  extra?: string,
): string | null {
  if (target === null) return null;
  const remaining = Math.round(target - consumed);
  const remainingText =
    remaining < 0
      ? `over by ${Math.abs(remaining)}${unit}`
      : `${remaining}${unit} ${leftLabel}`;
  const suffix = extra ? ` - ${extra}` : "";
  return `- **${label}**: ${remainingText} (target ${Math.round(target)}, consumed ${Math.round(consumed)})${suffix}`;
}

function renderNeedLine(
  label: string,
  target: number | null,
  consumed: number,
  unit: string,
  targetLabel: string,
): string | null {
  if (target === null) return null;
  const need = Math.round(target - consumed);
  const needText =
    need < 0 ? `over by ${Math.abs(need)}${unit}` : `${need}${unit} more`;
  return `- **${label}**: ${needText} to hit my ${Math.round(target)}${unit} ${targetLabel} (currently at ${Math.round(consumed)}${unit})`;
}

function renderSimpleBudgetLine(
  label: string,
  target: number | null,
  consumed: number,
  unit: string,
  suffix: string,
): string | null {
  if (target === null) return null;
  const remaining = Math.round(target - consumed);
  const remainingText =
    remaining < 0 ? `over by ${Math.abs(remaining)}${unit}` : `${remaining}${unit} ${suffix}`;
  return `- **${label}**: ${remainingText}`;
}

function normalizeIsoDate(value: string | null | undefined): string {
  if (!value) {
    return getTodayIso();
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date must be an ISO date.");
  }

  return value;
}

function normalizeTimeInput(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error("Time must be HH:mm.");
  }

  const [hours, minutes] = value.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error("Time must be HH:mm.");
  }

  return value;
}

function getCurrentLocalTimeHm(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: process.env.SHIFTLYCASH_TIME_ZONE ?? "America/New_York",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

function requireNonNegativeInteger(value: number | string, label: string): number {
  const parsed = parseInteger(value);
  if (parsed === null || parsed < 0) {
    throw new Error(`${label} must be zero or greater.`);
  }
  return parsed;
}

function optionalPositiveInteger(value: NullableMacroInput, label: string): number | null {
  const parsed = parseInteger(value);
  if (parsed === null) return null;
  if (parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function optionalNonNegativeInteger(value: NullableMacroInput, label: string): number | null {
  const parsed = parseInteger(value);
  if (parsed === null) return null;
  if (parsed < 0) throw new Error(`${label} must be zero or greater.`);
  return parsed;
}

function parseCategory(value: FoodCategory | string | null | undefined): FoodCategory {
  if (value === null || value === undefined || value === "") return "meal";
  if (FOOD_CATEGORIES.has(value as FoodCategory)) return value as FoodCategory;
  throw new Error("Unknown food category.");
}

function parseVerdict(value: FoodVerdict | string): FoodVerdict {
  if (FOOD_VERDICTS.has(value as FoodVerdict)) return value as FoodVerdict;
  throw new Error("Unknown verdict.");
}

function parseInteger(value: NullableMacroInput): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error("Whole numbers only.");
  return parsed;
}

function scheduleScoreFoodEntry(entryId: string, userId: string) {
  console.info("[verdict] scoring scheduled", { entryId, userId, ts: Date.now() });
  if (typeof waitUntil === "function") {
    waitUntil(scoreEntryAndUpdate(entryId, userId));
    return;
  }

  after(async () => {
    await scoreEntryAndUpdate(entryId, userId);
  });
}

async function scoreEntryAndUpdate(entryId: string, userId: string) {
  const supabase = createAdminClient();
  const startedAt = Date.now();
  console.info("[verdict] scoring start", { entryId, userId, ts: startedAt });

  try {
    const input = await buildVerdictInput(supabase, entryId, userId);
    const result = await withTimeout(
      scoreEntry(input),
      VERDICT_SCORING_TIMEOUT_MS,
      "Verdict scorer timed out.",
    );

    const { error } = await supabase
      .from("food_entries")
      .update({
        verdict: result.verdict,
        verdict_reason: result.verdict_reason,
        verdict_source: "ai",
        verdict_error: null,
        verdict_context: result.verdict_context,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("id", entryId);

    if (error) throw new Error(error.message);
    console.info("[verdict] scoring success", { entryId, userId, ts: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown verdict scoring error.";
    console.info("[verdict] scoring failure", {
      entryId,
      userId,
      ts: Date.now(),
      error: message,
    });
    await supabase
      .from("food_entries")
      .update({
        verdict: null,
        verdict_reason: null,
        verdict_source: "unscored",
        verdict_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("id", entryId);
  } finally {
    console.info("[verdict] scoring duration ms", {
      entryId,
      userId,
      durationMs: Date.now() - startedAt,
    });
  }

  revalidatePath("/cal");
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function buildVerdictInput(
  supabase: ReturnType<typeof createAdminClient>,
  entryId: string,
  userId: string,
): Promise<VerdictInput> {
  const { data: entry, error: entryError } = await supabase
    .from("food_entries")
    .select("id,user_id,date,meal_name,category,calories,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,added_sugar_g,saturated_fat_g")
    .eq("user_id", userId)
    .eq("id", entryId)
    .single();

  if (entryError || !entry) {
    throw new Error(entryError?.message ?? "Food entry not found.");
  }

  const row = entry as VerdictEntryRow;
  const weekStartIso = getSundayOnOrBeforeIso(row.date);
  const weekEndIso = addDaysIso(weekStartIso, 6);

  const [settingsRes, weekEntriesRes, weightRes] = await Promise.all([
    supabase
      .from("settings")
      .select(
        "age,sex,height_cm,activity_level,current_phase,goals_text,health_flags,tdee_calories,protein_target_g,fiber_target_g,sodium_target_mg,added_sugar_target_g,saturated_fat_target_g",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("food_entries")
      .select("date,category,calories,protein_g,fiber_g,sodium_mg,added_sugar_g,saturated_fat_g")
      .eq("user_id", userId)
      .gte("date", weekStartIso)
      .lte("date", weekEndIso),
    supabase
      .from("weight_logs")
      .select("weight_lbs")
      .eq("user_id", userId)
      .lte("date", row.date)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (settingsRes.error) throw new Error(settingsRes.error.message);
  if (weekEntriesRes.error) throw new Error(weekEntriesRes.error.message);
  if (weightRes.error) throw new Error(weightRes.error.message);

  const settings = (settingsRes.data ?? {}) as Partial<VerdictSettingsRow>;
  const weekRows = (weekEntriesRes.data ?? []) as VerdictWeekEntryRow[];
  const tdee = Number(settings.tdee_calories ?? 1650);
  const proteinTarget = Number(settings.protein_target_g ?? 180);
  const fiberTarget = Number(settings.fiber_target_g ?? 30);
  const todayRows = weekRows.filter((item) => item.date === row.date);
  const dayTotals = totalRows(todayRows);
  const weekTotals = totalRows(weekRows);
  const dayTotalsByDate = new Map<string, number>();
  const countsByCategory = emptyCategoryCounts();

  for (const item of weekRows) {
    dayTotalsByDate.set(
      item.date,
      (dayTotalsByDate.get(item.date) ?? 0) + Number(item.calories),
    );
    const category = parseCategory(item.category);
    countsByCategory[category] += 1;
  }

  const dayCalories = [...dayTotalsByDate.values()];

  return {
    entry: {
      mealName: row.meal_name,
      category: parseCategory(row.category),
      calories: Number(row.calories),
      proteinG: row.protein_g === null ? null : Number(row.protein_g),
      carbsG: row.carbs_g === null ? null : Number(row.carbs_g),
      fatG: row.fat_g === null ? null : Number(row.fat_g),
      fiberG: row.fiber_g === null ? null : Number(row.fiber_g),
      sodiumMg: row.sodium_mg === null ? null : Number(row.sodium_mg),
      addedSugarG: row.added_sugar_g === null ? null : Number(row.added_sugar_g),
      saturatedFatG: row.saturated_fat_g === null ? null : Number(row.saturated_fat_g),
    },
    profile: {
      age: Number(settings.age ?? 28),
      sex: settings.sex === "female" ? "female" : "male",
      height_cm: Number(settings.height_cm ?? 175),
      weight_lbs: Number(
        (weightRes.data as { weight_lbs?: number | string } | null)?.weight_lbs ??
          JON_FALLBACK_WEIGHT_LBS,
      ),
      activity_level: settings.activity_level ?? "sedentary",
      current_phase: parsePhase(settings.current_phase),
      goals_text:
        settings.goals_text ??
        "Aggressive but healthy fat loss; protein-prioritized, sustainable energy.",
      health_flags: Array.isArray(settings.health_flags) ? settings.health_flags : [],
    },
    targets: {
      tdee_cal: tdee,
      protein_g: proteinTarget,
      fiber_g: fiberTarget,
      sodium_mg: Number(settings.sodium_target_mg ?? 2300),
      added_sugar_g: Number(settings.added_sugar_target_g ?? 36),
      saturated_fat_g: Number(settings.saturated_fat_target_g ?? 20),
    },
    today_so_far: {
      cal: dayTotals.calories,
      protein_g: dayTotals.proteinG,
      fiber_g: dayTotals.fiberG,
      sodium_mg: dayTotals.sodiumMg,
      added_sugar_g: dayTotals.addedSugarG,
      saturated_fat_g: dayTotals.saturatedFatG,
      entry_count: todayRows.length,
    },
    week_so_far: {
      cal: weekTotals.calories,
      protein_g: weekTotals.proteinG,
      fiber_g: weekTotals.fiberG,
      sodium_mg: weekTotals.sodiumMg,
      added_sugar_g: weekTotals.addedSugarG,
      saturated_fat_g: weekTotals.saturatedFatG,
      entry_count: weekRows.length,
      days_logged: dayCalories.length,
      counts_by_category: countsByCategory,
      indulgence_days: dayCalories.filter((calories) => calories > tdee * 1.15).length,
      clean_days: dayCalories.filter((calories) => calories <= tdee).length,
    },
  };
}

function totalRows(rows: VerdictWeekEntryRow[]) {
  return rows.reduce(
    (total, row) => ({
      calories: total.calories + Number(row.calories),
      proteinG: total.proteinG + Number(row.protein_g ?? 0),
      fiberG: total.fiberG + Number(row.fiber_g ?? 0),
      sodiumMg: total.sodiumMg + Number(row.sodium_mg ?? 0),
      addedSugarG: total.addedSugarG + Number(row.added_sugar_g ?? 0),
      saturatedFatG: total.saturatedFatG + Number(row.saturated_fat_g ?? 0),
    }),
    { calories: 0, proteinG: 0, fiberG: 0, sodiumMg: 0, addedSugarG: 0, saturatedFatG: 0 },
  );
}

function emptyCategoryCounts(): Record<FoodCategory, number> {
  return {
    meal: 0,
    healthy_snack: 0,
    unhealthy_snack: 0,
    drink: 0,
    other: 0,
  };
}

function parsePhase(value: string | null | undefined): VerdictInput["profile"]["current_phase"] {
  if (value === "maintain" || value === "bulk" || value === "recomp") return value;
  return "cut";
}

function getSundayOnOrBeforeIso(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}
