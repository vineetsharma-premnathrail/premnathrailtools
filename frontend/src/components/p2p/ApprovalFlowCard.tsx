'use client'

// The Procurement approval chain at a glance — a preview of the "Purchase
// requisition" and "Purchase order" workflows of the central approval engine
// (Organization › Approval Workflows). Shown on Settings, the New PR form and
// the RFQ page. Approvers are no longer set in Procurement › Settings.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { p2pApi } from '@/lib/api'
import { P2PApprovalFlow, P2PApprovalFlowStage } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'

function stageText(s: P2PApprovalFlowStage): { who: string; warn: boolean } {
  if (s.problem && !s.skipped) return { who: s.problem, warn: true }
  if (!s.approvers.length) return { who: 'Skipped — nobody to approve', warn: false }
  return { who: s.approvers.map((a) => a.name || `User #${a.id}`).join(', '), warn: false }
}

export default function ApprovalFlowCard({ compact = false, refreshKey = 0 }: { compact?: boolean; refreshKey?: number }) {
  const [flow, setFlow] = useState<P2PApprovalFlow | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    p2pApi.approvalFlow().then((f) => { if (!cancelled) setFlow(f) }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [refreshKey])

  if (error) return null
  const steps: { title: string; who: string; rule: string; warn: boolean }[] = []
  if (flow) {
    for (const [label, wf] of [['PR', flow.pr], ['PO', flow.po]] as const) {
      if (!wf.is_active) {
        steps.push({ title: `${label} approval`, who: 'Workflow switched off — approved automatically', rule: '', warn: false })
        continue
      }
      wf.stages.forEach((s) => {
        const t = stageText(s)
        steps.push({ title: `${label} · ${s.name}`, who: t.who, rule: s.approval_mode === 'all' ? 'all must approve' : 'any one approves', warn: t.warn })
      })
    }
  }
  return (
    <div data-tour="p2p-approval-flow" style={{
      borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
      border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: compact ? 14 : 20, marginBottom: compact ? 16 : 20,
    }}>
      <h2 style={{ fontSize: compact ? 13.5 : 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>Who approves</h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {!flow && <div style={{ fontSize: 13, color: TEXT.muted }}>…</div>}
        {steps.map((s, i) => (
          <div key={`${s.title}-${i}`} style={{ flex: '1 1 220px', padding: '10px 12px', borderRadius: 12, background: s.warn ? 'rgba(220,38,38,0.06)' : 'rgba(255,255,255,.7)', border: `1px solid ${s.warn ? 'rgba(220,38,38,0.25)' : 'rgba(0,0,0,0.06)'}` }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: '.04em' }}>{s.title}{s.rule ? ` · ${s.rule}` : ''}</div>
            <div style={{ fontSize: 13, color: s.warn ? '#b91c1c' : TEXT.body, marginTop: 4 }}>{s.who}</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: TEXT.muted, margin: '10px 0 0' }}>
        Approvers are set in{' '}
        <Link href="/dashboard/organization/workflows" style={{ color: '#FF6A2A', fontWeight: 600 }}>Organization › Approval Workflows</Link>
        {' '}(&ldquo;Purchase requisition&rdquo; and &ldquo;Purchase order&rdquo;), no longer here.
        {!compact && ' A requisition or PO already in approval keeps the approvers it started with.'}
      </p>
    </div>
  )
}
