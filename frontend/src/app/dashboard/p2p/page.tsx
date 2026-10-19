'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { p2pApi } from '@/lib/api'
import { P2PRequest } from '@/types'
import { TEXT, SHADOWS, GRADIENTS } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import P2PNav from '@/components/p2p/P2PNav'
import P2PRequestList from '@/components/p2p/P2PRequestList'
import PRApprovalQueue from '@/components/p2p/PRApprovalQueue'
import ExportDialog, { ExportItem } from '@/components/erp/ExportDialog'
import ImportDialog from '@/components/shared/ImportDialog'
import { useP2PApproverFlags } from '@/components/p2p/useP2PApproverFlags'

type View = 'mine' | 'approvals'

// ?view=approvals (old P.R Approval links, notifications) opens the approvals view.
const viewFromUrl = (): View =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'approvals' ? 'approvals' : 'mine'

export default function P2PHomePage() {
  const { isAuthorized, isLoading, user } = useRequireApp('p2p')
  const router = useRouter()
  const { can } = useCan()
  const [view, setView] = useState<View>(viewFromUrl)
  const [exportItems, setExportItems] = useState<ExportItem[] | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [listKey, setListKey] = useState(0)
  const approverFlags = useP2PApproverFlags()

  if (isLoading || !isAuthorized) return null
  const canApprove = approverFlags.is_pr_approver

  const openExport = async () => {
    // Selective mode lists what this user can see (same scope as the export itself).
    const prs: P2PRequest[] = await p2pApi.list({ limit: 500 }).catch(() => [])
    setExportItems(prs.map((p) => ({ id: p.id, label: `${p.p2p_number} — ${p.project_label || ''}`, sub: [p.status, p.requested_by_name].filter(Boolean).join(' · ') })))
  }

  return (
    <div>
      <P2PNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Procurement Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Purchase Requisitions</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>Raise requisitions and approve them here — approvers are set in Organization › Approval Workflows.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {can('p2p', 'purchase_requisitions', 'export') && (
            <button type="button" data-tour="p2p-export-btn" onClick={openExport} style={secondaryBtnStyle}>Export</button>
          )}
          {/* No 'import' action on this tab — importing raises requisitions, so it rides on 'create'. */}
          {can('p2p', 'purchase_requisitions', 'create') && (
            <button type="button" data-tour="p2p-import-btn" onClick={() => setShowImport(true)} style={secondaryBtnStyle}>Import</button>
          )}
          {can('p2p', 'purchase_requisitions', 'create') && (<button
            data-tour="p2p-new-btn"
            onClick={() => router.push('/dashboard/p2p/new')}
            style={{
              padding: '12px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600,
              boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
            }}
          >
            + New Purchase Requisition
          </button>)}
        </div>
      </div>

      {canApprove && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          {([['mine', 'My Requisitions'], ['approvals', 'Approvals']] as const).map(([v, label]) => (
            <button key={v} type="button" data-tour={`p2p-view-${v}`} onClick={() => setView(v)}
              style={{
                padding: '9px 14px', marginBottom: -1, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                color: view === v ? '#FF7A45' : '#78716c', borderBottom: view === v ? '2px solid #FF7A45' : '2px solid transparent',
              }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {view === 'approvals' && canApprove
        ? <PRApprovalQueue />
        : <P2PRequestList key={listKey} showFilters emptyLabel="You haven't raised any Purchase Requisitions yet." />}

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
