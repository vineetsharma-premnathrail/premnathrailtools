import type { CSSProperties } from 'react'
import { COLORS, RADII, BORDERS, GLASS, SHADOWS, BRAND } from '@/lib/theme'

export const inputStyle: CSSProperties = {
  padding: '8px 10px', borderRadius: RADII.sm, border: BORDERS.slate, fontSize: 13, width: '100%', maxWidth: 260, boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.6)',
}
export const labelStyle: CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 4,
}
export const cardStyle: CSSProperties = {
  background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  borderRadius: RADII['3xl'], border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden',
}
export const cardHeaderStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: `1px solid ${GLASS.border}`,
}
export const cardTitleStyle: CSSProperties = {
  fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: COLORS.slate,
}
export const cardBodyStyle: CSSProperties = { padding: 16, display: 'grid', gap: 10 }
export const radioLabelStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#475569', cursor: 'pointer' }

export function smBtnStyle(bg: string, border: string, color: string): CSSProperties {
  return { padding: '7px 12px', borderRadius: 6, border: `1px solid ${border}`, background: bg, color, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }
}

export function calcButtonStyle(busy: boolean): CSSProperties {
  return {
    padding: '11px 20px', borderRadius: 8, border: 'none', background: `linear-gradient(135deg,${BRAND.primary},${BRAND.primaryHover})`,
    color: '#fff', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.03em',
    cursor: busy ? 'default' : 'pointer', boxShadow: `0 4px 12px ${SHADOWS.glowOrange}`, opacity: busy ? 0.7 : 1,
  }
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
