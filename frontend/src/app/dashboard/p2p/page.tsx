'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi } from '@/lib/api'
import { P2PRequest } from '@/types'
import { TEXT } from '@/lib/theme'
import { secondaryBtnStyle, pillStyle, StatChip, segmentBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import P2PRequestList, { P2PListStats } from '@/components/p2p/P2PRequestList'
import ExportDialog, { ExportItem } from '@/components/erp/ExportDialog'
import ImportDialog from '@/components/shared/ImportDialog'
import { useP2PApproverFlags } from '@/components/p2p/useP2PApproverFlags'

type View = 'waiting' | 'approved' | 'rejected' | 'all'

const NEW_BTN: React.CSSProperties = { background: '#ea580c', border: '1px solid #c2410c', color: '#fff', fontSize: 13.5, fontWeight: 600, padding: '10px 14px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap' }

// Status segments: which statuses each shows (undefined = every requisition the user's data access allows).
const SEGMENTS: Record<View, { label: string; statuses?: string[]; empty: string }> = {
  waiting: { label: 'Waiting for me', statuses: ['submitted'], empty: 'Nothing is waiting for your approval.' },
  approved: { label: 'Approved', statuses: ['approved', 'vendor_quotations', 'technical_evaluation', 'commercial_evaluation', 'vendor_selected', 'po_drafted', 'po_raised', 'po_approved', 'partially_received', 'received', 'closed'], empty: 'No approved requisitions yet.' },
  rejected: { label: 'Rejected', statuses: ['rejected'], empty: 'No rejected requisitions.' },
  all: { label: 'All', statuses: undefined, empty: 'No Purchase Requisitions yet.' },
}

// ?view=approvals (old P.R Approval links, notifications) opens Waiting for me; ?view=all / ?bucket=... the matching segment.
const viewFromUrl = (): View | null => {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search)
  const v = q.get('view'); const b = q.get('bucket')
  if (v === 'approvals' || b === 'pending') return 'waiting'
  if (v === 'all' || b === 'all') return 'all'
  if (b === 'approved' || b === 'rejected') return b
  return null
}

