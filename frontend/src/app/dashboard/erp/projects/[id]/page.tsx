'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { hasErpPermission, useRequireApp } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import { AuditEntry, Project, ServiceRequest } from '@/types'
import ErpNav from '@/components/erp/ErpNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import FileUploadPreview from '@/components/FileUploadPreview'
import { Card, InfoRow } from '@/components/shared/ui'

const TABS = ['Overview', 'Technical Specs', 'Maintenance History', 'Documents', 'Audit Trail'] as const

export default function ProjectDetailPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('erp')
  const canCreateSr = hasErpPermission(user, 'sr_create')
  const canEdit = hasErpPermission(user, 'project_edit')
  const canDelete = hasErpPermission(user, 'project_delete')
  const params = useParams()
  const router = useRouter()
  const projectId = Number(params.id)

  const [project, setProject] = useState<Project | null>(null)
  const [activeTicketCount, setActiveTicketCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<typeof TABS[number]>('Overview')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setProject(await erpApi.getProject(projectId))
    } catch {
      setError('Machine not found.')
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
    erpApi.listServiceRequests({ project_id: projectId }).then((srs: ServiceRequest[]) => {
      setActiveTicketCount(srs.filter((s) => s.status !== 'closed').length)
    })
  }, [isAuthorized, projectId])

  const warranty = (() => {
    if (!project?.warranty_end_date) return { label: '—', sub: 'No warranty on record' }
    const end = new Date(project.warranty_end_date)
    const daysLeft = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (daysLeft < 0) return { label: 'Expired', sub: `Expired on ${project.warranty_end_date}` }
    return { label: 'Active', sub: `Valid until ${project.warranty_end_date}` }
  })()

  const handleDelete = async () => {
    if (!project) return
    await erpApi.deleteProject(project.id)
    router.push('/dashboard/erp/projects')
  }

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error && !project) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!project) return null

  return (
    <div>
      <ErpNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: 0 }}>{project.serial_number}</h1>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 9999, textTransform: 'capitalize', background: project.status === 'active' ? 'rgba(16,185,129,0.12)' : 'rgba(220,38,38,0.1)', color: project.status === 'active' ? '#047857' : '#b91c1c' }}>
              {project.status}
            </span>
          </div>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>{project.model_name || '—'} {project.client_company ? `· ${project.client_company}` : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {canCreateSr && (
            <Link
              href={{ pathname: '/dashboard/erp/service-requests/new' }}
              style={{ fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              + New Service Request
            </Link>
          )}
          {canEdit && (
            <Link
              href={`/dashboard/erp/projects/${project.id}/edit`}
              style={{ fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#57534e', textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              Edit Project
            </Link>
          )}
          {canDelete && (
            <button onClick={() => setShowDeleteConfirm(true)} style={dangerBtnStyle}>Delete</button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
        <div style={{ position: 'relative', overflow: 'hidden', padding: 18, borderRadius: 14, background: 'linear-gradient(140deg,#fffbeb,#fff)', border: '1px solid rgba(245,158,11,0.15)' }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 8px' }}>Active Tickets</p>
          <p style={{ fontSize: 28, fontWeight: 700, color: '#1f1108', margin: '0 0 6px' }}>{activeTicketCount}</p>
          <p style={{ fontSize: 12, color: '#a8a29e', margin: 0 }}>{activeTicketCount === 0 ? 'No open repair requests' : `${activeTicketCount} open repair request(s)`}</p>
        </div>
        <div style={{ position: 'relative', overflow: 'hidden', padding: 18, borderRadius: 14, background: 'linear-gradient(140deg,#eff6ff,#fff)', border: '1px solid rgba(59,130,246,0.15)' }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 8px' }}>Warranty Status</p>
          <p style={{ fontSize: 28, fontWeight: 700, color: '#1f1108', margin: '0 0 6px' }}>{warranty.label}</p>
          <p style={{ fontSize: 12, color: '#a8a29e', margin: 0 }}>{warranty.sub}</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 6px',
              marginRight: 16,
              border: 'none',
              background: 'transparent',
              borderBottom: tab === t ? '2px solid #fa9b9b' : '2px solid transparent',
              color: tab === t ? '#fa9b9b' : '#78716c',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewTab project={project} />}
      {tab === 'Technical Specs' && <TechnicalSpecsTab project={project} />}
      {tab === 'Maintenance History' && <MaintenanceHistoryTab projectId={project.id} />}
      {tab === 'Documents' && <DocumentsTab projectId={project.id} />}
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

function OverviewTab({ project }: { project: Project }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      <Card title="Machine Identity">
        <InfoRow label="Machine Type" value={project.machine_type || '—'} />
        <InfoRow label="Application Type" value={project.application_type || '—'} />
        <InfoRow label="Engine Number" value={project.engine_number || '—'} />
        <InfoRow label="Chassis Number" value={project.chassis_number || '—'} />
        <InfoRow label="Year of Manufacture" value={project.year_of_manufacture || '—'} />
      </Card>

      <Card title="Timeline">
        <InfoRow label="PO Date" value={project.po_date || '—'} />
        <InfoRow label="Dispatch Date" value={project.delivery_date || '—'} />
        <InfoRow label="Commissioning Date" value={project.commissioning_date || '—'} />
        <InfoRow label="Handover Date" value={project.handover_date || '—'} />
      </Card>

      <Card title="Client & Site">
        <InfoRow label="Client Company" value={project.client_company || '—'} />
        <InfoRow label="Contact Name" value={project.client_name || '—'} />
        <InfoRow label="Contact Designation" value={project.client_designation || '—'} />
        <InfoRow label="Contact Email" value={project.client_email || '—'} />
        <InfoRow label="Contact Phone" value={project.client_phone || '—'} />
        <InfoRow label="Alternate Phone" value={project.client_phone_alt || '—'} />
        <InfoRow label="Client GST" value={project.client_gst || '—'} />
        <InfoRow label="Site" value={project.site_name || '—'} />
        <InfoRow label="Site Location" value={project.site_location || '—'} />
        <InfoRow label="Site State" value={project.site_state || '—'} />
        <InfoRow label="Site Pincode" value={project.site_pincode || '—'} />
        <InfoRow label="Site Country" value={project.site_country || '—'} />
        <InfoRow label="Zone" value={project.zone || '—'} />
        <InfoRow label="Export Deployment" value={project.is_export ? 'Yes' : 'No'} />
      </Card>

      <Card title="Warranty & AMC">
        <InfoRow label="Warranty Start" value={project.warranty_start_date || '—'} />
        <InfoRow label="Warranty End" value={project.warranty_end_date || '—'} />
        <InfoRow label="Warranty Terms" value={project.warranty_override || '—'} />
        <InfoRow label="Extended Warranty" value={project.extended_warranty ? `Yes (until ${project.extended_warranty_end || '—'})` : 'No'} />
        <InfoRow label="AMC Status" value={project.amc_status || '—'} />
        <InfoRow label="AMC End Date" value={project.amc_end_date || '—'} />
      </Card>

      {project.notes && (
        <Card title="Production Notes">
          <p style={{ fontSize: 13.5, color: '#1f1108', margin: 0 }}>{project.notes}</p>
        </Card>
      )}
    </div>
  )
}

function TechnicalSpecsTab({ project }: { project: Project }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      <Card title="Operator Details">
        <InfoRow label="Operator Name" value={project.operator_name || '—'} />
        <InfoRow label="Operator Phone" value={project.operator_phone || '—'} />
        <InfoRow label="Operator Email" value={project.operator_email || '—'} />
        <InfoRow label="Qualification" value={project.operator_qualification || '—'} />
      </Card>

      <Card title="Technical Specifications">
        <InfoRow label="Software Version" value={project.software_version || '—'} />
        <InfoRow label="Installed Options" value={project.installed_options || '—'} />
        <InfoRow label="Specifications" value={project.specifications || '—'} />
        <InfoRow label="Engineering Notes" value={project.tech_notes || '—'} />
      </Card>
    </div>
  )
}

function MaintenanceHistoryTab({ projectId }: { projectId: number }) {
  const [srs, setSrs] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    erpApi.listServiceRequests({ project_id: projectId }).then(setSrs).finally(() => setLoading(false))
  }, [projectId])

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (srs.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No service requests raised for this machine yet.</p>

  return (
    <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
            {['SR Number', 'Issue', 'Priority', 'Status', 'Created'].map((h) => (
              <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {srs.map((sr) => (
            <tr key={sr.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
              <td style={{ padding: '10px 14px' }}>
                <Link href={`/dashboard/erp/service-requests/${sr.id}`} style={{ fontSize: 13, fontWeight: 600, color: '#fa9b9b', textDecoration: 'none' }}>
                  {sr.request_number}
                </Link>
              </td>
              <td style={{ padding: '10px 14px', fontSize: 13 }}>{sr.issue_title}</td>
              <td style={{ padding: '10px 14px', fontSize: 12.5, textTransform: 'capitalize' }}>{sr.priority}</td>
              <td style={{ padding: '10px 14px', fontSize: 12.5, textTransform: 'capitalize' }}>{sr.status.replace('_', ' ')}</td>
              <td style={{ padding: '10px 14px', fontSize: 12.5, color: '#78716c' }}>{sr.created_at ? new Date(sr.created_at).toLocaleDateString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DocumentsTab({ projectId }: { projectId: number }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<import('@/types').ProjectAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const [staged, setStaged] = useState<File[]>([])

  const load = () => {
    erpApi.listProjectAttachments(projectId).then(setAttachments).finally(() => setLoading(false))
  }

  useEffect(load, [projectId])

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
      load()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleDelete = async (attachmentId: number) => {
    await erpApi.deleteProjectAttachment(projectId, attachmentId)
    load()
  }

  return (
    <div style={{ borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#78716c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
          <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#57534e' }}>Attachments &amp; Documents</span>
        </div>
        <span style={{ fontSize: 12, color: '#a8a29e' }}>{attachments.length} file(s)</span>
      </div>

      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          onClick={() => !uploading && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); stageFiles(e.dataTransfer.files) }}
          style={{
            padding: '32px 20px',
            borderRadius: 14,
            border: `2px dashed ${dragOver ? '#fa9b9b' : 'rgba(0,0,0,0.15)'}`,
            background: dragOver ? 'rgba(244,113,59,0.05)' : '#fff',
            textAlign: 'center',
            cursor: uploading ? 'wait' : 'pointer',
          }}
        >
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => stageFiles(e.target.files)} disabled={uploading} />
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#78716c" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: '#1f1108', margin: '0 0 4px' }}>
            {uploading ? 'Uploading…' : 'Drag & drop files here'}
          </p>
          {!uploading && (
            <p style={{ fontSize: 12.5, color: '#a8a29e', margin: 0 }}>
              or <span style={{ color: '#fa9b9b', fontWeight: 600 }}>click to browse</span>
            </p>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            {['PDF', 'DOCX', 'XLSX', 'JPG/PNG', 'MP4'].map((t) => (
              <span key={t} style={{ fontSize: 10.5, fontWeight: 600, padding: '3px 9px', borderRadius: 6, background: 'rgba(0,0,0,0.05)', color: '#78716c' }}>{t}</span>
            ))}
          </div>
        </div>

        <FileUploadPreview
          files={staged}
          uploading={uploading}
          onRemove={(i) => setStaged((prev) => prev.filter((_, idx) => idx !== i))}
          onConfirm={confirmUpload}
          onCancel={() => { setStaged([]); if (fileRef.current) fileRef.current.value = '' }}
        />

        {error && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: 0 }}>{error}</p>}

        {loading ? (
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>Loading…</p>
        ) : attachments.length === 0 ? (
          <p style={{ fontSize: 13, color: '#a8a29e', margin: 0 }}>No documents uploaded.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {attachments.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                <a href={a.sharepoint_url || '#'} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>
                  {a.filename}
                </a>
                <button onClick={() => handleDelete(a.id)} style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.06)', color: '#b91c1c', cursor: 'pointer' }}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
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
  if (entries.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No audit history yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e) => (
        <div key={e.id} style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1f1108' }}>{e.performed_by}</span>
            <span style={{ fontSize: 11.5, color: '#a8a29e' }}>{e.performed_at ? new Date(e.performed_at).toLocaleString() : ''}</span>
          </div>
          <p style={{ fontSize: 13, color: '#57534e', margin: 0 }}>{e.summary || e.action}</p>
        </div>
      ))}
    </div>
  )
}

const dangerBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '9px 16px',
  borderRadius: 10,
  border: '1px solid rgba(220,38,38,0.25)',
  background: 'rgba(220,38,38,0.06)',
  color: '#b91c1c',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
