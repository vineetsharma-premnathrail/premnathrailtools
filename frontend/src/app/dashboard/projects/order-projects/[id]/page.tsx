'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PencilSimple } from '@phosphor-icons/react'
import { useRequireApp } from '@/hooks/useAuth'
import { orderProjectsApi, usersApi } from '@/lib/api'
import { DirectoryUser, OrderProject } from '@/types'
import { TEXT, GLASS } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import ProjectsNav from '@/components/projects/ProjectsNav'
import { sectionStyle, h2Style, Pill, ErrorBanner, PageHeader, Fact } from '@/components/sales/SalesUi'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { formatINR } from '@/components/sales/labels'
import OrderProjectTable, { OP_STATUS_LABELS, OP_STATUS_HEX } from '@/components/sales/OrderProjectTable'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { FormSheet, SheetError, SheetIcon, SHEET, sheetBtn, sheetLabel, sheetHint, Optional } from '@/components/shared/FormSheet'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

export default function OrderProjectDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('projects')
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const { id: projectIdResolved, error: linkError } = useRecordId(id)
  const projectId = projectIdResolved ?? 0
  const [project, setProject] = useState<OrderProject | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmHold, setConfirmHold] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !projectId) return
    let ignore = false
    orderProjectsApi.get(projectId)
      .then((p) => { if (!ignore) { setProject(p); setError('') } })
      .catch((err) => { if (!ignore) setError(extractErrorMessages(err, 'Failed to load the order project.')) })
    return () => { ignore = true }
  }, [isAuthorized, projectId])

  const setStatus = async (status: 'active' | 'on_hold') => {
    setConfirmHold(false)
    setBusy(true)
    setNotice('')
    try {
      setProject(await orderProjectsApi.update(projectId, { status }))
      setNotice(status === 'on_hold' ? 'Project put on hold.' : 'Project resumed.')
      setError('')
    } catch (err) { setError(extractErrorMessages(err, 'Could not change the project status.')) } finally { setBusy(false) }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><ProjectsNav /><InvalidRecordLink message={linkError} listHref="/dashboard/projects/order-projects" listLabel="Back to order projects" /></div>)
  if (!project) return (<div><ProjectsNav /><PageHeader moduleLabel="Project Management" title="Order project" backHref="/dashboard/projects/order-projects" /><ErrorBanner error={error} /></div>)

  const canEdit = !!project.can?.edit && !['closed', 'cancelled'].includes(project.status)
  const vehicles = project.elements.filter((e) => e.kind === 'vehicle' && e.status !== 'cancelled')

  return (
    <div>
      <ProjectsNav />
      <PageHeader
        moduleLabel="Project Management"
        title={<span>{project.op_number} <span style={{ verticalAlign: 'middle' }}><Pill label={OP_STATUS_LABELS[project.status] || project.status} hex={OP_STATUS_HEX[project.status] || '#78716c'} /></span></span>}
        subtitle={project.title}
        backHref="/dashboard/projects/order-projects"
      >
        <div data-tour="sales-op-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canEdit && project.status === 'active' && <button style={secondaryBtnStyle} disabled={busy} onClick={() => setConfirmHold(true)}>Put on hold</button>}
          {canEdit && project.status === 'on_hold' && <button style={secondaryBtnStyle} disabled={busy} onClick={() => setStatus('active')}>Resume</button>}
        </div>
      </PageHeader>

      <ErrorBanner error={error} />
      {notice && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>{notice}</div>}

      <div data-tour="sales-op-summary" style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <h2 style={{ ...h2Style, margin: 0 }}>Project</h2>
          {canEdit && (
            <button type="button" data-tour="sales-op-edit" onClick={() => setEditOpen(true)} style={{ ...secondaryBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <PencilSimple size={15} /> Edit project
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <Fact label="Customer" value={project.customer_name} />
          <Fact label="Sales order" value={project.so_number ? (
            <button type="button" onClick={() => router.push(recordPath('/dashboard/sales/orders', project, 'sales_order_id'))}
              style={{ background: 'none', border: 'none', padding: 0, color: '#FF6A2A', fontWeight: 600, cursor: 'pointer', fontSize: 13.5, fontFamily: 'inherit' }}>
              {project.so_number} →
            </button>
          ) : null} />
          <Fact label="Customer PO" value={`${project.customer_po_number || '—'}${project.customer_po_date ? ` · ${formatDate(project.customer_po_date)}` : ''}`} />
          {project.order_value !== null && <Fact label="Order value (incl. GST)" value={formatINR(project.order_value)} />}
          <Fact label="Project manager" value={project.project_manager_name || <span style={{ color: TEXT.muted }}>Not assigned</span>} />
          <Fact label="Planned start" value={formatDate(project.planned_start)} />
          <Fact label="Planned end" value={formatDate(project.planned_end)} />
          <Fact label="Vehicles delivered" value={`${project.vehicles_delivered} of ${vehicles.length}`} />
          {project.branch_name && <Fact label="Unit" value={project.branch_name} />}
        </div>
      </div>

      <div style={{ ...sectionStyle, padding: 0 }}>
        <div style={{ padding: '16px 20px 8px' }}>
          <h2 style={{ ...h2Style, margin: 0 }}>Vehicles &amp; lots — 360 view</h2>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0 0' }}>
            One row per vehicle (a delivery row of the order) and per spares lot. Each department column shows where that element stands; “—” means nothing is linked yet.
          </p>
        </div>
        <div data-tour="sales-op-360" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)', borderTop: `1px solid ${GLASS.border}`, borderRadius: '0 0 18px 18px' }}>
          <OrderProjectTable elements={project.elements} />
        </div>
      </div>

      {editOpen && (
        <EditProjectSheet project={project} onClose={() => setEditOpen(false)}
          onSaved={(p) => { setProject(p); setEditOpen(false); setNotice('Project updated.') }} />
      )}
      <ConfirmDialog
        open={confirmHold}
        title={`Put ${project.op_number} on hold?`}
        message="The project stays visible, but other departments can't link new work to it until it is resumed. The sales order itself is not changed."
        confirmLabel="Put on hold"
        danger={false}
        onConfirm={() => setStatus('on_hold')}
        onCancel={() => setConfirmHold(false)}
      />
    </div>
  )
}

function EditProjectSheet({ project, onClose, onSaved }: { project: OrderProject; onClose: () => void; onSaved: (p: OrderProject) => void }) {
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [pm, setPm] = useState(project.project_manager_id ? String(project.project_manager_id) : '')
  const [start, setStart] = useState(project.planned_start || '')
  const [end, setEnd] = useState(project.planned_end || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    usersApi.directory().then(setUsers).catch((err) => setError(extractErrorMessages(err, 'Could not load the user list.')))
  }, [])

  const save = async () => {
    if (start && end && end < start) { setError('Planned end is before planned start — fix one of the dates.'); return }
    setBusy(true)
    setError('')
    try {
      onSaved(await orderProjectsApi.update(project.id, {
        project_manager_id: pm ? Number(pm) : null, planned_start: start || null, planned_end: end || null,
      }))
    } catch (err) { setError(extractErrorMessages(err, 'Could not save the project.')) } finally { setBusy(false) }
  }

  const options = users.map((u) => ({ value: String(u.id), label: `${u.name || u.email}${u.department ? ` · ${u.department}` : ''}` }))

  return (
    <FormSheet icon="edit" title={`Edit ${project.op_number}`} subtitle="Project manager and planned dates. Vehicles and lots follow the sales order." onClose={onClose} busy={busy} width={560} onSubmit={save} tour="sales-op-edit-sheet"
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.BLUE, busy)}>Cancel</button>
        <button type="submit" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <div style={{ padding: '20px 24px 4px' }}>
        <SheetError error={error} />
        <div style={{ marginBottom: 16 }}>
          <label style={sheetLabel}>Project manager <Optional /></label>
          <SearchableSelect value={pm} onChange={setPm} options={[{ value: '', label: 'Not assigned' }, ...options]} placeholder="Not assigned" />
          <p style={sheetHint}>The person who drives this order through Design, Purchase, Production and Dispatch to delivery.</p>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ flex: '0 1 200px', minWidth: 170 }}>
            <label style={sheetLabel}>Planned start</label>
            <DateField value={start} onChange={setStart} />
          </div>
          <div style={{ flex: '0 1 200px', minWidth: 170 }}>
            <label style={sheetLabel}>Planned end</label>
            <DateField value={end} onChange={setEnd} />
          </div>
        </div>
        <p style={{ ...sheetHint, marginBottom: 12 }}>Defaults: start = the order&apos;s confirmation date, end = its latest contractual delivery date.</p>
      </div>
    </FormSheet>
  )
}
