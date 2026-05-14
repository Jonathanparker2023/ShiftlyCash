import type { MagnitudeTone } from "@/lib/cal/projection";

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
