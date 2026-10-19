'use client'

import { BORDER, GLASS, SHADOWS, TEXT } from '@/lib/theme'

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  vehicle: 'Rail-road vehicle', machine: 'Machine', equipment: 'Equipment', attachment: 'Attachment / accessory',
}
export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  development: 'In development', active: 'Active', phased_out: 'Phased out', discontinued: 'Discontinued',
}
export const PRODUCT_STATUS_HEX: Record<string, string> = {
  development: '#2563EB', active: '#16A34A', phased_out: '#F59E0B', discontinued: '#78716c',
}

export function Pill({ text, hex }: { text: string; hex?: string }) {
  const c = hex || '#78716c'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${c}1a`, color: c, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  )
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
      <div>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          {subtitle || 'Product Management'}
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title}</h1>
      </div>
      {children && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{children}</div>}
    </div>
  )
}

export function ErrorBanner({ error }: { error: string | string[] }) {
  if (!error || (Array.isArray(error) && error.length === 0)) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {Array.isArray(error) ? error.join(' ') : error}
    </div>
  )
}

export const tableWrapStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
}
export const thStyle: React.CSSProperties = {
  position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px',
  fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.secondary, whiteSpace: 'nowrap',
}
export const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
