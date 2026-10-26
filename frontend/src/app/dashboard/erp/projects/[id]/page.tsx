'use client'

import { useEffect, useRef, useState } from 'react'
import { UploadSimple } from '@phosphor-icons/react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { hasErpPermission, useRequireApp } from '@/hooks/useAuth'
import { PermissionAction, useCan } from '@/lib/permissions'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { erpApi, productionApi } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { AuditEntry, ProductionScheduleEntry, Project, ProjectLetter, ServiceRequest } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ApprovalBanner from '@/components/erp/ApprovalBanner'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import LetterEditorDialog, { letterTypeTitle } from '@/components/erp/LetterEditorDialog'
import ManagedDocumentPanel, { openRecordInWord } from '@/components/shared/ManagedDocumentPanel'
import FileUploadPreview from '@/components/FileUploadPreview'
import { secondaryBtnStyle, dangerBtnStyle, smallSecondaryBtnStyle, smallDangerBtnStyle, segmentBtnStyle, primaryBtnStyle, RowCount, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import ContractChip from '@/components/erp/ContractChip'

// Machine status pill: in service = green, service / build stages = amber / blue, parked or retired = grey.
const MACHINE_STATUS_HEX: Record<string, string> = {
  active: '#047857', under_service: '#B45309', manufacturing_under_progress: '#2563EB', work_in_progress: '#2563EB',
  standby: '#78716c', inactive: '#64748b', decommissioned: '#78716c', cancel: '#78716c',
}

const TABS = ['Overview','Technical Specs', 'Maintenance History', 'Production', 'Documents', 'Audit Trail'] as const

// Feature (erp:projects.<key>) each machine sub-tab needs — core/features/erp.py. Documents
// shows when the user may see either uploaded files or created letters.
const TAB_FEATURES: Partial<Record<typeof TABS[number], string[]>> = {
  'Technical Specs': ['technical_specs'], 'Maintenance History': ['service_history'], Production: ['production'],
  Documents: ['documents', 'letters'], 'Audit Trail': ['audit_trail'],
}

type MachineDocAccess = {
  seeUploaded: boolean; upload: boolean; deleteUploaded: (ownerId?: number | null) => boolean
  seeLetters: boolean; createLetter: boolean; editLetter: boolean; deleteLetter: (ownerId?: number | null) => boolean; printLetter: boolean
}

export default function ProjectDetailPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('erp')
  const canCreateSr = hasErpPermission(user, 'sr_create')
  const canEdit = hasErpPermission(user, 'project_edit')
  const { can, canDelete: canDeleteOwn, canFeature } = useCan()
  const feat = (key: string, action: PermissionAction = 'view') => canFeature('erp', 'projects', key, action)
  // Company rule: Delete on Machines AND only records you created (admins: any).
  const canDeleteRecord = (ownerId?: number | null) => canDeleteOwn('erp', 'projects', ownerId ?? null)
  const canPrint = can('erp', 'projects', 'print')
  const visibleTabs = TABS.filter((t) => !TAB_FEATURES[t] || TAB_FEATURES[t]!.some((k) => feat(k)))
  const docAccess: MachineDocAccess = {
    seeUploaded: feat('documents'), upload: canEdit && feat('documents', 'create'),
    deleteUploaded: (o) => canDeleteRecord(o) && feat('documents', 'delete'),
    seeLetters: feat('letters'), createLetter: canEdit && feat('letters', 'create'), editLetter: canEdit && feat('letters', 'edit'),
    deleteLetter: (o) => canDeleteRecord(o) && feat('letters', 'delete'), printLetter: canPrint && feat('letters', 'print'),
  }
  const params = useParams()
  const router = useRouter()
  const ref = params.id as string
  const { id: projectId, error: linkError } = useRecordId(ref)

  const [project, setProject] = useState<Project | null>(null)
  const [activeTicketCount, setActiveTicketCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<typeof TABS[number]>('Overview')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [actionError, setActionError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setProject(await erpApi.getProject(projectId!))
    } catch (err) {
      setError(extractErrorMessages(err, 'Machine not found.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && projectId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, projectId])

  useEffect(() => {
    if (!isAuthorized || !projectId) return
    erpApi.listServiceRequests({ project_id: projectId, limit: 1000 }).then((srs: ServiceRequest[]) => {
      setActiveTicketCount(srs.filter((s) => !['closed', 'cancelled'].includes(s.status)).length)
    }).catch((err) => {
      setActionError(extractErrorMessages(err, 'Could not count the active service tickets for this machine — reload the page to try again.').join(' '))
    })
  }, [isAuthorized, projectId])

  const warranty = (() => {
    if (!project?.warranty_end_date) return { label: '—', sub: 'No warranty on record' }
    const end = new Date(project.warranty_end_date)
    const daysLeft = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (daysLeft < 0) return { label: 'Expired', sub: `Expired on ${formatDate(project.warranty_end_date)}` }
    return { label: 'Active', sub: `Valid until ${formatDate(project.warranty_end_date)} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)` }
  })()

  const handleDelete = async () => {
    if (!project) return
    setActionError('')
    try {
      await erpApi.deleteProject(project.id)
      router.push('/dashboard/erp/projects')
    } catch (err) {
      setActionError(extractErrorMessages(err, `Could not delete machine ${project.serial_number} — check that you hold the Delete Machine permission and your connection, then try again.`).join(' '))
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ErpNav /><InvalidRecordLink message={linkError} listHref="/dashboard/erp/projects" listLabel="Back to projects" /></div>)
  if (loading) return <div><ErpNav /><p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p></div>
  if (error && !project) return <div><ErpNav /><p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p></div>
  if (!project) return null

  return (
    <div>
      <ErpNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#78716c', margin: '0 0 4px' }}>Machine</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: 0 }}>{project.serial_number}</h1>
            <span data-tour="erp-proj-status-badge"><Pill label={machineStatusLabel(project.status)} hex={MACHINE_STATUS_HEX[project.status] || '#78716c'} /></span>
            <ContractChip projectId={project.id} />
          </div>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>{[project.model_name || 'Model not provided', project.client_company].filter(Boolean).join(' · ')}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canCreateSr && (project.approval_status ?? 'approved') === 'approved' && (
            <Link
              href={{ pathname: '/dashboard/erp/service-requests/new' }}
              data-tour="erp-proj-new-sr-btn"
              style={{ ...primaryBtnStyle, textDecoration: 'none', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}
            >
              + New Service Request
            </Link>
          )}
          {canEdit && (
            <Link
              href={`/dashboard/erp/projects/${ref}/edit`}
              data-tour="erp-proj-edit-btn"
              style={{ ...secondaryBtnStyle, textDecoration: 'none', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}
            >
              Edit Machine
            </Link>
          )}
          {project && canDeleteRecord(project.created_by_id) && (
            <button onClick={() => setShowDeleteConfirm(true)} style={dangerBtnStyle} data-tour="erp-proj-delete-btn">Delete</button>
          )}
          <button onClick={() => router.push('/dashboard/erp/projects')} type="button" style={secondaryBtnStyle} data-tour="erp-proj-back-btn">
            ← Back
          </button>
        </div>
      </div>

      {actionError && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '0 0 14px' }}>{actionError}</p>}

      {project.approval_status === 'pending' && (
        <ApprovalBanner tone="pending" title="Pending approval" entityType="erp_machine" entityId={project.id}
          text="Service requests can't be raised on this machine until it is approved."
          approveLabel="Approve machine" rejectLabel="Reject"
          rejectPrompt="Say what is wrong with this machine's details — the person who registered it is notified and resubmits by editing it."
          onApprove={async (r) => setProject(await erpApi.approveProject(project.id, r || undefined))}
          onReject={async (r) => setProject(await erpApi.rejectProject(project.id, r))} />
      )}
      {project.approval_status === 'rejected' && (
        <ApprovalBanner tone="rejected" title="Rejected"
          text={`${project.approval_remarks || 'No reason given.'} Edit the machine to correct it — saving sends it back for approval.`} />
      )}
      <ApprovalPanel title="Machine approval" entityType="erp_machine" entityId={project.id} onChanged={() => { load() }} />

      <div data-tour="erp-proj-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
        <div style={{ position: 'relative', overflow: 'hidden', padding: 18, borderRadius: 14, background: 'linear-gradient(140deg,#fffbeb,#fff)', border: '1px solid rgba(245,158,11,0.15)' }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 8px' }}>Active Tickets</p>
          <p style={{ fontSize: 28, fontWeight: 700, color: '#1f1108', margin: '0 0 6px' }}>{activeTicketCount}</p>
          <p style={{ fontSize: 12, color: '#a8a29e', margin: 0 }}>{activeTicketCount === 0 ? 'No open repair requests' : `${activeTicketCount} open repair request(s)`}</p>
        </div>
        {feat('warranty') && <div style={{ position: 'relative', overflow: 'hidden', padding: 18, borderRadius: 14, background: 'linear-gradient(140deg,#eff6ff,#fff)', border: '1px solid rgba(59,130,246,0.15)' }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 8px' }}>Warranty Status</p>
          <p style={{ fontSize: 28, fontWeight: 700, color: '#1f1108', margin: '0 0 6px' }}>{warranty.label}</p>
          <p style={{ fontSize: 12, color: '#a8a29e', margin: 0 }}>{warranty.sub}</p>
        </div>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
        {visibleTabs.map((t) => (
          <button
            key={t}
            data-tour={`erp-proj-tab-${t.toLowerCase().replace(/\s+/g, '-')}`}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 6px',
              marginRight: 16,
              border: 'none',
              background: 'transparent',
              borderBottom: tab === t ? '2px solid #FF7A45' : '2px solid transparent',
              color: tab === t ? '#FF7A45' : '#78716c',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewTab project={project} showContacts={feat('client_contacts')} showWarranty={feat('warranty')} />}
      {tab === 'Technical Specs' && <TechnicalSpecsTab project={project} />}
      {tab === 'Maintenance History' && <MaintenanceHistoryTab projectId={project.id} />}
      {tab === 'Production' && <ProductionTab projectId={project.id} canOpen={!!user?.apps?.includes('production')} />}
      {tab === 'Documents' && <DocumentsTab project={project} signatory={{ name: user?.name, designation: user?.designation }} access={docAccess} />}
      {tab === 'Audit Trail' && <AuditTab projectId={project.id} />}

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this machine?"
        message={`Delete machine ${project.serial_number}? It can be restored from the recycle bin for 10 days.`}
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete() }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}

const machineStatusLabel = (status: string) => status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const d = (v?: string | null) => (v ? formatDate(v) : null)

function OverviewTab({ project, showContacts, showWarranty }: { project: Project; showContacts: boolean; showWarranty: boolean }) {
  const what = [project.machine_type, project.application_type ? `for ${project.application_type}` : ''].filter(Boolean).join(' ')
  const where = [project.site_name, project.site_location, project.site_state].filter(Boolean).join(', ')
  const sentence = [
    `${project.product_name || project.model_name || 'Machine'}${what ? ` — ${what}` : ''}`,
    showContacts && project.client_company ? `supplied to ${project.client_company}${where ? ` at ${where}` : ''}` : '',
  ].filter(Boolean).join(', ') + '.'
  return (
    <DetailCard>
      <DetailSummary
        title={project.model_name || project.serial_number}
        text={sentence}
        meta={<>
          <span>Serial {project.serial_number}</span>
          {project.delivery_date && <><span>·</span><span>Dispatched {formatDate(project.delivery_date)}</span></>}
          {project.commissioning_date && <><span>·</span><span>Commissioned {formatDate(project.commissioning_date)}</span></>}
          {showContacts && project.is_export && <><span>·</span><Pill label="Export" hex="#2563EB" /></>}
        </>}
      />

      <DetailGroup title="Machine identity">
        <DetailRow label="Product">{project.product_name || <span style={{ color: '#64748b' }}>Not linked to a product (Sales › Products)</span>}</DetailRow>
        <DetailRow label="Model">{project.model_name}</DetailRow>
        <DetailRow label="Machine type">{project.machine_type}</DetailRow>
        <DetailRow label="Application type">{project.application_type}</DetailRow>
        <DetailRow label="Engine number">{project.engine_number}</DetailRow>
        <DetailRow label="Chassis number">{project.chassis_number}</DetailRow>
        <DetailRow label="Year of manufacture">{project.year_of_manufacture}</DetailRow>
      </DetailGroup>

      <DetailGroup title="Timeline">
        <DetailRow label="PO date">{d(project.po_date)}</DetailRow>
        <DetailRow label="Dispatch date">{d(project.delivery_date)}</DetailRow>
        <DetailRow label="Commissioning date">{d(project.commissioning_date)}</DetailRow>
        <DetailRow label="Handover date">{d(project.handover_date)}</DetailRow>
      </DetailGroup>

      {showContacts && <>
        <DetailGroup title="Customer">
          <DetailRow label="CRM customer">{project.customer_name || <span style={{ color: '#b45309' }}>Not linked — edit the machine and pick the Customer (needed for service invoices)</span>}</DetailRow>
          <DetailRow label="Client company">{project.client_company}</DetailRow>
          <DetailRow label="Client GST">{project.client_gst}</DetailRow>
          <DetailRow label="Contact person">{[project.client_name, project.client_designation].filter(Boolean).join(', ')}</DetailRow>
          <DetailRow label="Contact email">{project.client_email}</DetailRow>
          <DetailRow label="Contact phone">{[project.client_phone, project.client_phone_alt].filter(Boolean).join(' / ')}</DetailRow>
        </DetailGroup>
        <DetailGroup title="Site">
          <DetailRow label="Site">{project.site_name}</DetailRow>
          <DetailRow label="Location">{[project.site_location, project.site_state, project.site_pincode, project.site_country].filter(Boolean).join(', ')}</DetailRow>
          <DetailRow label="Zone">{project.zone}</DetailRow>
          <DetailRow label="Export deployment">{project.is_export ? 'Yes' : 'No'}</DetailRow>
        </DetailGroup>
      </>}

      {showWarranty && <DetailGroup title="Warranty & AMC" last={!project.notes}>
        <DetailRow label="Warranty period">{project.warranty_start_date || project.warranty_end_date ? `${d(project.warranty_start_date) || '—'} → ${d(project.warranty_end_date) || '—'}` : null}</DetailRow>
        <DetailRow label="Warranty terms">{project.warranty_override}</DetailRow>
        <DetailRow label="Extended warranty">{project.extended_warranty ? `Yes, until ${d(project.extended_warranty_end) || 'date not set'}` : 'No'}</DetailRow>
        <DetailRow label="AMC status">{project.amc_status}</DetailRow>
        <DetailRow label="AMC end date">{d(project.amc_end_date)}</DetailRow>
      </DetailGroup>}

      {project.notes && (
        <DetailGroup title="Production notes" last>
          <DetailRow label="Notes">{project.notes}</DetailRow>
        </DetailGroup>
      )}
    </DetailCard>
  )
}

function TechnicalSpecsTab({ project }: { project: Project }) {
  return (
    <DetailCard>
      <DetailGroup title="Operator">
        <DetailRow label="Operator name">{project.operator_name}</DetailRow>
        <DetailRow label="Operator phone">{project.operator_phone}</DetailRow>
        <DetailRow label="Operator email">{project.operator_email}</DetailRow>
        <DetailRow label="Qualification">{project.operator_qualification}</DetailRow>
      </DetailGroup>
      <DetailGroup title="Technical specifications" last>
        <DetailRow label="Software version">{project.software_version}</DetailRow>
        <DetailRow label="Installed options">{project.installed_options}</DetailRow>
        <DetailRow label="Specifications">{project.specifications}</DetailRow>
        <DetailRow label="Engineering notes">{project.tech_notes}</DetailRow>
      </DetailGroup>
    </DetailCard>
  )
}

function MaintenanceHistoryTab({ projectId }: { projectId: number }) {
  const [srs, setSrs] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    erpApi.listServiceRequests({ project_id: projectId, limit: 1000 })
      .then(setSrs)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the service history for this machine — check your connection and reload the page.').join(' ')))
      .finally(() => setLoading(false))
  }, [projectId])

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (srs.length === 0) return <p style={{ fontSize: 13, color: '#78716c' }}>No service requests raised for this machine yet — use “+ New Service Request” above when the customer reports a problem.</p>

  return (
    <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
            {['SR Number', 'Issue', 'Priority', 'Status', 'Created'].map((h, hi) => (
              <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}{hi === 0 && <RowCount count={srs.length} />}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {srs.map((sr) => (
            <tr key={sr.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
              <td style={{ padding: '10px 14px' }}>
                <Link href={recordPath('/dashboard/erp/service-requests', sr)} style={{ fontSize: 13, fontWeight: 600, color: '#FF7A45', textDecoration: 'none' }}>
                  {sr.request_number}
                </Link>
              </td>
              <td style={{ padding: '10px 14px', fontSize: 13 }}>{sr.issue_title}</td>
              <td style={{ padding: '10px 14px', fontSize: 12.5, textTransform: 'capitalize' }}>{sr.priority}</td>
              <td style={{ padding: '10px 14px', fontSize: 12.5, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{sr.status.replace(/_/g, ' ')}</td>
              <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{formatDate(sr.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}

const WO_STATUS_HEX: Record<string, string> = { draft: '#78716c', released: '#2563EB', in_progress: '#F59E0B', completed: '#16A34A', closed: '#0f766e', cancelled: '#DC2626' }

// Work orders building this machine in the Production module. Readable by
// any ERP user; the WO number links through only for Production users.
function ProductionTab({ projectId, canOpen }: { projectId: number; canOpen: boolean }) {
  const [orders, setOrders] = useState<ProductionScheduleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    productionApi.getProjectWorkOrders(projectId)
      .then(setOrders)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load production work orders.').join(' ')))
      .finally(() => setLoading(false))
  }, [projectId])

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (orders.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No production work orders are linked to this machine.</p>

  return (
    <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
        <thead>
          <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
            {['Work Order', 'Product', 'Built / Planned', 'Planned End', 'Status'].map((h, hi) => (
              <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}{hi === 0 && <RowCount count={orders.length} />}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.work_order_id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
              <td style={{ padding: '10px 14px' }}>
                {canOpen ? (
                  <Link href={recordPath('/dashboard/production/work-orders', o, 'work_order_id')} style={{ fontSize: 13, fontWeight: 600, color: '#FF7A45', textDecoration: 'none' }}>{o.wo_number}</Link>
                ) : <span style={{ fontSize: 13, fontWeight: 600 }}>{o.wo_number}</span>}
              </td>
              <td style={{ padding: '10px 14px', fontSize: 13 }}>{o.product_name || '—'}</td>
              <td style={{ padding: '10px 14px', fontSize: 12.5, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{o.quantity_completed} / {o.quantity_planned} ({o.progress_percent}%)</td>
              <td style={{ padding: '10px 14px', fontSize: 12.5, color: o.is_overdue ? '#b91c1c' : '#78716c' }}>{o.planned_end_date ? formatDate(o.planned_end_date) : '—'}{o.is_overdue ? ' · overdue' : ''}</td>
              <td style={{ padding: '10px 14px' }}>
                <Pill label={machineStatusLabel(o.status)} hex={WO_STATUS_HEX[o.status] || '#78716c'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}

type DocView = 'uploaded' | 'created'

function DocumentsTab({ project, signatory, access }: { project: Project; signatory: { name?: string; designation?: string }; access: MachineDocAccess }) {
  const projectId = project.id
  const [view, setView] = useState<DocView>(access.seeUploaded ? 'uploaded' : 'created')
  const [attachments, setAttachments] = useState<import('@/types').ProjectAttachment[]>([])
  const [letters, setLetters] = useState<ProjectLetter[]>([])
  // A list the user has no feature for is never loaded (the server would refuse it).
  const [loadingAttachments, setLoadingAttachments] = useState(access.seeUploaded)
  const [loadingLetters, setLoadingLetters] = useState(access.seeLetters)
  const [lettersError, setLettersError] = useState('')
  const [editor, setEditor] = useState<{ open: boolean; letter: ProjectLetter | null }>({ open: false, letter: null })

  const loadAttachments = () => {
    erpApi.listProjectAttachments(projectId).then(setAttachments).finally(() => setLoadingAttachments(false))
  }
  const loadLetters = () => {
    erpApi.listProjectLetters(projectId)
      .then((rows: ProjectLetter[]) => { setLetters(rows); setLettersError('') })
      .catch((err) => setLettersError(extractErrorMessages(err, 'Failed to load created documents.').join(' ')))
      .finally(() => setLoadingLetters(false))
  }

  useEffect(() => {
    if (access.seeUploaded) loadAttachments()
    if (access.seeLetters) loadLetters()
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const openLetterPdf = (letter: ProjectLetter) =>
    openAttachmentBlob(() => erpApi.getProjectLetterBlob(projectId, letter.id, 'pdf'))
      .catch((err) => setLettersError(`Could not generate the PDF for ${letter.letter_no}: ${extractErrorMessages(err, 'the server did not return a file — try again, or open it in Word instead.').join(' ')}`))

  const VIEWS: { key: DocView; label: string; count: number }[] = [
    ...(access.seeUploaded ? [{ key: 'uploaded' as const, label: 'Uploaded', count: attachments.length }] : []),
    ...(access.seeLetters ? [{ key: 'created' as const, label: 'Created', count: letters.length }] : []),
  ]

  return (
    <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '12px 18px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              data-tour={`erp-proj-docs-view-${v.key}`}
              onClick={() => setView(v.key)}
              style={segmentBtnStyle(view === v.key)}
            >
              {v.label} <span style={{ fontSize: 11, opacity: 0.75 }}>({v.count})</span>
            </button>
          ))}
        </div>
        {view === 'created' && access.createLetter && (
          <button
            type="button"
            onClick={() => setEditor({ open: true, letter: null })}
            data-tour="erp-proj-letter-create-btn"
            style={primaryBtnStyle}
          >
            + Create New
          </button>
        )}
      </div>

      {view === 'uploaded' ? (
        <UploadedDocuments projectId={projectId} attachments={attachments} loading={loadingAttachments} reload={loadAttachments} canEdit={access.upload} canDelete={access.deleteUploaded} />
      ) : (
        <CreatedDocuments
          projectId={projectId}
          letters={letters}
          loading={loadingLetters}
          error={lettersError}
          setError={setLettersError}
          reload={loadLetters}
          canCreate={access.createLetter}
          canEdit={access.editLetter}
          canDelete={access.deleteLetter}
          canPrint={access.printLetter}
          onOpenPdf={openLetterPdf}
          onEdit={(letter) => setEditor({ open: true, letter })}
        />
      )}

      <LetterEditorDialog
        open={editor.open}
        project={project}
        letter={editor.letter}
        letters={letters}
        signatory={signatory}
        onClose={() => setEditor({ open: false, letter: null })}
        onSaved={(_saved, wordError) => {
          setEditor({ open: false, letter: null })
          loadLetters()
          if (wordError) setLettersError(wordError)
        }}
      />
    </div>
  )
}

function CreatedDocuments({ projectId, letters, loading, error, setError, reload, canCreate, canEdit, canDelete, canPrint, onOpenPdf, onEdit }: {
  projectId: number
  letters: ProjectLetter[]
  loading: boolean
  error: string
  setError: (msg: string) => void
  reload: () => void
  canCreate: boolean
  canEdit: boolean
  canDelete: (ownerId?: number | null) => boolean
  canPrint: boolean
  onOpenPdf: (letter: ProjectLetter) => void
  onEdit: (letter: ProjectLetter) => void
}) {
  const [toDelete, setToDelete] = useState<ProjectLetter | null>(null)

  const confirmDelete = async () => {
    if (!toDelete) return
    const letter = toDelete
    setToDelete(null)
    try {
      await erpApi.deleteProjectLetter(projectId, letter.id)
      reload()
    } catch (err) {
      setError(extractErrorMessages(err, `Failed to delete ${letter.letter_no}.`).join(' '))
    }
  }

  const actionBtn: React.CSSProperties = smallSecondaryBtnStyle

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: 0 }}>{error}</p>}
      {loading ? (
        <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>Loading…</p>
      ) : letters.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e', margin: 0 }}>
          No documents created yet.{canCreate ? ' Use “+ Create New” for a delivery cover letter, delivery confirmation or guarantee certificate.' : ''}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {letters.map((l) => (
            <div key={l.id} style={{ padding: '10px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                <a
                  href="#"
                  title={canEdit && canPrint ? 'Open in Word to edit' : 'Open PDF'}
                  onClick={(e) => {
                    e.preventDefault()
                    if (!canPrint) { setError('Opening letters needs Service & Commissioning › Projects (Machines) › Delivery letters & certificates › Print. Ask an admin to add it to one of your roles.'); return }
                    if (!canEdit) { onOpenPdf(l); return }
                    const tab = window.open('', '_blank')
                    openRecordInWord('erp_project_letter', l.id, tab)
                      .then(() => setTimeout(reload, 1500))
                      .catch((err) => setError(`Could not open ${l.letter_no} in Word: ${extractErrorMessages(err, 'unknown error').join(' ')}`))
                  }}
                  style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}
                >
                  {l.subject}
                </a>
                <p style={{ fontSize: 11.5, color: '#a8a29e', margin: '2px 0 0' }}>
                  {l.letter_type && l.letter_type !== 'general' && (
                    <span style={{ marginRight: 6 }}><Pill label={letterTypeTitle(l.letter_type)} hex="#c2410c" /></span>
                  )}
                  {l.letter_no} · {formatDate(l.letter_date)}{l.created_by_name ? ` · by ${l.created_by_name}` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {canPrint && <button type="button" onClick={() => onOpenPdf(l)} style={actionBtn}>PDF</button>}
                {canEdit && <button type="button" onClick={() => onEdit(l)} style={actionBtn}>Edit</button>}
                {canDelete(l.created_by_id) && (
                  <button type="button" onClick={() => setToDelete(l)} style={smallDangerBtnStyle}>
                    Delete
                  </button>
                )}
              </div>
            </div>
            <ManagedDocumentPanel entityType="erp_project_letter" entityId={l.id} revision={l.revision} canModify={canEdit && canPrint} recordLabel="letter" downloadName={l.letter_no.replace(/[^A-Za-z0-9._-]+/g, '-')} />
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Delete this letter?"
        message={toDelete ? `Delete ${toDelete.letter_no} (“${toDelete.subject}”)? This cannot be undone; its reference number will not be reused.` : ''}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}

function UploadedDocuments({ projectId, attachments, loading, reload, canEdit, canDelete }: {
  projectId: number
  attachments: import('@/types').ProjectAttachment[]
  loading: boolean
  reload: () => void
  canEdit: boolean
  canDelete: (ownerId?: number | null) => boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const [staged, setStaged] = useState<File[]>([])

  // Stage the picked files for user review instead of uploading immediately.
  const stageFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    setStaged((prev) => [...prev, ...Array.from(files)])
  }

  const confirmUpload = async () => {
    if (staged.length === 0) return
    setUploading(true)
    setError('')
    try {
      await erpApi.uploadProjectAttachments(projectId, staged)
      setStaged([])
      reload()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDelete = async (attachmentId: number) => {
    try {
      await erpApi.deleteProjectAttachment(projectId, attachmentId)
      reload()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to delete document.')
    }
  }

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canEdit && (
        <div
          data-tour="erp-proj-docs-dropzone"
          onClick={() => !uploading && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); stageFiles(e.dataTransfer.files) }}
          style={{
            padding: '32px 20px',
            borderRadius: 14,
            border: `2px dashed ${dragOver ? '#FF7A45' : 'rgba(0,0,0,0.15)'}`,
            background: dragOver ? 'rgba(244,113,59,0.05)' : '#fff',
            textAlign: 'center',
            cursor: uploading ? 'wait' : 'pointer',
          }}
        >
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => stageFiles(e.target.files)} disabled={uploading} />
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <UploadSimple size={20} color="#78716c" />
          </div>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: '#1f1108', margin: '0 0 4px' }}>
            {uploading ? 'Uploading…' : 'Drag & drop files here'}
          </p>
          {!uploading && (
            <p style={{ fontSize: 12.5, color: '#a8a29e', margin: 0 }}>
              or <span style={{ color: '#FF7A45', fontWeight: 600 }}>click to browse</span>
            </p>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            {['PDF', 'DOCX', 'XLSX', 'JPG/PNG', 'MP4'].map((t) => (
              <span key={t} style={{ fontSize: 10.5, fontWeight: 600, padding: '3px 9px', borderRadius: 6, background: 'rgba(0,0,0,0.05)', color: '#78716c' }}>{t}</span>
            ))}
          </div>
        </div>
      )}

      {canEdit && (
        <FileUploadPreview
          files={staged}
          uploading={uploading}
          onRemove={(i) => setStaged((prev) => prev.filter((_, idx) => idx !== i))}
          onConfirm={confirmUpload}
          onCancel={() => { setStaged([]); if (fileRef.current) fileRef.current.value = '' }}
        />
      )}

      {error && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: 0 }}>{error}</p>}

      {loading ? (
        <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>Loading…</p>
      ) : attachments.length === 0 ? (
        <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>No documents uploaded yet{canEdit ? ' — drop drawings, manuals or photos in the box above.' : '.'}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {attachments.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => erpApi.getProjectAttachmentBlob(projectId, a.id), a.filename) }}
                style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}
              >
                {a.filename}
              </a>
              {canDelete(a.created_by_id) && (
                <button onClick={() => handleDelete(a.id)} style={smallDangerBtnStyle}>
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
)
}

function AuditTab({ projectId }: { projectId: number }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    erpApi.getProjectAuditTrail(projectId).then(setEntries).finally(() => setLoading(false))
  }, [projectId])

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (entries.length === 0) return <p style={{ fontSize: 13, color: '#78716c' }}>No changes recorded yet — every edit to this machine will be listed here.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e) => (
        <div key={e.id} style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1f1108' }}>{e.performed_by}</span>
            <span style={{ fontSize: 11.5, color: '#a8a29e' }}>{e.performed_at ? formatDateTime(e.performed_at) : ''}</span>
          </div>
          <p style={{ fontSize: 13, color: '#57534e', margin: 0 }}>{e.summary || e.action}</p>
        </div>
      ))}
    </div>
  )
}

