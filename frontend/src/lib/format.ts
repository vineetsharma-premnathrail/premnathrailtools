/** Formats a date the same way everywhere in the app (DD/MM/YYYY), regardless of the
 * viewing browser's own locale — using the bare `toLocaleDateString()` instead produces
 * MM/DD/YYYY for anyone with a US-locale browser, which reads as a different date. */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB')
}

/** Same as formatDate, but includes the time — for timestamps like "created at". */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB')
}
