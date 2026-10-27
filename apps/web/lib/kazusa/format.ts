const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
})

const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
})

const longDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

function startOfDay(timestamp: number) {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const DAY = 24 * 60 * 60 * 1000

export function formatTime(timestamp: number) {
  return timeFormatter.format(timestamp)
}

export function formatListTimestamp(timestamp: number, now = Date.now()) {
  const dayDiff = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY)
  if (dayDiff <= 0) return timeFormatter.format(timestamp)
  if (dayDiff === 1) return 'Yesterday'
  if (dayDiff < 7) return weekdayFormatter.format(timestamp)
  return shortDateFormatter.format(timestamp)
}

export function formatDayLabel(timestamp: number, now = Date.now()) {
  const dayDiff = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY)
  if (dayDiff <= 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'
  return longDateFormatter.format(timestamp)
}

export function isSameDay(a: number, b: number) {
  return startOfDay(a) === startOfDay(b)
}

export function initials(name: string) {
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function formatTypingLabel(names: string[]) {
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is typing`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`
  return `${names[0]} and ${names.length - 1} others are typing`
}
