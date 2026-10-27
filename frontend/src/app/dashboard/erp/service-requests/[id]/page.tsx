'use client'

import Select from '@/components/shared/Select'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip, UploadSimple } from '@phosphor-icons/react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp, hasErpPermission } from '@/hooks/useAuth'
import { PermissionAction, useCan } from '@/lib/permissions'
import { useAttachmentBlobUrl, openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { erpApi, storeApi } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { AuditEntry, Project, ServiceRequest, ServiceMaterial, ServiceMaterialAttachment, StoreItem } from '@/types'
import DateField from '@/components/erp/DateField'
import ErpNav from '@/components/erp/ErpNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ReasonSheet from '@/components/shared/ReasonSheet'
import ApprovalBanner from '@/components/erp/ApprovalBanner'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import FileUploadPreview from '@/components/FileUploadPreview'
import CameraCapture from '@/components/CameraCapture'
import Link from 'next/link'
import { inputStyle, Field, Card, InfoRow, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, smallPrimaryBtnStyle, smallSecondaryBtnStyle, smallDangerBtnStyle, RowCount, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import MessageDialog from '@/components/erp/MessageDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { SERVICE_TYPES } from '@/components/erp/serviceTypes'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { IssueSpareDialog, ReturnSpareDialog } from '@/components/erp/SrSpareDialogs'
import ServiceVisitsTab, { SlaBadge } from '@/components/erp/ServiceVisitsTab'
import ContractChip from '@/components/erp/ContractChip'
import { SERVICE_BILLING_ENABLED } from '@/lib/features'
import { FormSheet, SHEET, SheetIcon, SheetSection, Optional, Req, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

/** Saves a partial SR update. With `onError` the reason is handed to the caller
 * (shown inside its popup) instead of the page-level error dialog. */
type PatchFn = (p: Record<string, unknown>, onError?: (msg: string[]) => void) => Promise<boolean>

// Every non-terminal-branch SRStatus, in the order they normally happen —
// must stay in sync with the full SRStatus union (types/index.ts) and the
// STATUS_LABELS map on the list page. "cancelled" is deliberately excluded:
// it's a side-exit, not a step in the forward flow, so it's handled as its
// own banner in WorkflowSteps/status dropdown instead of a numbered circle.
const WORKFLOW_STEPS = [
  { key: 'open', label: 'Reported' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'pending_parts', label: 'Pending Parts' },
  { key: 'on_hold', label: 'On Hold' },
  { key: 'work_completed', label: 'Work Completed' },
  { key: 'review', label: 'Review' },
  { key: 'closed', label: 'Closed' },
]
const CANCELLED_STEP = { key: 'cancelled', label: 'Cancelled' }
// Mirrors update_service_request: cancelling, or moving a closed / cancelled
// SR to any other status, needs a reason.
const needsStatusReason = (from: string, to: string | null) =>
  !!to && to !== from && (to === 'cancelled' || from === 'closed' || from === 'cancelled')
const TABS = ['Overview', 'Visits', 'Diagnostics & RCA', 'Materials', 'Attachments', 'Audit Trail'] as const
// Feature (erp:service_requests.<key>:view) each SR sub-tab needs — core/features/erp.py.
const TAB_FEATURE: Partial<Record<typeof TABS[number], string>> = {
  Visits: 'visits', 'Diagnostics & RCA': 'rca', Materials: 'materials', Attachments: 'attachments', 'Audit Trail': 'audit_trail',
}

export default function ServiceRequestDetailPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('erp')
  const params = useParams()
  const router = useRouter()
  const ref = params.id as string
  const { id: srId, error: linkError } = useRecordId(ref)

  const [sr, setSr] = useState<ServiceRequest | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [tab, setTab] = useState<typeof TABS[number]>('Overview')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<string | null>(null)
  const [projectError, setProjectError] = useState('')
  const [loadNotFound, setLoadNotFound] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await erpApi.getServiceRequest(srId!)
      setSr(data)
      setProjectError('')
      erpApi.getProject(data.project_id).then(setProject).catch((err) => {
        setProject(null)
        setProjectError(extractErrorMessages(err, 'Could not load this request’s machine — check your connection and reload the page.').join(' '))
      })
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      setLoadNotFound(status === 404)
      setError(extractErrorMessages(err, status === 404 ? 'Service request not found.' : 'The service request could not be loaded — check your connection and try again.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized && srId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, srId])

  // Mirrors the backend's `_can_edit`/`_can_delete` in service_requests.py —
  // admins always pass, the assigned engineer passes (each tab still checks its
  // own feature permission), everyone else must both own the SR and hold the
  // matching granular permission.
  const isEngineer = !!sr && !!user && !!sr.assigned_service_person_id && sr.assigned_service_person_id === user.id
  const canEdit = !!sr && !!user && (user.role === 'admin' || isEngineer || (sr.created_by_id === user.id && hasErpPermission(user, 'sr_edit')))
  const { canDelete: canDeleteOwn, canFeature } = useCan()
  const feat = (key: string, action: PermissionAction = 'view') => canFeature('erp', 'service_requests', key, action)
  const visibleTabs = TABS.filter((t) => !TAB_FEATURE[t] || feat(TAB_FEATURE[t]!))
  const showCharges = feat('charges')
  // Deleting the SR: Delete on Service Requests AND you created it (admins: any).
  const canDelete = !!sr && canDeleteOwn('erp', 'service_requests', sr.created_by_id ?? null)

  const patch: PatchFn = async (payload, onError) => {
    if (!sr) return false
    try {
      const updated = await erpApi.updateServiceRequest(sr.id, payload)
      setSr(updated)
      return true
    } catch (err) {
      const msg = extractErrorMessages(err, 'Could not update the service request — check your connection and that you are its creator with edit permission, then try again.')
      if (onError) onError(msg)
      else setError(msg)
      return false
    }
  }

  const handleDelete = async () => {
    if (!sr) return
    try {
      await erpApi.deleteServiceRequest(sr.id)
      router.push('/dashboard/erp/service-requests')
    } catch (err: any) {
      setError(extractErrorMessages(err, `Could not delete ${sr.request_number} — check that you are its creator with delete permission and it is not locked, then try again.`))
      setShowDeleteConfirm(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ErpNav /><InvalidRecordLink message={linkError} listHref="/dashboard/erp/service-requests" listLabel="Back to service requests" /></div>)
  if (loading) return <div><ErpNav /><p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p></div>
  if (error && !sr) return (
    <div>
      <ErpNav />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button onClick={() => router.push('/dashboard/erp/service-requests')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>
      <div role="alert" style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13.5 }}>
        <p style={{ margin: '0 0 10px', fontWeight: 600 }}>
          {loadNotFound ? 'Service request not found.' : 'This service request could not be opened.'} {Array.isArray(error) ? error.join(' ') : error}
        </p>
        {!loadNotFound && <button type="button" style={smallSecondaryBtnStyle} onClick={() => load()}>Try again</button>}
      </div>
    </div>
  )
  if (!sr) return null

  return (
    <div>
      <ErpNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p data-tour="erp-srd-number" style={{ fontSize: 12, fontWeight: 600, color: '#FF7A45', margin: '0 0 4px' }}>{sr.request_number}</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: 0 }}>{sr.issue_title}</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canEdit && (
            <Link
              href={`/dashboard/erp/service-requests/${ref}/edit`}
              data-tour="erp-srd-edit-btn"
              style={{ ...secondaryBtnStyle, textDecoration: 'none', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}
            >
              Edit
            </Link>
          )}
          {canDelete && (
            <button onClick={() => setShowDeleteConfirm(true)} style={{ ...dangerBtnStyle }} data-tour="erp-srd-delete-btn">Delete</button>
          )}
          <button onClick={() => router.push('/dashboard/erp/service-requests')} type="button" style={secondaryBtnStyle} data-tour="erp-srd-back-btn">
            ← Back
          </button>
        </div>
      </div>

      <MessageDialog open={!!error} variant="error" title="Action Failed" message={error} onClose={() => setError('')} />

      {sr.status === 'review' && (
        <ApprovalBanner tone="pending" title="Closure awaiting approval" entityType="service_request" entityId={sr.id}
          onlyIfSetting="sr_close_approval_required"
          text="The work is reported done. An approver closes it or sends it back to In Progress."
          approveLabel="Approve & close" rejectLabel="Send back"
          rejectPrompt="Say what still has to be done — the engineer is notified and the SR goes back to In Progress."
          onApprove={async (r) => setSr(await erpApi.approveSrClose(sr.id, r || undefined))}
          onReject={async (r) => setSr(await erpApi.rejectSrClose(sr.id, r))} />
      )}
      <ApprovalPanel title="Closure approval" entityType="service_request" entityId={sr.id} onChanged={() => { load() }} />

      {(sr.sla_response_state || sr.sla_resolution_state || sr.project_id) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <ContractChip projectId={sr.project_id} />
          <SlaBadge label="Response SLA" state={sr.sla_response_state} />
          <SlaBadge label="Resolution SLA" state={sr.sla_resolution_state} />
          {sr.sla_resolution_due_at && !sr.resolution_at && <span style={{ fontSize: 12, color: '#78716c' }}>Resolve by {formatDateTime(sr.sla_resolution_due_at)}</span>}
        </div>
      )}
      <WorkflowSteps status={sr.status} canModify={canEdit && !sr.is_locked} onRequestChange={setPendingStatus} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
        {visibleTabs.map((t) => (
          <button
            key={t}
            data-tour={`erp-srd-tab-${t.toLowerCase().replace(/[^a-z]+/g, '-')}`}
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

      {tab === 'Overview' && <OverviewTab sr={sr} project={project} projectError={projectError} canModify={canEdit} onPatch={patch} onRequestStatus={setPendingStatus}
        showCharges={showCharges} invoiceView={feat('invoice')} invoiceCreate={feat('invoice', 'create')} />}
      {tab === 'Visits' && <ServiceVisitsTab srId={sr.id} srStatus={sr.status} assignedId={sr.assigned_service_person_id ?? null} onChanged={load} />}
      {tab === 'Diagnostics & RCA' && <RcaTab sr={sr} canModify={canEdit && !sr.is_locked && feat('rca', 'edit')} onPatch={patch} />}
      {tab === 'Materials' && <MaterialsTab srId={sr.id} canEdit={canEdit && !sr.is_locked && feat('materials', 'edit')}
        canAdd={canEdit && !sr.is_locked && feat('materials', 'create')} canDelete={canEdit && !sr.is_locked && feat('materials', 'delete')}
        canRaisePr={canEdit && !sr.is_locked && feat('purchase_requisition', 'create')}
        canIssueSpares={feat('spare_issue', 'create')} canReturnSpares={feat('spare_issue', 'edit')} />}
      {tab === 'Attachments' && <AttachmentsTab sr={sr} canEdit={canEdit && feat('attachments', 'create')} canDelete={canEdit && feat('attachments', 'delete')} onRefresh={load} />}
      {tab === 'Audit Trail' && <AuditTab srId={sr.id} />}

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this service request?"
        message={`Delete service request ${sr.request_number}? It can be restored from the recycle bin for 10 days.`}
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete() }}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Cancelling, or reopening a closed / cancelled SR, is an exception step:
          the backend refuses it without a reason (kept in the audit trail). */}
      <ReasonSheet
        open={!!pendingStatus && needsStatusReason(sr.status, pendingStatus)}
        icon={pendingStatus === 'cancelled' ? 'x' : 'undo'}
        title={pendingStatus === 'cancelled' ? `Cancel ${sr.request_number}` : `Reopen ${sr.request_number}`}
        danger={pendingStatus === 'cancelled'}
        confirmLabel={pendingStatus === 'cancelled' ? 'Cancel SR' : 'Reopen'}
        requireValue
        placeholder="Reason…"
        message={
          pendingStatus
            ? `Change the status from "${[...WORKFLOW_STEPS, CANCELLED_STEP].find((s) => s.key === sr.status)?.label || sr.status}" to "${[...WORKFLOW_STEPS, CANCELLED_STEP].find((s) => s.key === pendingStatus)?.label || pendingStatus}". Enter the reason — it is kept in the audit trail.`
            : ''
        }
        onConfirm={(reason) => { const s = pendingStatus; setPendingStatus(null); if (s) patch({ status: s, status_reason: reason.trim() }) }}
        onCancel={() => setPendingStatus(null)}
      />

      <ConfirmDialog
        open={!!pendingStatus && !needsStatusReason(sr.status, pendingStatus)}
        title="Update Status"
        danger={false}
        confirmLabel="Update Status"
        message={
          pendingStatus
            ? `Change the status of ${sr.request_number} from "${[...WORKFLOW_STEPS, CANCELLED_STEP].find((s) => s.key === sr.status)?.label || sr.status}" to "${[...WORKFLOW_STEPS, CANCELLED_STEP].find((s) => s.key === pendingStatus)?.label || pendingStatus}"?${pendingStatus === 'closed' ? ' Closing needs Corrective Action filled on the Diagnostics & RCA tab, and the client is emailed.' : ''}${pendingStatus === 'cancelled' ? ' Cancelling takes it out of the normal workflow.' : ''}`
            : ''
        }
        onConfirm={() => { const s = pendingStatus; setPendingStatus(null); if (s) patch({ status: s }) }}
        onCancel={() => setPendingStatus(null)}
      />
    </div>
  )
}

function WorkflowSteps({ status, canModify, onRequestChange }: { status: string; canModify: boolean; onRequestChange: (key: string) => void }) {
  const activeIdx = WORKFLOW_STEPS.findIndex((s) => s.key === status)

  if (status === CANCELLED_STEP.key) {
    return (
      <div data-tour="erp-srd-workflow" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px', marginBottom: 20, borderRadius: 16, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#b91c1c' }}>Cancelled</span>
        <span style={{ fontSize: 12.5, color: '#78716c' }}>This service request was cancelled and is no longer moving through the normal workflow.</span>
      </div>
    )
  }

  return (
    <div data-tour="erp-srd-workflow" style={{ marginBottom: 20, borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }}>
    <div style={{ display: 'flex', alignItems: 'center', padding: '18px 20px', overflowX: 'auto' }}>
      {WORKFLOW_STEPS.map((step, i) => {
        const done = i < activeIdx
        const active = i === activeIdx
        const clickable = canModify && !active
        const circleBg = done ? '#22c55e' : active ? '#FF7A45' : '#fff'
        const circleColor = done || active ? '#fff' : '#a8a29e'
        const circleBorder = done ? '#22c55e' : active ? '#FF7A45' : 'rgba(0,0,0,0.1)'
        const labelColor = active ? '#FF7A45' : done ? '#16a34a' : '#a8a29e'
        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: i < WORKFLOW_STEPS.length - 1 ? 1 : undefined }}>
            <button
              type="button"
              disabled={!clickable}
              aria-current={active ? 'step' : undefined}
              aria-label={`${step.label}${active ? ' (current status)' : done ? ' (done)' : ''}${clickable ? ' — set as status' : ''}`}
              onClick={clickable ? () => onRequestChange(step.key) : undefined}
              title={clickable ? `Set status to ${step.label}` : undefined}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: clickable ? 'pointer' : 'default', userSelect: 'none', background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: circleBg,
                  color: circleColor,
                  border: `2px solid ${circleBorder}`,
                  fontSize: 11,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.02em', color: labelColor, whiteSpace: 'nowrap' }}>
                {step.label}
              </span>
            </button>
            {i < WORKFLOW_STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, margin: '0 8px 16px', background: done ? '#4ade80' : 'rgba(0,0,0,0.08)' }} />
            )}
          </div>
        )
      })}
    </div>
    </div>
  )
}

