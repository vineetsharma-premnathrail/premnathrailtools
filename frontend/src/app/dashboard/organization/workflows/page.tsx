'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { approvalsApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { ApprovalTransactionType } from '@/types'
import { BORDER, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { inputStyle } from '@/components/shared/ui'
import OrganizationNav from '@/components/organization/OrganizationNav'
import { extractErrorMessages } from '@/lib/validation'

// Organization › Approval Workflows — every transaction type that needs
// approval, grouped by module. Modules declare the types (in code); the admin
// decides the stages here.

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18, marginBottom: 16,
}

export default function WorkflowsPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('workflows')
  const { can } = useCan()
  const [rows, setRows] = useState<ApprovalTransactionType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    approvalsApi.listWorkflows()
      .then(setRows)
      .catch((e) => setError(extractErrorMessages(e, 'Could not load approval workflows.').join(' ')))
      .finally(() => setLoading(false))
  }, [isAuthorized])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out: Record<string, ApprovalTransactionType[]> = {}
    rows.filter((r) => !q || `${r.label} ${r.module_label} ${r.subtab_label}`.toLowerCase().includes(q))
      .forEach((r) => { (out[r.module_label] ||= []).push(r) })
    return out
  }, [rows, query])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <OrganizationNav />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Approval Workflows</h1>
          <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '6px 0 0', maxWidth: 760 }}>
            Who approves each kind of document, in what order. The workflow decides <b>who</b> approves; the approver&apos;s
            role permissions decide whether they are <b>allowed</b> to. Changes apply to documents submitted after you save —
            documents already waiting keep the approvers they were sent to.
          </p>
        </div>
        <input style={{ ...inputStyle, width: 260 }} placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      {loading && <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>}
      {!loading && rows.length === 0 && !error && (
        <p style={{ fontSize: 13, color: TEXT.muted }}>No module has registered an approval type yet.</p>
      )}
      {Object.entries(groups).map(([module, items]) => (
        <div key={module} style={cardStyle}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 10px' }}>{module}</h2>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {items.map((r) => (
              <Link key={r.key} href={`/dashboard/organization/workflows/${encodeURIComponent(r.key)}`}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderTop: `1px solid ${BORDER.light}`, cursor: 'pointer', flexWrap: 'wrap', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{r.label}</div>
                  <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.subtab_label} tab</div>
                </div>
                <div style={{ flex: '2 1 320px', fontSize: 12.5, color: TEXT.body }}>
                  {r.is_active === false ? <span style={{ color: TEXT.muted }}>Approval switched off — documents are approved on submit</span>
                    : (r.stage_names || []).map((s, i) => <span key={i}>{i > 0 && <span style={{ color: TEXT.muted }}> → </span>}{s}</span>)}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, whiteSpace: 'nowrap',
                  background: r.customised ? 'rgba(124,58,237,0.1)' : 'rgba(120,113,108,0.1)', color: r.customised ? '#7c3aed' : '#78716c' }}>
                  {r.customised ? 'Configured' : 'Default'}
                </span>
                <span style={{ color: '#FF6A2A', fontWeight: 600, fontSize: 12.5 }}>{can('organization', 'workflows', 'edit') ? 'Edit' : 'View'}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
