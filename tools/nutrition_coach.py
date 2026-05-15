"""Generate a ShiftlyCal nutrition coaching brief from the local snapshot cache.

Reads:
  C:/Users/jay1p/Documents/Nutrition/.cache/nutrition-snapshot.json

Writes:
  C:/Users/jay1p/Documents/Nutrition/.cache/coaching-latest.md
  C:/Users/jay1p/Documents/Nutrition/.cache/coaching-history.md

Usage:
  python tools/nutrition_coach.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from anthropic import Anthropic

from shiftlycal_sync import CACHE_DIR, ENV_PATHS, SNAPSHOT_PATH, read_env_file

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

LATEST_PATH = CACHE_DIR / "coaching-latest.md"
HISTORY_PATH = CACHE_DIR / "coaching-history.md"
MAX_SNAPSHOT_AGE_SECONDS = 24 * 60 * 60
DEFAULT_MODEL = "claude-sonnet-4-5"

COACH_SYSTEM_PROMPT = """You are Jon's personal nutrition coach. You're reviewing his ShiftlyCal data and writing a short coaching brief in markdown.

## What you know about Jon

- Age 28, male, 5'9", 202 lb, sedentary + cardio 1x/week
- Current phase: cut. Daily calorie target: 1650 (deficit from ~2250 maintenance for ~1.2 lb/wk loss)
- Protein target: 180g/day. Fiber target: 30g/day
- Goal: aggressive but healthy fat loss to support property/investing trajectory
- No health flags

## What you receive

A JSON snapshot with: targets, today, current_week (with verdict_summary), rolling_7d, rolling_28d, saved_foods, trend_days_28. Read the verdict_summary blocks especially — they tell you the good/fine/bad mix.

## Your output

A markdown brief, max 400 words. Structure:

### What this week looks like
2-3 sentences. Calorie compliance vs target. Protein/fiber hit rates. Weight trend if visible. Verdict mix.

### What's working
1-2 specific observations of clean patterns. Cite specific numbers.

### What's slipping
1-2 specific concerns. Cite specific patterns or days. If verdict mix is bad-heavy or unscored-heavy, name it.

### One specific move for the next 3 days
A concrete, actionable instruction. Not a generic "eat cleaner" — something like "swap your usual afternoon coffee for water or unsweetened tea — you've had 4 sugary drinks this week" or "add 1 fist of vegetables to dinner — fiber's been at 18g instead of 30g."

### Bottom line
One sentence. Direction, not platitude.

## Tone rules

- Speak directly. "You" not "the user". Plain language. Short sentences.
- BANNED VOCABULARY (do not use these words ever): "cheat", "guilt", "deserve", "earn", "earned", "junk", "sinful", "cleanse", "detox", "bad choice", "naughty", "wasted", "ruined", "obese", "fat" (as a body description).
- Observational frames only: "calories above target", "low fiber pattern", "consistent protein", "3 unscored entries — review them when you can".
- No moralizing. No "you should". Use "the data suggests" or "the move is" or "try X for 3 days."
- If the week is genuinely good, say so plainly. Don't manufacture concern.
- Don't repeat numbers Jon can see in the snapshot. Synthesize, don't recite.

## If data is sparse

If `current_week.days_logged < 3`, just say: "Not enough data yet — log a few more days and I'll give you a real read." Don't fabricate insight from one or two meals.

Output: pure markdown, no preamble, no "Sure, here's your brief" — just the brief.
"""


def load_coach_config() -> tuple[str, str]:
    env_values: dict[str, str] = {}
    for path in ENV_PATHS:
        env_values.update(read_env_file(path))

    api_key = os.environ.get("ANTHROPIC_API_KEY") or env_values.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY not found in process env, Documents/Nutrition/.env, "
            "or Documents/Investing/.env."
        )

    model = (
        os.environ.get("NUTRITION_COACH_MODEL")
        or env_values.get("NUTRITION_COACH_MODEL")
        or DEFAULT_MODEL
    )
    return api_key, model


def snapshot_is_fresh(path: Path) -> bool:
    if not path.exists():
        return False
    age = datetime.now(timezone.utc).timestamp() - path.stat().st_mtime
    return age <= MAX_SNAPSHOT_AGE_SECONDS


def load_snapshot() -> dict:
    return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))


def write_brief(markdown: str) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    text = markdown.strip() or "Coach unavailable — try again later."
    LATEST_PATH.write_text(text + "\n", encoding="utf-8")
    date_header = datetime.now().date().isoformat()
    with HISTORY_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"\n\n## {date_header}\n\n{text}\n")


def first_h2(markdown: str) -> str:
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("## ") and not stripped.startswith("### "):
            return stripped.lstrip("#").strip()
        if stripped.startswith("### "):
            return stripped.lstrip("#").strip()
    return "Brief generated"


def word_count(markdown: str) -> int:
    return len([part for part in markdown.split() if part.strip()])


def generate_brief(snapshot: dict, api_key: str, model: str) -> str:
    client = Anthropic(api_key=api_key)
    message = client.messages.create(
        model=model,
        max_tokens=1500,
        temperature=0.3,
        system=COACH_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": json.dumps(snapshot, indent=2, sort_keys=True),
            }
        ],
    )
    text = message.content[0].text.strip()
    if not text:
        raise RuntimeError("Coach returned empty content.")
    return text


def main() -> int:
    if not snapshot_is_fresh(SNAPSHOT_PATH):
        return 0

    try:
        snapshot = load_snapshot()
    except Exception as exc:
        write_brief("Coach unavailable — try again later.")
        print(f"ERROR: unable to parse nutrition snapshot: {exc}", file=sys.stderr)
        return 1

    try:
        api_key, model = load_coach_config()
    except Exception as exc:
        write_brief("Coach unavailable — try again later.")
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    try:
        brief = generate_brief(snapshot, api_key, model)
    except Exception as exc:
        brief = "Coach unavailable — try again later."
        print(f"WARNING: coach API unavailable: {exc}", file=sys.stderr)

    write_brief(brief)
    print(f"Coaching brief written: {word_count(brief)} words. Top insight: {first_h2(brief)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
