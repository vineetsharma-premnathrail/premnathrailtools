'use client'

export default function StatCard({ label, value, unit, bg }: { label: string; value: string; unit?: string; bg: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: bg, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#94a3b8', marginBottom: 2 }}>{label}</div>
        <div><span style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>{value}</span>{unit && <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b', marginLeft: 3 }}>{unit}</span>}</div>
      </div>
    </div>
  )
}
