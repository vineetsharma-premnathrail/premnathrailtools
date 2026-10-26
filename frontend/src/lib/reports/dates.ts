// Report period maths in IST (fixed +05:30), financial year April to March. All dates are ISO yyyy-mm-dd strings.

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** Today's date in IST as yyyy-mm-dd. */
export function todayIst(now: number = Date.now()): string {
  const d = new Date(now + 5.5 * 3600 * 1000)
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

function parts(s: string): [number, number, number] {
  const [y, m, d] = s.split('-').map(Number)
  return [y, m, d]
}

export function addDays(s: string, n: number): string {
  const [y, m, d] = parts(s)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** yyyy-mm-dd (or a datetime string) to DD-MM-YYYY. Anything else is returned unchanged. */
export function fmtDmy(s: string | null | undefined): string {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return s || ''
  return `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`
}
export function fmtDmyTime(s: string | null | undefined): string {
  if (!s) return ''
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) ? `${fmtDmy(s)} ${s.slice(11, 16)}` : fmtDmy(s)
}

/** The from-to of a preset, or null for 'custom' / an unknown key. Current periods end today. */
export function resolvePreset(key: string, today: string = todayIst()): { from: string; to: string } | null {
  const [y, m] = parts(today)
  switch (key) {
    case 'this_month': return { from: iso(y, m, 1), to: today }
    case 'last_month': {
      const py = m === 1 ? y - 1 : y
      const pm = m === 1 ? 12 : m - 1
      return { from: iso(py, pm, 1), to: iso(py, pm, lastDayOf(py, pm)) }
    }
    case 'this_quarter': {
      const qm = Math.floor((m - 1) / 3) * 3 + 1
      return { from: iso(y, qm, 1), to: today }
    }
    case 'last_quarter': {
      let qm = Math.floor((m - 1) / 3) * 3 + 1 - 3
      let qy = y
      if (qm < 1) { qm += 12; qy -= 1 }
      return { from: iso(qy, qm, 1), to: iso(qy, qm + 2, lastDayOf(qy, qm + 2)) }
    }
    case 'this_fy': {
      const fy = m >= 4 ? y : y - 1
      return { from: iso(fy, 4, 1), to: today }
    }
    case 'last_fy': {
      const fy = (m >= 4 ? y : y - 1) - 1
      return { from: iso(fy, 4, 1), to: iso(fy + 1, 3, 31) }
    }
    case 'last_30_days': return { from: addDays(today, -29), to: today }
    case 'last_90_days': return { from: addDays(today, -89), to: today }
    default: return null
  }
}

export const PRESET_FALLBACK = [
  { key: 'this_month', label: 'This month' }, { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' }, { key: 'last_quarter', label: 'Last quarter' },
  { key: 'this_fy', label: 'This financial year' }, { key: 'last_fy', label: 'Last financial year' },
  { key: 'last_30_days', label: 'Last 30 days' }, { key: 'last_90_days', label: 'Last 90 days' },
]

export function presetLabel(key: string, presets: { key: string; label: string }[]): string {
  if (key === 'custom') return 'Custom'
  return presets.find((p) => p.key === key)?.label || PRESET_FALLBACK.find((p) => p.key === key)?.label || 'Custom'
}
