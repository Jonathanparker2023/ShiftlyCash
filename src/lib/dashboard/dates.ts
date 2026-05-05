const DEFAULT_TIME_ZONE = "America/New_York";
const DAY_MS = 86_400_000;

export function getTodayIso(timeZone = getAppTimeZone()): string {
  return getLocalIsoParts(new Date(), timeZone).iso;
}

export function getSundayOnOrBeforeTodayIso(timeZone = getAppTimeZone()): string {
  const parts = getLocalIsoParts(new Date(), timeZone);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() - parts.dayIndex);
  return toIsoDate(date);
}

export function addDaysIso(startIso: string, days: number): string {
  const date = new Date(`${startIso}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date: ${startIso}`);
  }

  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

export function formatDayLabel(dateIso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateIso}T00:00:00.000Z`));
}

function getAppTimeZone(): string {
  return process.env.SHIFTLYCASH_TIME_ZONE ?? DEFAULT_TIME_ZONE;
}

function getLocalIsoParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const year = Number(part("year"));
  const month = Number(part("month"));
  const day = Number(part("day"));
  const weekday = part("weekday");

  return {
    year,
    month,
    day,
    dayIndex: weekdayToIndex(weekday),
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function weekdayToIndex(weekday: string): number {
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return map[weekday] ?? 0;
}

function toIsoDate(date: Date): string {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}
