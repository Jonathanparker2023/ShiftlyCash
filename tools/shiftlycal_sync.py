"""Sync ShiftlyCal nutrition fields to a local snapshot.

Reads SHIFTLYCASH_LEDGER_TOKEN from one of:
  1. Documents/Nutrition/.env file
  2. Documents/Investing/.env file
  3. Process environment variable

Fetches https://shiftlycash.vercel.app/api/export/nutrition-fields by default.
Writes JSON and a readable summary to Documents/Nutrition/.cache.

Usage:
  python tools/shiftlycal_sync.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HOME = Path.home()
NUTRITION_ROOT = HOME / "Documents" / "Nutrition"
INVESTING_ROOT = HOME / "Documents" / "Investing"
CACHE_DIR = NUTRITION_ROOT / ".cache"
SNAPSHOT_PATH = CACHE_DIR / "nutrition-snapshot.json"
SUMMARY_PATH = CACHE_DIR / "nutrition-snapshot.txt"
ENV_PATHS = [NUTRITION_ROOT / ".env", INVESTING_ROOT / ".env"]
DEFAULT_API_BASE = "https://shiftlycash.vercel.app"


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_config() -> tuple[str, str]:
    env_values: dict[str, str] = {}
    for path in ENV_PATHS:
        env_values.update(read_env_file(path))

    token = (
        os.environ.get("SHIFTLYCASH_LEDGER_TOKEN")
        or env_values.get("SHIFTLYCASH_LEDGER_TOKEN")
    )
    if not token:
        raise SystemExit(
            "ERROR: SHIFTLYCASH_LEDGER_TOKEN not found.\n"
            f"  Put it in {NUTRITION_ROOT / '.env'} or {INVESTING_ROOT / '.env'}.\n"
            "  Or export it as an environment variable."
        )

    api_base = (
        os.environ.get("SHIFTLYCASH_API_BASE")
        or env_values.get("SHIFTLYCASH_API_BASE")
        or DEFAULT_API_BASE
    ).rstrip("/")
    return token, api_base


def fetch_snapshot(token: str, api_base: str) -> dict:
    endpoint = f"{api_base}/api/export/nutrition-fields"
    req = urllib.request.Request(
        endpoint,
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = resp.read().decode("utf-8")
            return json.loads(payload)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code} from endpoint: {body}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"Network error: {exc.reason}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"JSON parse error: {exc}")


def write_outputs(data: dict, summary: str) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(
        json.dumps(data, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    SUMMARY_PATH.write_text(summary, encoding="utf-8")


def fmt(value, suffix: str = "") -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        text = f"{value:,.1f}" if value % 1 else f"{value:,.0f}"
    else:
        text = f"{value:,}" if isinstance(value, int) else str(value)
    return f"{text}{suffix}"


def pct(value) -> str:
    return "—" if value is None else f"{value}%"


def summarize(data: dict) -> str:
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    targets = data.get("targets") or {}
    today = data.get("today") or {}
    current_week = data.get("current_week") or {}
    rolling_7d = data.get("rolling_7d") or {}
    rolling_28d = data.get("rolling_28d") or {}
    saved_foods = data.get("saved_foods") or []
    today_totals = today.get("totals") or {}
    today_deviation = today.get("deviation") or {}
    week_totals = current_week.get("totals") or {}
    week_avg = current_week.get("avg_daily_logged") or {}

    lines: list[str] = []
    lines.append("")
    lines.append("=" * 64)
    lines.append("  ShiftlyCal Nutrition Snapshot")
    lines.append(f"  Endpoint as_of: {data.get('as_of', '?')}")
    lines.append(f"  Week of:        {data.get('week_of', '?')}")
    lines.append(f"  Today:          {data.get('today_iso', '?')}")
    lines.append(f"  Fetched at:     {fetched_at}")
    lines.append("=" * 64)

    lines.append("\nTARGETS")
    lines.append(f"  TDEE:     {fmt(targets.get('tdee_cal'), ' cal')}")
    lines.append(f"  Protein:  {fmt(targets.get('protein_g'), 'g')}")
    lines.append(f"  Carbs:    {fmt(targets.get('carbs_g'), 'g')}")
    lines.append(f"  Fat:      {fmt(targets.get('fat_g'), 'g')}")
    lines.append(f"  Fiber:    {fmt(targets.get('fiber_g'), 'g')}")

    lines.append(f"\nTODAY — {today.get('date', '?')}")
    lines.append(
        "  Calories: "
        f"{fmt(today_totals.get('cal'), ' cal')} "
        f"(target {fmt(targets.get('tdee_cal'), ' cal')}, "
        f"deviation {fmt(today_deviation.get('cal'), ' cal')}, "
        f"remaining {fmt(today.get('remaining_cal'), ' cal')})"
    )
    lines.append(
        "  Macros:   "
        f"{fmt(today_totals.get('protein_g'), 'g')} protein / "
        f"{fmt(today_totals.get('carbs_g'), 'g')} carbs / "
        f"{fmt(today_totals.get('fat_g'), 'g')} fat / "
        f"{fmt(today_totals.get('fiber_g'), 'g')} fiber"
    )
    lines.append(
        f"  Entries:  {fmt(today.get('entry_count'))} "
        f"• Weight: {fmt(today.get('weight_lbs'), ' lbs')}"
    )
    for entry in (today.get("entries") or [])[:5]:
        lines.append(
            "    • "
            f"{entry.get('logged_time') or '--:--'} "
            f"{entry.get('name') or entry.get('category') or 'Food'} — "
            f"{fmt(entry.get('calories'), ' cal')}, "
            f"{fmt(entry.get('protein_g'), 'g')}p, "
            f"{fmt(entry.get('fiber_g'), 'g')}fi"
        )

    lines.append(
        f"\nCURRENT WEEK — {current_week.get('start', '?')} to {current_week.get('end', '?')}"
    )
    lines.append(
        "  Totals:   "
        f"{fmt(week_totals.get('cal'), ' cal')} / "
        f"{fmt(week_totals.get('protein_g'), 'g')} protein / "
        f"{fmt(week_totals.get('fiber_g'), 'g')} fiber"
    )
    lines.append(
        "  Avg/day:  "
        f"{fmt(week_avg.get('cal'), ' cal')} / "
        f"{fmt(week_avg.get('protein_g'), 'g')} protein / "
        f"{fmt(week_avg.get('fiber_g'), 'g')} fiber"
    )
    lines.append(
        f"  Deficit:  {fmt(current_week.get('deficit_cal'), ' cal')} "
        f"• Projected weight change: "
        f"{fmt(current_week.get('projected_weight_change_lbs'), ' lbs')}"
    )
    lines.append("  Days:")
    for day in current_week.get("days") or []:
        totals = day.get("totals") or {}
        lines.append(
            "    • "
            f"{day.get('date', '?')}: "
            f"{fmt(totals.get('cal'), ' cal')}, "
            f"{fmt(totals.get('protein_g'), 'g')}p, "
            f"{fmt(totals.get('fiber_g'), 'g')}fi, "
            f"{fmt(day.get('entry_count'))} entries, "
            f"weight {fmt(day.get('weight_lbs'), ' lbs')}"
        )

    lines.append("\nROLLING 7d")
    lines.append(
        f"  Avg cal: {fmt(rolling_7d.get('avg_cal'), ' cal')} "
        f"• Under/over TDEE: {fmt(rolling_7d.get('days_under_tdee'))}/"
        f"{fmt(rolling_7d.get('days_over_tdee'))} "
        f"• Logged days: {fmt(rolling_7d.get('days_logged'))}"
    )
    lines.append(
        f"  Weight trend: {fmt(rolling_7d.get('weight_trend_lbs'), ' lbs')}"
    )

    lines.append("\nROLLING 28d")
    lines.append(
        f"  Avg cal: {fmt(rolling_28d.get('avg_cal'), ' cal')} "
        f"• Compliance: {pct(rolling_28d.get('compliance_pct'))} "
        f"• Logged days: {fmt(rolling_28d.get('days_logged'))}"
    )
    lines.append(
        f"  Weight change: {fmt(rolling_28d.get('weight_change_lbs'), ' lbs')}"
    )

    lines.append(f"\nSAVED FOODS — {len(saved_foods)} active")
    for food in saved_foods[:5]:
        lines.append(
            "  • "
            f"{food.get('name', '?')} ({food.get('category', '?')}) — "
            f"{fmt(food.get('calories'), ' cal')}, "
            f"{fmt(food.get('protein_g'), 'g')}p, "
            f"{fmt(food.get('fiber_g'), 'g')}fi"
        )

    lines.append("")
    lines.append(f"Snapshot saved to: {SNAPSHOT_PATH}")
    lines.append(f"Summary saved to:  {SUMMARY_PATH}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    token, api_base = load_config()
    data = fetch_snapshot(token, api_base)
    summary = summarize(data)
    write_outputs(data, summary)
    print(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
