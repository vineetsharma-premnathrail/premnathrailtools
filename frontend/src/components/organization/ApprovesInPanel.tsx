'use client'

import Link from 'next/link'
import { ApprovesInRow } from '@/types'
import { SHEET } from '@/components/shared/FormSheet'

// Read-only "Approves in": the workflow stages a role / person approves in.
// Always derived from Organization › Approval Workflows — approvals are
// configured only there, so this list can never disagree with them.

const KIND = {
  approver: { label: 'Approver', color: '#c2410c', bg: 'rgba(255,106,42,0.1)' },
  also: { label: 'May also decide', color: '#1e40af', bg: 'rgba(59,130,246,0.08)' },
  escalation: { label: 'Escalation', color: '#92400e', bg: 'rgba(245,158,11,0.1)' },
} as const

export default function ApprovesInPanel({ rows, error, empty }: { rows: ApprovesInRow[] | null; error?: string; empty: string }) {
  if (error) return <p style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>{error}</p>
  if (rows === null) return <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Loading…</p>
  if (rows.length === 0) return <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>{empty}</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r, i) => {
        const k = KIND[r.kind]
        return (
          <div key={`${r.workflow_key}-${r.stage_sequence}-${r.kind}-${i}`}
            style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', padding: '8px 12px', borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: '#fff', opacity: r.workflow_active ? 1 : 0.6 }}>
            <div style={{ minWidth: 0, flex: '1 1 320px' }}>
              <div style={{ fontSize: 13, color: SHEET.INK, fontWeight: 600 }}>
                {r.module_label} › {r.document}
                <span style={{ fontWeight: 400, color: SHEET.MUTED }}> · Stage {r.stage_sequence} “{r.stage_name}”</span>
                {!r.workflow_active && <span style={{ fontWeight: 400, color: SHEET.MUTED }}> · approval switched off</span>}
              </div>
              <div style={{ fontSize: 12, color: SHEET.BODY, marginTop: 2 }}>
                {r.how} · <span style={{ color: SHEET.MUTED }}>Applies to: {r.applies_when}</span>
              </div>
              {r.sole && r.kind === 'approver' && (
                <div style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 3 }}>Only approver of this stage — nobody else can approve it.</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 'none' }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 9999, background: k.bg, color: k.color, whiteSpace: 'nowrap' }}>{k.label}</span>
              <Link href={`/dashboard/organization/workflows/${encodeURIComponent(r.workflow_key)}`} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A' }}>Open workflow</Link>
            </div>
          </div>
        )
      })}
    </div>
  )
}
