export function formatWeekDuration(weeks: number | null): string {
  if (weeks === null) {
    return "-";
  }

  const years = Math.floor(weeks / 52);
  const remainingWeeks = weeks % 52;

  if (years <= 0) {
    return `${remainingWeeks} wks`;
  }

  return `${years} yrs ${remainingWeeks} wks`;
}

export function formatWeekOffsetDateLabel(
  weekOffset: number,
  now = new Date(),
): string {
  const date = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  date.setUTCDate(date.getUTCDate() + weekOffset * 7);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
