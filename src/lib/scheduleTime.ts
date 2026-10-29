/** Parse a browser datetime-local value without accepting rollover dates or DST gaps. */
function parseLocalDateTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return null
  const pad = (number: number) => String(number).padStart(2, '0')
  const normalized = [
    parsed.getFullYear(), '-', pad(parsed.getMonth() + 1), '-', pad(parsed.getDate()),
    'T', pad(parsed.getHours()), ':', pad(parsed.getMinutes()),
  ].join('')
  return normalized === value ? parsed : null
}

/** Validate a schedule interval and return UTC storage values. */
export function validateScheduleWindow(startInput: string, endInput: string): {
  startsAt: string
  endsAt: string | null
} {
  const start = parseLocalDateTime(startInput)
  if (!start) throw new Error('Choose a valid start time')
  const end = endInput ? parseLocalDateTime(endInput) : null
  if (endInput && (!end || end.getTime() <= start.getTime())) {
    throw new Error('End time must be after the start time')
  }
  return { startsAt: start.toISOString(), endsAt: end?.toISOString() ?? null }
}