export default function P2PHomePage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()
  const { can, canFeature } = useCan()
  const [requestedView, setView] = useState<View | null>(viewFromUrl)
  const [exportItems, setExportItems] = useState<ExportItem[] | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [listKey, setListKey] = useState(0)
  const [stats, setStats] = useState<P2PListStats>({ total: 0, pending: 0, inProgress: 0, closed: 0 })
  const approverFlags = useP2PApproverFlags()

  // Which tabs this person's role shows (Organization > Role & Permissions > Purchase Requisitions > features).
  const canApprove = approverFlags.is_pr_approver && canFeature('p2p', 'purchase_requisitions', 'approvals', 'view')
  const canMine = canFeature('p2p', 'purchase_requisitions', 'my_requisitions', 'view')
  const canAll = canFeature('p2p', 'purchase_requisitions', 'all_requisitions', 'view')
  const tabs: [View, string][] = ([
    ...(canApprove ? ['waiting'] : []),
    ...(canMine ? ['approved', 'rejected'] : []),
    ...(canAll ? ['all'] : []),
  ] as View[]).map((v) => [v, SEGMENTS[v].label])
  // The asked-for segment if the role allows it, else All, else the first one the role has.
  const view: View = tabs.some(([v]) => v === requestedView) ? (requestedView as View) : (tabs.some(([v]) => v === 'all') ? 'all' : (tabs[0]?.[0] ?? 'all'))
  // Count on the Approvals sub-tab: requisitions waiting for this user (same rule as the "Waiting for me" list).
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  useEffect(() => {
    if (!isAuthorized || !canApprove) return
    let live = true
    p2pApi.list({ limit: 1000, queue: 'pr-approval' }).then((rows: P2PRequest[]) => {
      if (!live) return
      setPendingCount(rows.filter((pr) => pr.status === 'submitted' && (user?.role === 'admin'
        || (pr.engine_approval ? pr.engine_approval.status === 'pending' && pr.engine_approval.can_decide
          : !!pr.approvals?.some((a) => a.approver_id === user?.id && !a.approved_at)))).length)
    }).catch(() => { if (live) setPendingCount(null) })
    return () => { live = false }
  }, [isAuthorized, canApprove, user?.id, user?.role])

  if (isLoading || !isAuthorized) return null

  const openExport = async () => {
    // Selective mode lists what this user can see (same scope as the export itself).
    const prs: P2PRequest[] = await p2pApi.list({ limit: 500 }).catch(() => [])
    setExportItems(prs.map((p) => ({ id: p.id, label: p.project_label ? `${p.p2p_number} — ${p.project_label}` : p.p2p_number, sub: [p.status.charAt(0).toUpperCase() + p.status.slice(1).replace(/_/g, ' '), p.requested_by_name].filter(Boolean).join(' · ') })))
  }


  const newBtn = can('p2p', 'purchase_requisitions', 'create') ? (
              <button type="button" data-tour="p2p-new-btn" onClick={() => router.push('/dashboard/p2p/new')} style={NEW_BTN}>+ New Purchase Requisition</button>
            ) : undefined
  const toolbarLeft = (
    <>
      {newBtn}
      {tabs.map(([v, label]) => (
        <button key={v} type="button" data-tour={`p2p-view-${v}`} onClick={() => setView(v)} style={{ ...segmentBtnStyle(view === v), whiteSpace: 'nowrap' }}>
          {label}
          {v === 'waiting' && pendingCount != null && pendingCount > 0 && (
            <span aria-label={`${pendingCount} waiting for you`} style={{ ...pillStyle('#dc2626'), marginLeft: 6 }}>{pendingCount}</span>
          )}
        </button>
      ))}
    </>
  )
  const toolbarRight = <>
              {can('p2p', 'purchase_requisitions', 'export') && (
                <button type="button" data-tour="p2p-export-btn" onClick={openExport} style={secondaryBtnStyle}>Export</button>
              )}
              {/* No 'import' action on this tab — importing raises requisitions, so it rides on 'create'. */}
              {can('p2p', 'purchase_requisitions', 'create') && (
                <button type="button" data-tour="p2p-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>
              )}
            </>

  return (
    <div>
      <P2PNav />

      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Purchase Requisitions</h1>
        <div data-tour="p2p-stats" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <StatChip label="Requisitions" value={stats.total} color="#3b82f6" />
          <StatChip label="Pending approval" value={stats.pending} color="#ea580c" />
          <StatChip label="In progress" value={stats.inProgress} color="#ca8a04" />
          <StatChip label="Closed" value={stats.closed} color="#16a34a" />
        </div>
      </div>

      {tabs.length === 0
        ? <p role="status" style={{ fontSize: 13.5, color: '#78716c' }}>Your role does not show any requisition tab. Ask an administrator to switch one on for your role (Organization › Role &amp; Permissions › Purchase Requisitions).</p>
        : <P2PRequestList key={`${view}-${listKey}`} showFilters mineToggle onStats={setStats}
            statuses={SEGMENTS[view].statuses} queue={view === 'waiting' ? 'pr-approval' : undefined} context={view === 'waiting' ? 'approval' : undefined}
            onlyPendingForViewer={view === 'waiting'} toolbarLeft={toolbarLeft} toolbarRight={toolbarRight} emptyLabel={SEGMENTS[view].empty} />}

      {exportItems && (
        <ExportDialog onClose={() => setExportItems(null)} filename="purchase_requisitions" noun="requisitions" dateLabel="Request date"
          download={(params) => p2pApi.exportRequisitions(params)} items={exportItems} filterParams={{}} />
      )}
      {showImport && (
        <ImportDialog
          title="Import purchase requisitions"
          intro={<>One row per item. Rows with the same <b>PR Ref</b> become one requisition. Category Code, Project Type (existing / new), Project,
            Item Name, Quantity and Project / Inhouse are required. Each one goes for approval like a requisition raised by hand (Organization › Approval Workflows).</>}
          templateName="purchase_requisition_import_template.csv"
          getTemplate={p2pApi.requisitionImportTemplate}
          upload={async (f) => {
            const r = await p2pApi.importRequisitions(f)
            return {
              summary: [`Requisitions created: ${r.created.length}${r.created.length ? ` (${r.created.map((c) => c.p2p_number).join(', ')})` : ''}`],
              errors: r.errors.map((e) => ({ where: `PR Ref ${e.ref} (row ${e.row})`, reason: e.reason })),
            }
          }}
          onClose={() => setShowImport(false)} onImported={() => setListKey((k) => k + 1)} />
      )}
    </div>
  )
}
