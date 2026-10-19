'use client'

import { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'

export const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
export const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
export const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase',
  color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap',
}
export const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
export const h2Style: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 12px' }

export function Pill({ label, hex }: { label: string; hex: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

export function ErrorBanner({ error }: { error: string | string[] }) {
  if (!error || (Array.isArray(error) && error.length === 0)) return null
  const items = Array.isArray(error) ? error : [error]
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {items.length === 1 ? items[0] : (
        <>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{items[0]}</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{items.slice(1).map((m, i) => <li key={i}>{m}</li>)}</ul>
        </>
      )}
    </div>
  )
}

/** Title block that sits BELOW <SalesNav />; "← Back" pill top-right. */
export function PageHeader({ title, subtitle, backHref, children }: { title: ReactNode; subtitle?: ReactNode; backHref?: string; children?: ReactNode }) {
  const router = useRouter()
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
      <div>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Sales Module</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title}</h1>
        {subtitle && <div style={{ fontSize: 13, color: TEXT.secondary, marginTop: 4 }}>{subtitle}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {children}
        {backHref && (
          <button data-tour="sales-back" onClick={() => router.push(backHref)} style={secondaryBtnStyle}>← Back</button>
        )}
      </div>
    </div>
  )
}

export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ minWidth: 150, flex: '1 1 180px', maxWidth: 320 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: 13.5, color: TEXT.body, marginTop: 3, wordBreak: 'break-word' }}>{value === null || value === undefined || value === '' ? '—' : value}</div>
    </div>
  )
}

