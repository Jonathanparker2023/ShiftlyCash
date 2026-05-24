"use client";

import { useEffect, useState } from "react";

import { ActionButton } from "@/components/shell";
import type { CalTargets, CalTotals } from "@/lib/cal/types";

type PlanMyDayButtonProps = {
  bannedFoods: string[];
  targets: CalTargets;
  totals: CalTotals;
};

export function PlanMyDayButton({
  bannedFoods,
  targets,
  totals,
}: PlanMyDayButtonProps) {
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [fallbackPrompt, setFallbackPrompt] = useState("");

  useEffect(() => {
    if (confirmation !== "Prompt copied. Paste into Claude Code on your laptop.") {
      return;
    }

    const id = window.setTimeout(() => setConfirmation(null), 4000);
    return () => window.clearTimeout(id);
  }, [confirmation]);

  async function copyPrompt() {
    const prompt = buildNutritionistPrompt(targets, totals, bannedFoods);
    setConfirmation(null);
    setFallbackPrompt("");

    try {
      await navigator.clipboard.writeText(prompt);
      setConfirmation("Prompt copied. Paste into Claude Code on your laptop.");
    } catch {
      setFallbackPrompt(prompt);
      setConfirmation("Clipboard blocked. Use manual copy.");
    }
  }

  async function copyFallbackPrompt() {
    if (!fallbackPrompt) return;

    try {
      await navigator.clipboard.writeText(fallbackPrompt);
      setConfirmation("Prompt copied. Paste into Claude Code on your laptop.");
    } catch {
      setConfirmation("Copy still blocked. Select the prompt and copy it.");
    }
  }

  return (
    <section className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
      <ActionButton
        className="h-12 w-full text-base"
        onClick={copyPrompt}
        variant="primary"
      >
        Plan my day
      </ActionButton>
      {confirmation ? (
        <p className="mt-2 text-xs font-semibold text-[var(--text-secondary)]">
          {confirmation}
        </p>
      ) : null}
      {fallbackPrompt ? (
        <div className="mt-3 space-y-2">
          <ActionButton onClick={copyFallbackPrompt} variant="secondary">
            Copy prompt
          </ActionButton>
          <textarea
            className="h-72 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 font-mono text-xs leading-5 text-[var(--text-primary)] outline-none transition focus:border-[var(--border-strong)] focus:ring-2 focus:ring-white/40"
            onChange={(event) => setFallbackPrompt(event.target.value)}
            value={fallbackPrompt}
          />
        </div>
      ) : null}
    </section>
  );
}

function buildNutritionistPrompt(
  targets: CalTargets,
  totals: CalTotals,
  bannedFoods: string[],
): string {
  const foodLines =
    bannedFoods.length > 0
      ? bannedFoods.map((food) => `- ${food}`).join("\n")
      : "- (none)";

  return `You are a registered nutritionist running a voice consult through Fred (text-to-speech). Be concise — long answers won't get spoken cleanly. No moralizing, no "you should" framing. Direct, useful, opinionated.

CONTEXT (Jon's remaining targets for today, computed in code):
- Calories: ${remaining(targets.tdeeCalories, totals.calories)} / ${targetValue(targets.tdeeCalories)} target
- Protein: ${remaining(targets.proteinTargetG, totals.proteinG)}g / ${targetValue(targets.proteinTargetG)}g target
- Carbs: ${remaining(targets.carbsTargetG, totals.carbsG)}g / ${targetValue(targets.carbsTargetG)}g target
- Fat: ${remaining(targets.fatTargetG, totals.fatG)}g / ${targetValue(targets.fatTargetG)}g target
- Fiber: ${remaining(targets.fiberTargetG, totals.fiberG)}g / ${targetValue(targets.fiberTargetG)}g target
- Sodium: ${remaining(targets.sodiumTargetMg, totals.sodiumMg)}mg / ${targetValue(targets.sodiumTargetMg)}mg ceiling
- Added sugar: ${remaining(targets.addedSugarTargetG, totals.addedSugarG)}g / ${targetValue(targets.addedSugarTargetG)}g ceiling
- Saturated fat: ${remaining(targets.saturatedFatTargetG, totals.saturatedFatG)}g / ${targetValue(targets.saturatedFatTargetG)}g ceiling

BANNED FOODS (do not recommend):
${foodLines}

YOUR JOB:
1. Ask leading questions to figure out what kind of day Jon's having (eating out vs in, time available, mood, location). Two questions max, then propose.
2. Propose a meal plan in this exact format:

WHAT TO EAT TODAY

<count> <food name with prep/qty>
<count> <food name with prep/qty>
... (3-6 items)

FINAL TOTALS
Calories: ~<X> / <target> <✅ if within 10%, ❌ otherwise>
Protein: ~<X>g / <target>g <✅/❌>
Carbs: ~<X>g / <target>g <✅/❌>
Fat: ~<X>g / <target>g <✅/❌>
Fiber: ~<X>g / <target>g <✅/❌>
Sodium: ~<X>mg / <target>mg <✅/❌>

3. Be accurate with macro estimates. If a food's macros are unclear, search the web for the brand/restaurant's published nutrition before guessing.
4. Use reasonable, satisfying fillers — not just protein powder + raw spinach. Real foods Jon would actually eat.
5. After presenting the plan, ask: "Want the breakdown, rotate the main, or rotate a filler?" — ONE question at a time, not all three.
6. If asked for breakdown, output a markdown table: | Item | Cal | Protein | Carbs | Fat | Fiber | Sodium | with a totals row at the bottom.
7. If asked to rotate, replace one item and re-output the updated plan + totals.

OUTPUT FORMAT RULES:
- Plain text. No markdown except the breakdown table.
- Short lines. One thought per line.
- No prose paragraphs.
- Don't repeat the targets in the body — Jon already sees them in the app.
- No "Let me know if..." closers. Just stop after the plan or the question.

Begin by asking your first question.`;
}

function remaining(target: number | null, total: number): number {
  if (target === null) return 0;
  return Math.round(target - total);
}

function targetValue(target: number | null): number {
  return target === null ? 0 : Math.round(target);
}
