/*
 * Chat timestamps are simulation time, a story wall clock shown in UTC (see
 * `lib/time/sim.ts`). Day boundaries are UTC too, and "today" is relative to
 * the simulation's now, not the viewer's.
 */
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  timeZone: "UTC",
});

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const longDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(timestamp: number) {
  return Math.floor(timestamp / DAY) * DAY;
}

export function formatTime(timestamp: number) {
  return timeFormatter.format(timestamp);
}

export function formatListTimestamp(timestamp: number, now: number) {
  const dayDiff = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY);
  if (dayDiff <= 0) return timeFormatter.format(timestamp);
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return weekdayFormatter.format(timestamp);
  return shortDateFormatter.format(timestamp);
}

export function formatDayLabel(timestamp: number, now: number) {
  const dayDiff = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY);
  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return longDateFormatter.format(timestamp);
}

export function isSameDay(a: number, b: number) {
  return startOfDay(a) === startOfDay(b);
}

export function initials(name: string) {
  const parts = name
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** "Airi is typing", "Airi and Natsu are about to speak". */
export function formatTypingLabel(names: string[], doing = "typing") {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is ${doing}`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are ${doing}`;
  return `${names[0]} and ${names.length - 1} others are ${doing}`;
}
