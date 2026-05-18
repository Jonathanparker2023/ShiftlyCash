import type { MagnitudeTone } from "@/lib/cal/projection";
import type { FoodCategory, FoodEntry } from "@/lib/cal/types";

export type { FoodCategory };

export function magnitudeColorClass(tone: MagnitudeTone): string {
  switch (tone) {
    case "green":
      return "text-emerald-300";
    case "amber":
      return "text-amber-300";
    case "red":
      return "text-red-300";
    case "neutral":
      return "text-white/70";
  }
}

export function categoryBarClass(category: FoodCategory): string {
  const base = "rounded-md border p-3 text-sm shadow-[0_8px_18px_rgba(8,15,28,0.16)]";

  switch (category) {
    case "meal":
      return `${base} border-[#1e3a8a] bg-[#1d4ed8] text-white`;
    case "healthy_snack":
      return `${base} border-emerald-700 bg-emerald-600 text-white`;
    case "unhealthy_snack":
      return `${base} border-rose-700 bg-rose-600 text-white`;
    case "drink":
      return `${base} border-[#7e22ce] bg-[#9333ea] text-white`;
    case "other":
      return `${base} border-zinc-600 bg-zinc-700 text-white`;
  }
}

export function verdictBarClass(
  entry: Pick<FoodEntry, "verdict" | "verdictSource"> & {
    isProjectedPlan?: boolean;
  },
): string {
  const base = "rounded-md border p-3 text-sm shadow-[0_8px_18px_rgba(8,15,28,0.16)]";

  if (entry.isProjectedPlan === true) {
    return `${base} border-emerald-600/80 bg-emerald-700/80 text-white`;
  }

  if (entry.verdictSource === "pending") {
    return `${base} animate-pulse border-dashed border-zinc-500 bg-zinc-700 text-white`;
  }

  if (entry.verdictSource === "unscored" || entry.verdict === null) {
    return `${base} border-zinc-600 bg-zinc-700 text-white`;
  }

  switch (entry.verdict) {
    case "good":
      return `${base} border-emerald-700 bg-emerald-600 text-white`;
    case "fine":
      return `${base} border-amber-600 bg-amber-500 text-white`;
    case "bad":
      return `${base} border-rose-700 bg-rose-600 text-white`;
  }
}

export function categoryLabel(category: FoodCategory): string {
  switch (category) {
    case "meal":
      return "Meal";
    case "healthy_snack":
      return "Healthy snack";
    case "unhealthy_snack":
      return "Unhealthy snack";
    case "drink":
      return "Drink";
    case "other":
      return "Other";
  }
}