function OverviewTab({ sr, project, projectError, canModify, onPatch, onRequestStatus, showCharges, invoiceView, invoiceCreate }: {
  sr: ServiceRequest
  project: Project | null
  projectError: string
  canModify: boolean
  onPatch: PatchFn
  // Status changes go through the page's confirm dialog (same as the stepper),
  // because closing emails the client.
  onRequestStatus: (status: string) => void
  showCharges: boolean
  invoiceView: boolean
  invoiceCreate: boolean
}) {
  const d = (v?: string | null) => (v ? formatDate(v) : null)
  const machineLabel = project ? `${project.serial_number}${project.model_name ? ` — ${project.model_name}` : ''}` : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DetailCard style={{ marginBottom: 0 }}>
        <DetailSummary
          title={sr.issue_category ? `${sr.issue_category} issue` : 'Reported issue'}
          text={sr.issue_description || 'No description was given when this request was raised.'}
          meta={<>
            <span>Reported {formatDate(sr.created_at)}{sr.reported_by_name ? ` by ${sr.reported_by_name}` : ''}</span>
            <span>·</span>
            <span>{sr.assigned_to_name ? `Engineer: ${sr.assigned_to_name}` : 'No engineer assigned yet'}</span>
            {sr.is_locked && <><span>·</span><Pill label="Locked" hex="#64748b" /></>}
          </>}
        />

        <DetailGroup title="Machine & site">
          <DetailRow label="Machine">
            {project ? <Link href={recordPath('/dashboard/projects/service-projects', project)} style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>{machineLabel}</Link>
              : projectError ? <span style={{ color: '#b91c1c' }}>{projectError}</span> : 'Loading…'}
          </DetailRow>
          <DetailRow label="Customer">{project?.client_company}</DetailRow>
          <DetailRow label="Site / location">{project ? [project.site_name, project.site_location].filter(Boolean).join(', ') : null}</DetailRow>
        </DetailGroup>

        <DetailGroup title="Reported by">
          <DetailRow label="Name">{sr.reported_by_name}</DetailRow>
          <DetailRow label="Phone">{sr.reported_by_phone}</DetailRow>
          <DetailRow label="Email">{sr.reported_by_email}</DetailRow>
        </DetailGroup>

        <DetailGroup title="Assignment & dates">
          <DetailRow label="Engineer">{sr.assigned_to_name}</DetailRow>
          <DetailRow label="Opened">{d(sr.opened_at)}</DetailRow>
          <DetailRow label="Expected to attend">{d(sr.expected_date_to_attend)}</DetailRow>
          <DetailRow label="Expected to close">{d(sr.expected_completion_date)}</DetailRow>
          <DetailRow label="Closed">{d(sr.closed_at)}</DetailRow>
        </DetailGroup>

        <DetailGroup title="Service notes" last>
          <DetailRow label="Engineer's report">{sr.service_report_notes}</DetailRow>
        </DetailGroup>
      </DetailCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 16, alignItems: 'start' }}>
        <Card title="Status, Type & Priority">
          <Field label="Status">
            <Select
              data-tour="erp-srd-status"
              value={sr.status}
              disabled={!canModify || sr.is_locked}
              onChange={(e) => { if (e.target.value !== sr.status) onRequestStatus(e.target.value) }}
              style={inputStyle}
            >
              {[...WORKFLOW_STEPS, CANCELLED_STEP].map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Service Type">
            <Select
              data-tour="erp-srd-service-type"
              value={sr.service_type || ''}
              disabled={!canModify || sr.is_locked}
              onChange={(e) => onPatch({ service_type: e.target.value })}
              style={inputStyle}
            >
              {!sr.service_type && <option value="" disabled>Not set — select one</option>}
              {SERVICE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select
              data-tour="erp-srd-priority"
              value={sr.priority}
              disabled={!canModify || sr.is_locked}
              onChange={(e) => onPatch({ priority: e.target.value })}
              style={inputStyle}
            >
              <option value="standard">Standard</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
        </Card>

        <BillingCard key={sr.updated_at || sr.id} sr={sr} canModify={canModify && !sr.is_locked} onPatch={onPatch} showCharges={showCharges} />
        {invoiceView && <WarrantyInvoiceCard key={`wi-${sr.updated_at || sr.id}`} sr={sr} canModify={canModify && !sr.is_locked} onPatch={onPatch}
          canInvoiceFeature={invoiceCreate} showCharges={showCharges} />}
      </div>
    </div>
  )
}

