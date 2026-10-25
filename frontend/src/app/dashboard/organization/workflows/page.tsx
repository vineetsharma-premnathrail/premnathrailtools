'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Select from '@/components/shared/Select'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { approvalsApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { ApprovalTransactionType } from '@/types'
import { BORDER, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { inputStyle, Pill, secondaryBtnStyle, smallBtnSize } from '@/components/shared/ui'
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
  const [show, setShow] = useState<'all' | 'customised' | 'off'>('all')

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
      .filter((r) => show === 'all' || (show === 'customised' ? !!r.customised : r.is_active === false))
      .forEach((r) => { (out[r.module_label] ||= []).push(r) })
    return out
  }, [rows, query, show])

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
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select aria-label="Show" style={{ ...inputStyle, width: 190 }} value={show} onChange={(e) => setShow(e.target.value as 'all' | 'customised' | 'off')}>
            <option value="all">Show: all</option>
            <option value="customised">Show: customised</option>
            <option value="off">Show: approval off</option>
          </Select>
          <input style={{ ...inputStyle, width: 260 }} placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      {loading && <p style={{ fontSize: 13, color: '#57534e' }}>Loading…</p>}
      {!loading && rows.length > 0 && Object.keys(groups).length === 0 && !error && (
        <p style={{ fontSize: 13, color: '#57534e' }}>No workflow matches this search and filter. Clear the search or choose &quot;Show: all&quot;.</p>
      )}
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
                <div style={{ flex: '0 1 280px', minWidth: 180 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: '#57534e' }}>{r.subtab_label} tab</div>
                </div>
                <div style={{ flex: '1 1 300px', fontSize: 12.5, color: TEXT.body }}>
                  {r.is_active === false ? <span style={{ color: '#57534e' }}>Approval switched off — documents are approved on submit</span>
                    : (r.stage_names || []).map((s, i) => <span key={i}>{i > 0 && <span style={{ color: '#57534e' }}> → </span>}{s}</span>)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                  {r.is_active === false && <Pill label="⏻ Off" hex="#B45309" />}
                  <Pill label={r.customised ? 'Custom' : 'Standard'} hex={r.customised ? '#7c3aed' : '#57534e'} />
                  <span style={{ ...secondaryBtnStyle, ...smallBtnSize, color: '#c2410c' }}>{can('organization', 'workflows', 'edit') ? 'Edit' : 'View'}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
