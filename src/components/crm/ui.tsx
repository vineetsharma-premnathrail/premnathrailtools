'use client'

import { COLORS, RADII, BORDERS, GLASS, SHADOWS } from '@/lib/theme'

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: RADII.lg,
  border: BORDERS.default,
  background: COLORS.surface,
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

export const primaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  padding: '10px 20px',
  borderRadius: RADII.lg,
  border: 'none',
  background: COLORS.brandGradient,
  color: '#fff',
  cursor: 'pointer',
}

export const secondaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '9px 18px',
  borderRadius: RADII.lg,
  border: BORDERS.default,
  background: COLORS.surface,
  color: '#57534e',
  cursor: 'pointer',
}

export const dangerBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  padding: '9px 18px',
  borderRadius: RADII.lg,
  border: BORDERS.dangerStrong,
  background: 'rgba(220,38,38,0.06)',
  color: COLORS.danger,
  cursor: 'pointer',
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: COLORS.textFaint2, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 18, borderRadius: RADII['3xl'], background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass() }}>
      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: COLORS.brand, margin: '0 0 14px' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  )
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>
}

export function Row3({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>{children}</div>
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, borderRadius: RADII['3xl'], background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass() }}>
      <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: COLORS.ink, margin: '0 0 12px' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  )
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: COLORS.textFaint2, margin: '0 0 2px' }}>{label}</p>
      <p style={{ fontSize: 13, color: COLORS.ink, margin: 0, whiteSpace: 'pre-wrap' }}>{value}</p>
    </div>
  )
}

export function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 12.5,
    fontWeight: 700,
    padding: '6px 11px',
    borderRadius: RADII.md,
    border: BORDERS.default,
    background: COLORS.surface,
    color: '#57534e',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}
