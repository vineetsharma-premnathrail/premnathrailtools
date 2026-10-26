'use client'

import { FormSheet, SheetIconName } from '@/components/shared/FormSheet'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle as sharedInput, thStyle as sharedTh, tdStyle as sharedTd, RowCount, pillStyle } from '@/components/shared/ui'

/** Small shared bits for the HCM screens (roster, punches, periods,
 * assignment history, registers, claim posting). Popups portal to <body> —
 * glass cards (backdrop-filter) would clip a fixed overlay. */

export const inputStyle: React.CSSProperties = { ...sharedInput, background: 'rgba(255,255,255,.7)' }
export const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
export const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
export const tableWrap: React.CSSProperties = { ...sectionStyle, padding: 0, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }
export const th: React.CSSProperties = sharedTh
export const td: React.CSSProperties = { ...sharedTd, fontSize: 12.5, verticalAlign: 'top' }
export const h3: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }
export const hint: React.CSSProperties = { fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }

export function dmy(iso?: string | null) {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'
}
export function localIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return localIso(d)
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Banner({ errors, ok }: { errors?: string[]; ok?: string }) {
  if (errors && errors.length) {
    return <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{errors.join(' ')}</div>
  }
  if (ok) return <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534', fontSize: 13 }}>{ok}</div>
  return null
}

export function Pill({ label, hex }: { label: string; hex: string }) {
  return <span style={pillStyle(hex)}>{label}</span>
}

/** Popup on the app-wide FormSheet (portal to <body>, icon header, footer).
 * Pass `footer` for the Cancel + primary buttons; `bare` skips the padded
 * body wrapper so callers can use SheetColumns. */
export function PortalModal({ open, title, onClose, children, width = 580, icon = 'edit', iconColor, subtitle = '', footer, busy = false, tour, bare = false }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode; width?: number
  icon?: SheetIconName; iconColor?: string; subtitle?: string; footer?: React.ReactNode; busy?: boolean; tour?: string; bare?: boolean
}) {
  if (!open) return null
  return (
    <FormSheet width={width} icon={icon} iconColor={iconColor} title={title} subtitle={subtitle} onClose={onClose} busy={busy} tour={tour} footer={footer}>
      {bare ? children : <div style={{ padding: '20px 24px' }}>{children}</div>}
    </FormSheet>
  )
}

/** Day-level exceptions from punch evaluation / imports. */
export function ErrorRows({ rows }: { rows: { row?: number; identifier?: string; date?: string; message: string }[] }) {
  if (!rows.length) return null
  return (
    <div style={{ ...tableWrap, maxHeight: 280, marginTop: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
        <thead><tr><th style={th}>Row <RowCount count={rows.length} /></th><th style={th}>Employee</th><th style={th}>Problem</th></tr></thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={i}><td style={td}>{e.row ?? dmy(e.date)}</td><td style={td}>{e.identifier || '—'}</td><td style={td}>{e.message}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
