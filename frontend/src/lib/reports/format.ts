// Display formatting of report values by column type.
import { fmtDmy, fmtDmyTime } from './dates'
import type { ColType } from './types'

export const prettyKey = (v: string) => v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const inr = (n: number, max = 2) => n.toLocaleString('en-IN', { maximumFractionDigits: max, minimumFractionDigits: 0 })

export function fmtNumber(type: ColType, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v !== 'number') {
    const n = Number(v)
    if (Number.isNaN(n)) return String(v)
    v = n
  }
  const n = v as number
  switch (type) {
    case 'int': return inr(n, 0)
    case 'money': return `₹${inr(n, 2)}`
    // The API sends percentages as fractions (0.25 = 25 %).
    case 'percent': return `${inr(n * 100, 1)}%`
    case 'hours': case 'days': return inr(n, 1)
    case 'decimal': return inr(n, 2)
    default: return inr(n, 2)
  }
}

/** Text of a non-numeric cell. */
export function fmtCell(type: ColType, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  switch (type) {
    case 'date': return fmtDmy(String(v))
    case 'datetime': return fmtDmyTime(String(v))
    case 'time': return String(v).length >= 5 ? (String(v).includes('T') ? String(v).slice(11, 16) : String(v).slice(0, 5)) : String(v)
    case 'bool': return v === true || v === 'true' || v === 1 || v === 'Yes' ? 'Yes' : 'No'
    default: return String(v)
  }
}

/** A change between two periods (fraction from the API) as '+12.5%'. */
export const fmtDelta = (d: number) => `${d > 0 ? '+' : ''}${(d * 100).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`

export const NONE_TOKEN = '__none__'
/** Filter values that come from a drill: the empty-value token reads 'Not set'. */
export const tokenLabel = (v: string) => (v === NONE_TOKEN ? 'Not set' : v)

export const isNumeric = (t: ColType) => ['int', 'decimal', 'money', 'percent', 'hours', 'days'].includes(t)

/** Hours and days read better with a unit once the number stands alone (chips). */
export function fmtWithUnit(type: ColType, v: unknown): string {
  const s = fmtNumber(type, v)
  if (s === '—') return s
  return type === 'hours' ? `${s} h` : type === 'days' ? `${s} d` : s
}

/** Time measures are better when they go down; everything else when it goes up. */
export function betterDirection(type: ColType, better?: 'up' | 'down'): 'up' | 'down' {
  return better || (type === 'hours' || type === 'days' ? 'down' : 'up')
}
