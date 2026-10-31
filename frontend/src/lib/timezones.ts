/**
 * IANA time zone names for the Time Zone dropdowns (Company Info, Plant).
 * Picked from a list so a typo like "Asia/KolkataPEW" can't be saved.
 * Asia/Kolkata is pinned first — it is the zone almost every record here uses.
 */
const FALLBACK = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'UTC']

function load(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')
    if (all && all.length) return ['Asia/Kolkata', ...all.filter((z) => z !== 'Asia/Kolkata' && z !== 'Asia/Calcutta')]
  } catch { /* old browser — use the short list */ }
  return FALLBACK
}

export const TIME_ZONES: string[] = load()

/** True when the saved value is one of the listed zones (old typed values may not be). */
export const isKnownTimeZone = (tz: string | null | undefined) => !!tz && TIME_ZONES.includes(tz)