// Fixed in code — must match SR_PAYMENT_STATUSES in
// backend/app/modules/erp/schemas/service_request.py.
const PAYMENT_STATUS_OPTIONS = [
  { value: 'not_billable', label: 'Not billable (warranty / free)' },
  { value: 'pending', label: 'Pending — to be invoiced' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'paid', label: 'Paid' },
]

const COST_FIELDS = [
  { key: 'service_cost', label: 'Service Cost (₹)' },
  { key: 'transport_cost', label: 'Transport Cost (₹)' },
  { key: 'accommodation_cost', label: 'Accommodation Cost (₹)' },
  { key: 'miscellaneous_cost', label: 'Miscellaneous Cost (₹)' },
] as const

const inr = (n: number | null | undefined) => `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const WARRANTY_LABELS: Record<string, string> = {
  in_warranty: 'In warranty', extended_warranty: 'Extended warranty', amc: 'Under AMC',
  out_of_warranty: 'Out of warranty', unknown: 'Unknown (machine has no commissioning / handover date)',
}
const BILLING_LABELS: Record<string, string> = { not_billable: 'Free of charge', to_bill: 'To be invoiced', invoiced: 'Invoiced', paid: 'Paid' }
const BILLING_HEX: Record<string, string> = { not_billable: '#78716c', to_bill: '#d97706', invoiced: '#2563eb', paid: '#16a34a' }

type SrInvoiceInfo = {
  billing_status: string | null
  invoice: null | { id: number; invoice_number: string; status: string; invoice_date: string; taxable_amount: number; cgst_amount: number;
    sgst_amount: number; igst_amount: number; total_amount: number; amount_due: number; collection_status: string; is_interstate: boolean }
  preview_lines: null | { description: string; hsn_sac_code: string; quantity: number; rate: number; gst_rate: number }[]
  problem: string | null
}

/** Warranty check result, chargeability (override needs a reason) and the
 * GST sales invoice raised from the SR into Finance. */
function WarrantyInvoiceCard({ sr, canModify, onPatch, canInvoiceFeature, showCharges }: { sr: ServiceRequest; canModify: boolean; onPatch: PatchFn; canInvoiceFeature: boolean; showCharges: boolean }) {
  const [info, setInfo] = useState<SrInvoiceInfo | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [askReason, setAskReason] = useState<boolean | null>(null)
  const [confirmInvoice, setConfirmInvoice] = useState(false)

  const loadInfo = () => erpApi.getSrInvoice(sr.id).then(setInfo).catch((e) => setErr(extractErrorMessages(e, 'Could not load the invoice details.').join(' ')))
  useEffect(() => { if (SERVICE_BILLING_ENABLED) loadInfo() }, [sr.id, sr.updated_at])  // eslint-disable-line react-hooks/exhaustive-deps

  const createInvoice = async () => {
    setConfirmInvoice(false)
    setBusy(true)
    setErr('')
    try {
      await erpApi.createSrInvoice(sr.id, {})
      await onPatch({})  // reload the SR (invoice no. / billing status)
      await loadInfo()
    } catch (e) {
      setErr(extractErrorMessages(e, 'Could not raise the invoice.').join(' '))
    } finally {
      setBusy(false)
    }
  }
  const status = sr.billing_status || (sr.is_chargeable ? 'to_bill' : 'not_billable')
  const canInvoice = canInvoiceFeature && canModify && sr.is_chargeable && !sr.ar_transaction_id && ['work_completed', 'review', 'closed'].includes((sr.status || '').toLowerCase())
  const inv = info?.invoice
  if (!SERVICE_BILLING_ENABLED) {
    return (
      <Card title="Warranty">
        <InfoRow label="Machine cover (reported date)" value={WARRANTY_LABELS[sr.warranty_status || ''] || sr.warranty_status || 'Not checked'} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5, color: '#78716c' }}>
          Service billing &amp; invoice <Pill label="Upcoming" hex="#FF7A45" />
        </div>
      </Card>
    )
  }
  return (
    <Card title="Warranty & Invoice">
      <InfoRow label="Machine cover (reported date)" value={WARRANTY_LABELS[sr.warranty_status || ''] || sr.warranty_status || 'Not checked'} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0', flexWrap: 'wrap' }}>
        <Pill label={`${sr.is_chargeable ? 'Chargeable' : 'Free of charge'} · ${BILLING_LABELS[status] || status}`} hex={BILLING_HEX[status] || '#78716c'} />
        {canModify && !sr.ar_transaction_id && sr.service_type !== 'warranty' && (
          <button type="button" style={secondaryBtnStyle} disabled={busy} onClick={() => setAskReason(!sr.is_chargeable)}>
            {sr.is_chargeable ? 'Make free of charge' : 'Make chargeable'}
          </button>
        )}
      </div>
      {sr.chargeable_reason && <InfoRow label="Override reason" value={sr.chargeable_reason} />}
      {inv && (
        <>
          <InfoRow label="Invoice" value={`${inv.invoice_number} · ${inv.status === 'pending' ? 'Draft — Finance approves & posts it' : inv.status.replace(/_/g, ' ')}`} />
          {showCharges && <>
          <InfoRow label="Taxable value" value={inr(inv.taxable_amount)} />
          <InfoRow label={inv.is_interstate ? 'IGST' : 'CGST + SGST'} value={inv.is_interstate ? inr(inv.igst_amount) : `${inr(inv.cgst_amount)} + ${inr(inv.sgst_amount)}`} />
          <InfoRow label="Invoice total" value={inr(inv.total_amount)} />
          <InfoRow label="Amount due" value={`${inr(inv.amount_due)} (${inv.collection_status.replace(/_/g, ' ')})`} />
          </>}
        </>
      )}
      {showCharges && !inv && sr.is_chargeable && info?.preview_lines && (
        <div style={{ fontSize: 12, color: '#57534e', margin: '6px 0' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Invoice will carry:</div>
          {info.preview_lines.map((l, i) => (
            <div key={i}>{l.description} — HSN/SAC {l.hsn_sac_code} · {l.quantity} × {inr(l.rate)} · GST {l.gst_rate}%</div>
          ))}
        </div>
      )}
      {!inv && sr.is_chargeable && info?.problem && <p style={{ fontSize: 12, color: '#b45309', margin: '6px 0' }}>{info.problem}</p>}
      {canInvoice && (
        <button type="button" onClick={() => setConfirmInvoice(true)} disabled={busy} style={{ ...primaryBtnStyle, marginTop: 8, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Raising…' : 'Create invoice'}
        </button>
      )}
      {sr.is_chargeable && !sr.ar_transaction_id && !canInvoice && canModify && (
        <p style={{ fontSize: 11.5, color: '#a8a29e', margin: '6px 0 0' }}>The invoice can be raised once the work is completed (Work Completed / Review / Closed).</p>
      )}
      {err && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '8px 0 0' }}>{err}</p>}
      <ReasonSheet
        open={askReason !== null}
        icon="rupee"
        title={askReason ? 'Make this job chargeable' : 'Make this job free of charge'}
        message="This differs from what the machine's warranty cover gives by default. Enter the reason — it is kept in the audit trail."
        placeholder="Reason"
        requireValue
        danger={false}
        confirmLabel="Save"
        onCancel={() => setAskReason(null)}
        onConfirm={async (reason) => {
          const want = askReason
          setAskReason(null)
          await onPatch({ is_chargeable: want, chargeable_reason: reason })
        }}
      />
      <ConfirmDialog
        open={confirmInvoice}
        title="Create the service invoice?"
        message="A draft GST sales invoice is created in Finance for this SR's charges and chargeable spares. Finance approves it, which numbers and posts it."
        confirmLabel="Create invoice"
        danger={false}
        onConfirm={createInvoice}
        onCancel={() => setConfirmInvoice(false)}
      />
    </Card>
  )
}

function BillingCard({ sr, canModify, onPatch, showCharges }: { sr: ServiceRequest; canModify: boolean; onPatch: PatchFn; showCharges: boolean }) {
  const initial = useMemo(() => ({
    actual_date_attended: sr.actual_date_attended || '',
    actual_completion_date: sr.actual_completion_date || '',
    service_cost: String(sr.service_cost ?? 0),
    transport_cost: String(sr.transport_cost ?? 0),
    accommodation_cost: String(sr.accommodation_cost ?? 0),
    miscellaneous_cost: String(sr.miscellaneous_cost ?? 0),
    tax_percentage: String(sr.tax_percentage ?? 0),
  }), [sr])
  const [form, setForm] = useState(initial)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState<string[]>([])
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k] !== initial[k])
  const set = (k: keyof typeof initial, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const title = SERVICE_BILLING_ENABLED ? 'Execution & Billing' : 'Execution'

  const openEdit = () => { setForm(initial); setLocalError([]); setOpen(true) }

  const save = async () => {
    setLocalError([])
    const payload: Record<string, unknown> = {
      actual_date_attended: form.actual_date_attended || null,
      actual_completion_date: form.actual_completion_date || null,
    }
    // Charges are only sent by users who may see them (erp:service_requests.charges:view).
    for (const f of SERVICE_BILLING_ENABLED && showCharges ? COST_FIELDS : []) {
      const raw = form[f.key].trim()
      const n = raw === '' ? 0 : Number(raw)
      if (Number.isNaN(n) || n < 0) { setLocalError([`${f.label.replace(' (₹)', '')} must be a number of 0 or more.`]); return }
      payload[f.key] = n
    }
    const tax = Number(form.tax_percentage.trim())
    if (SERVICE_BILLING_ENABLED && (form.tax_percentage.trim() === '' || Number.isNaN(tax) || tax < 0 || tax > 100)) {
      setLocalError(['Tax % must be a number between 0 and 100 — enter 0 if the job is not taxed.'])
      return
    }
    if (SERVICE_BILLING_ENABLED) payload.tax_percentage = tax
    if (form.actual_date_attended && form.actual_completion_date && form.actual_completion_date < form.actual_date_attended) {
      setLocalError(['Actual Completed date is before the Actual Attended date — correct one of them.'])
      return
    }
    setSaving(true)
    try {
      if (await onPatch(payload, setLocalError)) setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title={title}>
      <div data-tour="erp-srd-billing">
        <InfoRow label="Actual Attended" value={sr.actual_date_attended ? formatDate(sr.actual_date_attended) : 'Not recorded'} />
        <InfoRow label="Actual Completed" value={sr.actual_completion_date ? formatDate(sr.actual_completion_date) : 'Not recorded'} />
        {SERVICE_BILLING_ENABLED && showCharges && COST_FIELDS.map((f) => (
          <InfoRow key={f.key} label={f.label.replace(' (₹)', '')} value={inr(Number(sr[f.key] ?? 0))} />
        ))}
        {SERVICE_BILLING_ENABLED && <InfoRow label="Tax %" value={`${sr.tax_percentage ?? 0}%`} />}
      </div>
      {SERVICE_BILLING_ENABLED ? (
        <>
          <InfoRow label="Invoice Number" value={sr.invoice_number || 'Not invoiced'} />
          <InfoRow label="Payment Status" value={PAYMENT_STATUS_OPTIONS.find((o) => o.value === sr.payment_status)?.label || sr.payment_status || 'Not set'} />
          {showCharges && <>
          <InfoRow label="Material Cost" value={inr(sr.total_material_cost)} />
          <InfoRow label="Tax Amount" value={inr(sr.tax_amount)} />
          <InfoRow label="Total Bill" value={inr(sr.total_bill)} />
          </>}
          <p style={{ fontSize: 11.5, color: '#a8a29e', margin: '6px 0 0' }}>
            Material cost = spares consumed (issued − returned) × unit price, excluding warranty-covered lines; free-text lines use their
            estimated budget. Invoice no. and payment status come from the Finance sales invoice. Totals update when you save.
          </p>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12.5, color: '#78716c' }}>
          Service charges, tax &amp; invoice <Pill label="Upcoming" hex="#FF7A45" />
        </div>
      )}
      {!canModify && sr.is_locked && <p style={{ fontSize: 12, color: '#78716c', margin: '6px 0 0' }}>This service request is locked — ask an admin to unlock it to change billing.</p>}
      {canModify && (
        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={openEdit} data-tour="erp-srd-billing-edit-btn" style={sheetBtn('secondary', SHEET.INK)}>
            <SheetIcon name="edit" size={14} />{SERVICE_BILLING_ENABLED ? 'Edit execution & billing' : 'Edit execution dates'}
          </button>
        </div>
      )}

      {open && (
        <FormSheet width={SERVICE_BILLING_ENABLED ? 720 : 580} icon="calendar" title={title} subtitle={`${sr.request_number} — when the engineer attended and finished${SERVICE_BILLING_ENABLED ? ', and the job charges' : ''}.`}
          onClose={() => setOpen(false)} busy={saving}
          footer={<>
            <button type="button" onClick={() => setOpen(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="button" onClick={save} disabled={!dirty || saving} data-tour="erp-srd-billing-save-btn" style={sheetBtn('primary', SHEET.BLUE, !dirty || saving)}>
              <SheetIcon name="check" size={16} />{saving ? 'Saving…' : SERVICE_BILLING_ENABLED ? 'Save Billing' : 'Save'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {localError.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{localError.join(' ')}</div>
            )}
            <SheetSection icon="calendar" title="Execution">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 160px', maxWidth: 220 }}>
                  <label style={sheetLabel}>Actual Attended</label>
                  <DateField value={form.actual_date_attended} onChange={(v) => set('actual_date_attended', v)} />
                </div>
                <div style={{ flex: '1 1 160px', maxWidth: 220 }}>
                  <label style={sheetLabel}>Actual Completed</label>
                  <DateField value={form.actual_completion_date} onChange={(v) => set('actual_completion_date', v)} />
                </div>
              </div>
            </SheetSection>
            {SERVICE_BILLING_ENABLED && showCharges && (
              <SheetSection icon="rupee" title="Charges">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {COST_FIELDS.map((f) => (
                    <div key={f.key} style={{ flex: '1 1 150px', maxWidth: 200 }}>
                      <label style={sheetLabel}>{f.label}</label>
                      <input type="number" min={0} step="0.01" value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} style={sheetInput} />
                    </div>
                  ))}
                  <div style={{ flex: '0 1 110px' }}>
                    <label style={sheetLabel}>Tax % <Req /></label>
                    <input type="number" min={0} max={100} step="0.01" value={form.tax_percentage} onChange={(e) => set('tax_percentage', e.target.value)} style={sheetInput} />
                  </div>
                </div>
                <p style={sheetHint}>Material cost, tax amount and the total bill are recalculated when you save.</p>
              </SheetSection>
            )}
          </div>
        </FormSheet>
      )}
    </Card>
  )
}

function RcaTab({ sr, canModify, onPatch }: { sr: ServiceRequest; canModify: boolean; onPatch: PatchFn }) {
  const [rootCause, setRootCause] = useState(sr.root_cause || '')
  const [correctiveAction, setCorrectiveAction] = useState(sr.resolution_description || '')
  const [preventiveActions, setPreventiveActions] = useState(sr.preventive_actions || '')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rcaError, setRcaError] = useState<string[]>([])

  const dirty =
    rootCause !== (sr.root_cause || '') ||
    correctiveAction !== (sr.resolution_description || '') ||
    preventiveActions !== (sr.preventive_actions || '')

  const openEdit = () => {
    setRootCause(sr.root_cause || '')
    setCorrectiveAction(sr.resolution_description || '')
    setPreventiveActions(sr.preventive_actions || '')
    setRcaError([])
    setOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const ok = await onPatch({
        root_cause: rootCause,
        resolution_description: correctiveAction,
        preventive_actions: preventiveActions,
      }, setRcaError)
      if (ok) setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const area = { ...sheetInput, minHeight: 80, resize: 'vertical' as const, textTransform: 'none' as const }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Root Cause Analysis">
        <div data-tour="erp-srd-root-cause"><InfoRow label="Root Cause" value={sr.root_cause || 'Not recorded'} /></div>
        <div data-tour="erp-srd-corrective"><InfoRow label="Corrective Action" value={sr.resolution_description || 'Not recorded'} /></div>
        <div data-tour="erp-srd-preventive"><InfoRow label="Preventive Recommendation" value={sr.preventive_actions || 'Not recorded'} /></div>
        {canModify && (
          <div style={{ marginTop: 10 }}>
            <button type="button" onClick={openEdit} data-tour="erp-srd-rca-edit-btn" style={sheetBtn('secondary', SHEET.INK)}>
              <SheetIcon name="edit" size={14} />Edit RCA
            </button>
          </div>
        )}
      </Card>

      {open && (
        <FormSheet width={720} icon="search" title="Root Cause Analysis" subtitle={`${sr.request_number} — what really caused the fault and what was done about it.`}
          onClose={() => setOpen(false)} busy={saving}
          footer={<>
            <button type="button" onClick={() => setOpen(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="button" onClick={save} disabled={!dirty || saving} data-tour="erp-srd-rca-save-btn" style={sheetBtn('primary', SHEET.BLUE, !dirty || saving)}>
              <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save RCA'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {rcaError.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{rcaError.join(' ')}</div>
            )}
            <SheetSection icon="search" title="Diagnosis">
              <label style={sheetLabel}>Root Cause</label>
              <textarea value={rootCause} onChange={(e) => setRootCause(e.target.value)} rows={3} style={area} autoFocus
                placeholder="The underlying reason the fault happened, not just the symptom" />
            </SheetSection>
            <SheetSection icon="tool" title="Actions">
              <label style={sheetLabel}>Corrective Action</label>
              <textarea value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} rows={3} style={area}
                placeholder="What was done on this machine to fix it" />
              <p style={sheetHint}>Needed before the service request can be Closed.</p>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Preventive Recommendation</label>
              <textarea value={preventiveActions} onChange={(e) => setPreventiveActions(e.target.value)} rows={3} style={area}
                placeholder="What should change so it never happens again" />
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}

const MATERIAL_STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  issued: { bg: '#16a34a', fg: '#fff', label: 'Issued' },
  returned: { bg: '#64748b', fg: '#fff', label: 'Returned' },
  pending: { bg: '#d97706', fg: '#fff', label: 'Pending' },
}

const PR_STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  submitted: { bg: '#3b82f61a', fg: '#3b82f6', label: 'Submitted' },
  approved: { bg: '#8b5cf61a', fg: '#8b5cf6', label: 'Approved' },
  po_raised: { bg: '#f59e0b1a', fg: '#f59e0b', label: 'PO Raised' },
  partially_received: { bg: '#d977061a', fg: '#d97706', label: 'Partially Received' },
  received: { bg: '#0ea5e91a', fg: '#0ea5e9', label: 'Received' },
  closed: { bg: '#22c55e1a', fg: '#22c55e', label: 'Closed' },
  rejected: { bg: '#dc26261a', fg: '#dc2626', label: 'Rejected' },
  cancelled: { bg: '#94a3b81a', fg: '#94a3b8', label: 'Cancelled' },
}


function MaterialsTab({ srId, canEdit, canAdd, canDelete, canRaisePr, canIssueSpares, canReturnSpares }: {
  srId: number; canEdit: boolean; canAdd: boolean; canDelete: boolean; canRaisePr: boolean
  canIssueSpares: boolean; canReturnSpares: boolean
}) {
  const [materials, setMaterials] = useState<ServiceRequest['materials']>([])
  const [loading, setLoading] = useState(true)
  // Material Request: the engineer only picks items + qty. The server checks
  // store stock and splits each line — what's in store becomes a spare that
  // Store issues on a challan, the shortfall an approved PR to Purchase
  // (Project line, requirement type Service — nothing for the user to choose).
  const [requiredDate, setRequiredDate] = useState('')
  const [priority, setPriority] = useState('medium')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<{ itemId: string; qty: string }[]>([{ itemId: '', qty: '1' }])
  const [stock, setStock] = useState<Record<string, number>>({})
  // Go on the PR when one is raised; if everything comes from store, onto this SR's Attachments.
  const [supportingFiles, setSupportingFiles] = useState<File[]>([])
  const [specFiles, setSpecFiles] = useState<File[]>([])
  const [fileInputKey, setFileInputKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [prMessage, setPrMessage] = useState('')
  const [prError, setPrError] = useState('')
  const [requestOpen, setRequestOpen] = useState(false)
  const [receiveInputs, setReceiveInputs] = useState<Record<number, string>>({})
  const [savingReceive, setSavingReceive] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [materialsError, setMaterialsError] = useState('')
  const [masterItems, setMasterItems] = useState<StoreItem[]>([])
  const [loadingMaster, setLoadingMaster] = useState(false)
  // Spares from Store: Store users (Material Issues › Create) issue / take back.
  const { can } = useCan()
  // …and the SR's Issue / return spares feature (erp:service_requests.spare_issue).
  const canIssue = can('store', 'issues', 'create') && canIssueSpares
  const canReturn = can('store', 'issues', 'create') && canReturnSpares
  const [issuing, setIssuing] = useState<ServiceMaterial | null>(null)
  const [returning, setReturning] = useState<ServiceMaterial | null>(null)
  const masterById = useMemo(() => new Map(masterItems.map((i) => [i.id, i])), [masterItems])
  const loadMasterItems = async () => {
    setLoadingMaster(true)
    try {
      setMasterItems(await storeApi.listItems({ status: 'active' }))
    } catch (err) {
      setPrError(extractErrorMessages(err, 'Could not load the Item Master list.').join(' '))
    } finally {
      setLoadingMaster(false)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      setMaterials(await erpApi.listMaterials(srId))
    } catch (err) {
      setMaterialsError(extractErrorMessages(err, 'Could not load the materials list — check your connection and reload the page.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srId])

  useEffect(() => {
    if (!canRaisePr && !canAdd) return
    loadMasterItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRaisePr, canAdd])

  // Live store stock for the picked items (refreshed whenever the picks change).
  const pickedKey = Array.from(new Set(lines.map((l) => l.itemId).filter(Boolean))).join(',')
  useEffect(() => {
    if (!requestOpen || !pickedKey) return
    erpApi.materialRequestStock(srId, pickedKey.split(',').map(Number))
      .then((s) => setStock((prev) => ({ ...prev, ...s })))
      .catch(() => {})
  }, [requestOpen, pickedKey, srId])

  // Preview of how each line will be filled — the same item on two lines shares one stock.
  const usedStock: Record<string, number> = {}
  const linePlan = lines.map((l) => {
    const avail = l.itemId ? stock[l.itemId] : undefined
    const q = Math.max(Number(l.qty) || 0, 0)
    const left = Math.max((avail ?? 0) - (usedStock[l.itemId] || 0), 0)
    const fromStore = avail === undefined ? 0 : Math.min(q, left)
    if (l.itemId) usedStock[l.itemId] = (usedStock[l.itemId] || 0) + fromStore
    return { avail, fromStore, buy: q - fromStore }
  })
  const setLine = (idx: number, patch: Partial<{ itemId: string; qty: string }>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))

  const [pendingRemove, setPendingRemove] = useState<{ id: number; name: string } | null>(null)

  const removeMaterial = async (matId: number) => {
    setMaterialsError('')
    try {
      await erpApi.deleteMaterial(srId, matId)
      load()
    } catch (err: any) {
      setMaterialsError(extractErrorMessages(err, 'Could not remove the material — check that you are the creator with delete permission and the service request is not locked, then try again.').join(' '))
    }
  }

  const submitRequest = async () => {
    setPrError('')
    setPrMessage('')
    const picked = lines.filter((l) => l.itemId)
    if (!picked.length) { setPrError('Pick at least one item from the Item Master. If it\'s a new part, add it first in Store › Item Master, then click "refresh items".'); return }
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].itemId) continue
      if (!(Number(lines[i].qty) > 0)) {
        const m = masterById.get(Number(lines[i].itemId))
        setPrError(`Line ${i + 1} (${m ? `${m.item_code} ${m.item_name}` : 'item'}): quantity must be more than 0.`)
        return
      }
    }
    setSubmitting(true)
    try {
      const r = await erpApi.materialRequest(srId, {
        items: picked.map((l) => ({ store_item_id: Number(l.itemId), quantity: Number(l.qty) })),
        required_by_date: requiredDate || undefined,
        priority,
        remarks: remarks.trim() || undefined,
      })
      const parts: string[] = []
      if (r.from_store.length) parts.push(`${r.from_store.length} item(s) booked from store stock — Store issues them to site`)
      if (r.pr_number) parts.push(`purchase requisition ${r.pr_number} raised for what isn't in store — Purchase has been notified`)
      const uploadFailures: string[] = []
      for (const [files, doc] of [[supportingFiles, 'supporting'], [specFiles, 'specification']] as const) {
        if (!files.length) continue
        try {
          if (r.pr_id) await erpApi.uploadPrAttachments(srId, r.pr_id, files, doc)
          else await erpApi.uploadAttachments(srId, files)
        } catch (err) {
          uploadFailures.push(`${doc} documents: ${extractErrorMessages(err, 'upload failed').join(' ')}`)
        }
      }
      if (!r.pr_id && (supportingFiles.length || specFiles.length) && !uploadFailures.length) parts.push('documents saved in this SR\'s Attachments tab')
      setPrMessage(`Material requested: ${parts.join('; ')}.`)
      setLines([{ itemId: '', qty: '1' }]); setRequiredDate(''); setPriority('medium'); setRemarks('')
      setSupportingFiles([]); setSpecFiles([]); setFileInputKey((k) => k + 1)
      if (uploadFailures.length) {
        setPrError(`Material was requested, but some files did not upload — ${uploadFailures.join('; ')}. ${r.pr_id ? `Ask Purchase to attach them on ${r.pr_number}.` : 'Upload them in this SR\'s Attachments tab.'}`)
      } else setRequestOpen(false)
    } catch (err) {
      // The server may have committed even if the response was lost — the list is reloaded below either way.
      setPrError(extractErrorMessages(err, 'Could not submit the material request — check your connection; the materials list below has been refreshed.').join(' '))
    } finally {
      setSubmitting(false)
      load()
    }
  }

  const saveReceive = async (matId: number, maxQty: number) => {
    const raw = receiveInputs[matId]
    const qty = Math.max(0, Math.min(Number(raw), maxQty))
    if (Number.isNaN(qty)) return
    setSavingReceive(matId)
    setMaterialsError('')
    try {
      await erpApi.receiveMaterial(srId, matId, qty)
      setReceiveInputs((prev) => { const next = { ...prev }; delete next[matId]; return next })
      load()
    } catch (err) {
      setMaterialsError(extractErrorMessages(err, 'Could not mark the material received — check that you are the creator with edit permission and the service request is not locked, then try again.').join(' '))
    } finally {
      setSavingReceive(null)
    }
  }



  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {materialsError && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: 0 }}>{materialsError}</p>}
      {(canRaisePr || canAdd) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: prMessage ? '#047857' : '#78716c', fontWeight: prMessage ? 600 : 400 }}>
            {prMessage || 'Need a part for this job? Raise a material request — store stock is checked for you.'}
          </span>
          <button type="button" data-tour="erp-srd-material-request-btn" style={sheetBtn('primary', SHEET.BLUE)}
            onClick={() => { setPrError(''); setPrMessage(''); setRequestOpen(true) }}>
            <SheetIcon name="plus" size={16} />Material Request
          </button>
        </div>
      )}

      {requestOpen && (
        <FormSheet icon="cart" title="Material Request" tour="erp-srd-pr-form" busy={submitting} onClose={() => setRequestOpen(false)}
          subtitle="Pick the parts and how many. Store stock is checked automatically — what's in store is issued by Store, the rest goes to Purchase."
          footer={<>
            {prError && <span style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600, marginRight: 'auto' }}>{prError}</span>}
            <button type="button" style={sheetBtn('secondary')} disabled={submitting} onClick={() => setRequestOpen(false)}>Cancel</button>
            <button type="button" data-tour="erp-srd-pr-submit-btn" onClick={submitRequest} disabled={submitting} style={sheetBtn('primary', SHEET.BLUE, submitting)}>
              <SheetIcon name="send" size={16} />{submitting ? 'Submitting…' : 'Request Material'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
          <SheetSection icon="box" title="Items"
            extra={<button type="button" data-tour="erp-srd-pr-add-item-btn" onClick={() => setLines((prev) => [...prev, { itemId: '', qty: '1' }])} style={{ ...sheetBtn('ghost'), marginLeft: 'auto' }}><SheetIcon name="plus" size={14} />Add Item</button>}>
            <div style={{ overflowX: 'auto' }}>
              <table data-tour="erp-srd-pr-items" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr>
                    {['SL', 'Item (from Item Master) *', 'Qty *', 'In store', 'Will be', ''].map((h, hi) => (
                      <th key={h} style={{ textAlign: 'left', padding: '0 8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap' }}>{h}{hi === 0 && <RowCount count={lines.length} />}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const m = line.itemId ? masterById.get(Number(line.itemId)) : undefined
                    const plan = linePlan[idx]
                    const uom = m?.uom || ''
                    return (
                    <tr key={idx}>
                      <td style={{ padding: '6px 8px', fontSize: 12.5, fontWeight: 600, color: '#a8a29e' }}>{idx + 1}</td>
                      <td style={{ padding: '6px 8px', minWidth: 300 }}>
                        <SearchableSelect
                          value={line.itemId}
                          onChange={(v) => setLine(idx, { itemId: v })}
                          options={masterItems.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}${i.part_number ? ` · ${i.part_number}` : ''}` }))}
                          placeholder={loadingMaster ? 'Loading items…' : 'Search item code, name or part no…'}
                        />
                      </td>
                      <td style={{ padding: '6px 8px', width: 130 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="number" min={0} step="0.01" style={inputStyle} value={line.qty} onChange={(e) => setLine(idx, { qty: e.target.value })} />
                          {uom && <span style={{ fontSize: 12, color: '#78716c' }}>{uom}</span>}
                        </div>
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>
                        {!line.itemId ? '—' : plan.avail === undefined ? 'Checking…' : `${plan.avail} ${uom}`}
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {!line.itemId || plan.avail === undefined ? <span style={{ color: '#a8a29e' }}>—</span>
                          : plan.buy <= 0 ? <span style={{ color: '#047857' }}>From store</span>
                          : plan.fromStore <= 0 ? <span style={{ color: '#b45309' }}>Buy — goes to Purchase</span>
                          : <span style={{ color: '#b45309' }}>{plan.fromStore} from store + {plan.buy} to buy</span>}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        {lines.length > 1 && (
                          <button type="button" aria-label={`Remove material line ${idx + 1}`} onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} style={{ fontSize: 11.5, fontWeight: 600, color: '#B91C1C', cursor: 'pointer', whiteSpace: 'nowrap', background: 'none', border: 'none', padding: '4px 2px', minHeight: 24, fontFamily: 'inherit' }}>Remove</button>
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: '#78716c', margin: '8px 0 0' }}>
              Part not in the list? Add it in{' '}
              <a href="/dashboard/store/new" target="_blank" rel="noopener noreferrer" style={{ color: '#c2410c', fontWeight: 600 }}>Store › Item Master</a>
              {' '}(opens in a new tab), then{' '}
              {/* ui-audit-ignore-next-line adhoc-button — inline text link inside a sentence */}
              <button type="button" onClick={loadMasterItems} disabled={loadingMaster} style={{ border: 'none', background: 'none', padding: 0, color: '#c2410c', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                {loadingMaster ? 'refreshing…' : 'refresh items'}
              </button>.
            </p>
          </SheetSection>

          <SheetSection icon="flag" title="Details">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}>
              <label style={sheetLabel}>Required Date</label>
              <div data-tour="erp-srd-pr-required-date"><DateField value={requiredDate} onChange={setRequiredDate} /></div>
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 140 }}>
              <label style={sheetLabel}>Priority</label>
              <Select style={sheetInput} value={priority} onChange={(e) => setPriority(e.target.value)} data-tour="erp-srd-pr-priority">
                {['low', 'medium', 'high'].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </Select>
            </div>
            <div style={{ flex: '1 1 300px' }}>
              <label style={sheetLabel}>Remarks <Optional /></label>
              <textarea data-tour="erp-srd-pr-remarks" style={{ ...sheetInput, minHeight: 42 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>
          </SheetSection>

          <SheetSection icon="clip" title="Attachments" extra={<Optional />}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ flex: '0 1 280px', minWidth: 240 }}>
              <label style={sheetLabel}>Supporting Documents</label>
              <input key={`sup-${fileInputKey}`} data-tour="erp-srd-pr-supporting" type="file" multiple onChange={(e) => setSupportingFiles(Array.from(e.target.files || []))} style={sheetInput} />
            </div>
            <div style={{ flex: '0 1 280px', minWidth: 240 }}>
              <label style={sheetLabel}>Specification / Reference File</label>
              <input key={`spec-${fileInputKey}`} data-tour="erp-srd-pr-spec" type="file" multiple onChange={(e) => setSpecFiles(Array.from(e.target.files || []))} style={sheetInput} />
            </div>
          </div>
          <p style={sheetHint}>Attached to the purchase requisition for Purchase. If everything comes from store, they are saved in this SR&apos;s Attachments tab.</p>
          </SheetSection>
          </div>
        </FormSheet>
      )}
      <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table data-tour="erp-srd-materials-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['Material', 'Photos', 'Part No.', 'Qty', 'Status', 'PR', 'Received', 'From Store', ''].map((h, hi) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}{hi === 0 && <RowCount count={materials.length} />}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && materials.length === 0 && <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No materials added.</td></tr>}
            {materials.map((m) => {
              const statusBadge = MATERIAL_STATUS_BADGE[m.status || 'pending'] || MATERIAL_STATUS_BADGE.pending
              const prBadge = m.pr_status ? (PR_STATUS_BADGE[m.pr_status] || PR_STATUS_BADGE.submitted) : null
              const canReceive = canEdit && !!m.pr_id && m.receiving_status !== 'received'
              const isExpanded = expandedId === m.id
              return (
              <Fragment key={m.id}>
              <tr style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '10px 14px', fontSize: 13 }}>
                  {m.material_name}
                  {m.description && (
                    <div style={{ fontSize: 11, color: '#a8a29e', marginTop: 2 }}>{m.description}</div>
                  )}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : m.id)}
                    style={smallSecondaryBtnStyle}
                  >
                    Photos ({m.attachments?.length || 0}) {isExpanded ? '▴' : '▾'}
                  </button>
                </td>
                <td style={{ padding: '10px 14px', fontSize: 13, color: '#78716c' }}>{m.part_number || 'Not provided'}</td>
                <td style={{ padding: '10px 14px', fontSize: 13 }}>{m.quantity}</td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: statusBadge.bg, color: statusBadge.fg }}>
                    {statusBadge.label}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                  {prBadge ? (
                    <Link href={recordPath('/dashboard/p2p', m, 'pr_id')} style={{ textDecoration: 'none' }}>
                      <span title={m.pr_number} style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: prBadge.bg, color: prBadge.fg }}>
                        {m.pr_number} · {prBadge.label}
                      </span>
                    </Link>
                  ) : (
                    <span style={{ fontSize: 12, color: '#a8a29e' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                  {canReceive ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="number"
                        min={0}
                        max={m.quantity}
                        step="0.01"
                        placeholder={`${m.received_quantity}/${m.quantity}`}
                        value={receiveInputs[m.id] ?? ''}
                        onChange={(e) => setReceiveInputs((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        style={{ ...inputStyle, width: 70, padding: '5px 8px' }}
                      />
                      <button
                        onClick={() => saveReceive(m.id, m.quantity)}
                        disabled={savingReceive === m.id || receiveInputs[m.id] === undefined || receiveInputs[m.id] === ''}
                        style={{ ...smallPrimaryBtnStyle, opacity: savingReceive === m.id ? 0.6 : 1 }}
                      >
                        {savingReceive === m.id ? '…' : 'Mark'}
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 600, color: m.receiving_status === 'received' ? '#16a34a' : '#78716c' }}>
                      {m.received_quantity}/{m.quantity}{m.receiving_status === 'received' ? ' ✓' : ''}
                    </span>
                  )}
                </td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                  {m.store_item_id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 12, color: '#57534e' }}>
                        Issued {m.qty_issued || 0}{m.qty_returned ? ` · returned ${m.qty_returned}` : ''}
                        {m.unit_price != null ? ` · ₹${m.unit_price}/${m.unit}` : ''}
                        {m.is_warranty_covered ? ' · warranty' : ''}
                      </span>
                      {(canIssue || canReturn) && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {canIssue && <button onClick={() => setIssuing(m)} style={{ ...smallPrimaryBtnStyle }}>Issue</button>}
                          {canReturn && (m.net_issued || 0) > 0 && (
                            <button onClick={() => setReturning(m)} style={{ ...smallSecondaryBtnStyle }}>Return</button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : <span style={{ fontSize: 12, color: '#a8a29e' }}>—</span>}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  {canDelete && !(m.qty_issued || 0) && (
                    <button onClick={() => setPendingRemove({ id: m.id, name: m.material_name })} style={{ ...smallDangerBtnStyle }}>Remove</button>
                  )}
                </td>
              </tr>
              {isExpanded && (
                <tr>
                  <td colSpan={9} style={{ padding: '0 14px 14px' }}>
                    <MaterialPhotoGallery srId={srId} material={m} canEdit={canAdd} canDelete={canDelete} onChanged={load} />
                  </td>
                </tr>
              )}
              </Fragment>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingRemove}
        title="Remove this material?"
        message={pendingRemove ? `Remove "${pendingRemove.name}" from this service request? Its cost is taken out of the bill total.` : ''}
        confirmLabel="Remove"
        onConfirm={() => { const p = pendingRemove; setPendingRemove(null); if (p) removeMaterial(p.id) }}
        onCancel={() => setPendingRemove(null)}
      />
      {issuing && <IssueSpareDialog srId={srId} material={issuing} onClose={() => setIssuing(null)} onDone={() => { setIssuing(null); load() }} />}
      {returning && <ReturnSpareDialog srId={srId} material={returning} onClose={() => setReturning(null)} onDone={() => { setReturning(null); load() }} />}
    </div>
  )
}

function MaterialPhotoGallery({ srId, material, canEdit, canDelete, onChanged }: { srId: number; material: ServiceMaterial; canEdit: boolean; canDelete: boolean; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [error, setError] = useState('')
  const [staged, setStaged] = useState<File[]>([])

  const stageFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    setStaged((prev) => [...prev, ...Array.from(files)])
  }

  const confirmUpload = async () => {
    if (staged.length === 0) return
    setUploading(true)
    setError('')
    try {
      await erpApi.uploadMaterialAttachments(srId, material.id, staged)
      setStaged([])
      onChanged()
    } catch (err: any) {
      setError(extractErrorMessages(err, `Could not upload photos to "${material.material_name}" — only JPG/PNG images are accepted; check your connection and try again.`).join(' '))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const [pendingPhoto, setPendingPhoto] = useState<{ id: number; filename: string } | null>(null)

  const handleDelete = async (attachmentId: number) => {
    setError('')
    try {
      await erpApi.deleteMaterialAttachment(srId, material.id, attachmentId)
      onChanged()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Could not delete the photo — check that you are the creator with delete permission and the service request is not locked, then try again.').join(' '))
    }
  }

  return (
    <div style={{ borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {showCamera && (
        <CameraCapture onCapture={(file) => stageFiles([file])} onClose={() => setShowCamera(false)} />
      )}
      {canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => !uploading && setShowCamera(true)}
            disabled={uploading}
            aria-label="Take photo"
            title="Take photo"
            style={{ width: 46, height: 46, flex: 'none', borderRadius: 12, border: '1px solid rgba(0,0,0,0.1)', background: '#faf9f7', fontSize: 19, cursor: uploading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            📷
          </button>

          <button
            type="button"
            onClick={() => !uploading && fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); stageFiles(e.dataTransfer.files) }}
            disabled={uploading}
            aria-label="Browse photos"
            title="Browse photos, or drag &amp; drop here"
            style={{ width: 46, height: 46, flex: 'none', borderRadius: 12, border: `1px solid ${dragOver ? '#FF7A45' : 'rgba(0,0,0,0.1)'}`, background: dragOver ? 'rgba(244,113,59,0.08)' : '#faf9f7', fontSize: 19, cursor: uploading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            🖼️
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => stageFiles(e.target.files)} disabled={uploading} />
          <p style={{ fontSize: 11.5, color: '#a8a29e', margin: 0 }}>
            {uploading ? 'Uploading…' : 'Take a photo, or browse / drag & drop (JPG/PNG)'}
          </p>
        </div>
      )}

      <FileUploadPreview
        files={staged}
        uploading={uploading}
        onRemove={(i) => setStaged((prev) => prev.filter((_, idx) => idx !== i))}
        onConfirm={confirmUpload}
        onCancel={() => { setStaged([]); if (fileRef.current) fileRef.current.value = '' }}
      />

      {error && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: 0 }}>{error}</p>}

      {(!material.attachments || material.attachments.length === 0) ? (
        <p style={{ fontSize: 12.5, color: '#a8a29e', margin: 0 }}>No photos added yet.</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {material.attachments.map((a) => (
            <div key={a.id} style={{ position: 'relative', width: 64, height: 64, flex: 'none' }}>
              <MaterialPhotoThumb srId={srId} matId={material.id} attachment={a} />
              {canDelete && (
                // ui-audit-ignore-next-line custom-button — 20px round delete badge overlaid on a photo thumbnail, not a pill
                <button
                  onClick={() => setPendingPhoto({ id: a.id, filename: a.filename })}
                  aria-label={`Delete ${a.filename}`}
                  style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#dc2626', color: '#fff', fontSize: 12, lineHeight: '20px', cursor: 'pointer', padding: 0 }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingPhoto}
        title="Delete this photo?"
        message={pendingPhoto ? `Delete photo "${pendingPhoto.filename}" from material "${material.material_name}"? The file is also removed from SharePoint and can't be restored.` : ''}
        confirmLabel="Delete"
        onConfirm={() => { const p = pendingPhoto; setPendingPhoto(null); if (p) handleDelete(p.id) }}
        onCancel={() => setPendingPhoto(null)}
      />
    </div>
  )
}

function AttachmentsTab({ sr, canEdit, canDelete, onRefresh }: { sr: ServiceRequest; canEdit: boolean; canDelete: boolean; onRefresh: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const [staged, setStaged] = useState<File[]>([])

  const stageFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    setStaged((prev) => [...prev, ...Array.from(files)])
  }

  const confirmUpload = async () => {
    if (staged.length === 0) return
    setUploading(true)
    setError('')
    try {
      await erpApi.uploadAttachments(sr.id, staged)
      setStaged([])
      onRefresh()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Could not upload the files — check your connection and file size, then try again.').join(' '))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const [pendingDelete, setPendingDelete] = useState<{ id: number; filename: string } | null>(null)

  const handleDelete = async (attachmentId: number) => {
    setError('')
    try {
      await erpApi.deleteAttachment(sr.id, attachmentId)
      onRefresh()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Could not delete the attachment — check that you are the creator with delete permission and the service request is not locked, then try again.').join(' '))
    }
  }

  return (
    <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Paperclip size={15} color="#78716c" />
          <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#57534e' }}>Attachments &amp; Documents</span>
        </div>
        <span style={{ fontSize: 12, color: '#a8a29e' }}>{sr.attachments.length} file(s)</span>
      </div>

      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {canEdit && (
          <div
            data-tour="erp-srd-attach-dropzone"
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

        <FileUploadPreview
          files={staged}
          uploading={uploading}
          onRemove={(i) => setStaged((prev) => prev.filter((_, idx) => idx !== i))}
          onConfirm={confirmUpload}
          onCancel={() => { setStaged([]); if (fileRef.current) fileRef.current.value = '' }}
        />

        {error && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: 0 }}>{error}</p>}

        {sr.attachments.length === 0 ? (
          <p style={{ fontSize: 13, color: '#a8a29e', margin: 0 }}>No attachments uploaded.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sr.attachments.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); openAttachmentBlob(() => erpApi.getAttachmentBlob(sr.id, a.id), a.filename) }}
                  style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}
                >
                  {a.filename}
                </a>
                {canDelete && (
                  <button onClick={() => setPendingDelete({ id: a.id, filename: a.filename })} style={{ ...smallDangerBtnStyle }}>Delete</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this attachment?"
        message={pendingDelete ? `Delete "${pendingDelete.filename}" from ${sr.request_number}? The file is also removed from SharePoint and can't be restored.` : ''}
        confirmLabel="Delete"
        onConfirm={() => { const p = pendingDelete; setPendingDelete(null); if (p) handleDelete(p.id) }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function MaterialPhotoThumb({ srId, matId, attachment }: { srId: number; matId: number; attachment: ServiceMaterialAttachment }) {
  const fetchBlob = useMemo(
    () => () => erpApi.getMaterialAttachmentBlob(srId, matId, attachment.id),
    [srId, matId, attachment.id]
  )
  const src = useAttachmentBlobUrl(fetchBlob)
  return (
    <a href="#" onClick={(e) => { e.preventDefault(); openAttachmentBlob(fetchBlob) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt={attachment.filename} style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(0,0,0,0.08)' }} />}
    </a>
  )
}

function AuditTab({ srId }: { srId: number }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    erpApi.getAuditTrail(srId)
      .then(setEntries)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the audit trail — check your connection and reload the page.').join(' ')))
      .finally(() => setLoading(false))
  }, [srId])

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (entries.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No audit history yet.</p>

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



