'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityCapa, QualityComplaintSeverity, QualityComplaintStatus, QualityCustomerComplaint } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import QualityNav from '@/components/quality/QualityNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { open: 'Open', under_investigation: 'Under Investigation', capa_assigned: 'CAPA Assigned', resolved: 'Resolved', closed: 'Closed', rejected: 'Rejected' }
const CAPA_STATUS_HEX: Record<string, string> = { open: '#F59E0B', in_progress: '#2563EB', pending_verification: '#7C3AED', closed: '#16A34A', overdue: '#DC2626' }

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function QualityComplaintDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const params = useParams()
  const complaintId = Number(params.id)

  const [complaint, setComplaint] = useState<QualityCustomerComplaint | null>(null)
  const [capas, setCapas] = useState<QualityCapa[]>([])
  const [loading, setLoading] = useState(true)

  const [customerName, setCustomerName] = useState('')
  const [customerOrgId, setCustomerOrgId] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<QualityComplaintSeverity>('minor')
  const [status, setStatus] = useState<QualityComplaintStatus>('open')
  const [complaintDate, setComplaintDate] = useState('')
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [remarks, setRemarks] = useState('')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !complaintId) return
    ;(async () => {
      try {
        const [c, cap] = await Promise.all([
          qualityApi.getComplaint(complaintId),
          qualityApi.listCapas({ complaint_id: complaintId }),
        ])
        setComplaint(c)
        setCapas(Array.isArray(cap) ? cap : [])
        setCustomerName(c.customer_name)
        setCustomerOrgId(c.customer_org_id ? String(c.customer_org_id) : '')
        setItemName(c.item_name)
        setItemCode(c.item_code || '')
        setDescription(c.description)
        setSeverity(c.severity)
        setStatus(c.status)
        setComplaintDate(c.complaint_date || '')
        setResolutionNotes(c.resolution_notes || '')
        setRemarks(c.remarks || '')
      } catch (err: any) {
        setError(extractErrorMessages(err, 'Failed to load complaint.'))
      } finally {
        setLoading(false)
      }
    })()
  }, [isAuthorized, complaintId])

  if (isLoading || !isAuthorized) return null
  if (loading || !complaint) return null

  const handleSave = async () => {
    setError('')
    if (!customerName.trim()) { setError('Customer name is required.'); return }
    if (!itemName.trim()) { setError('Item name is required.'); return }
    if (!description.trim()) { setError('Description is required.'); return }

    setSaving(true)
    try {
      const updated = await qualityApi.updateComplaint(complaintId, {
        customer_name: customerName.trim(),
        customer_org_id: customerOrgId ? Number(customerOrgId) : undefined,
        item_name: itemName.trim(),
        item_code: itemCode.trim() || undefined,
        description: description.trim(),
        severity,
        status,
        complaint_date: complaintDate || undefined,
        resolution_notes: resolutionNotes.trim() || undefined,
        remarks: remarks.trim() || undefined,
      })
      setComplaint(updated)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to save complaint.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    setError('')
    setDeleting(true)
    try {
      await qualityApi.deleteComplaint(complaintId)
      router.push('/dashboard/quality/complaints')
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete complaint.'))
      setDeleting(false)
    }
  }

  return (
    <div style={{ width: '100%' }}>
      <QualityNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Quality Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{complaint.complaint_number}</h1>
        </div>
        <button onClick={() => router.push('/dashboard/quality/complaints')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Complaint Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
            <label style={labelStyle}>Customer Name *</label>
            <input style={inputStyle} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Customer Org ID</label>
            <input type="number" style={inputStyle} value={customerOrgId} onChange={(e) => setCustomerOrgId(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 220px', minWidth: 200, maxWidth: 320 }}>
            <label style={labelStyle}>Item Name *</label>
            <input style={inputStyle} value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Item Code</label>
            <input style={inputStyle} value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Severity *</label>
            <select style={inputStyle} value={severity} onChange={(e) => setSeverity(e.target.value as QualityComplaintSeverity)}>
              <option value="minor">Minor</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div style={{ flex: '0 1 190px', minWidth: 170 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as QualityComplaintStatus)}>
              <option value="open">Open</option>
              <option value="under_investigation">Under Investigation</option>
              <option value="capa_assigned">CAPA Assigned</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Complaint Date</label>
            <DateField value={complaintDate} onChange={setComplaintDate} />
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Description *</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Resolution Notes</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
        <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '14px 0 0' }}>
          Received by {complaint.received_by_name || '—'}{complaint.created_at ? ` on ${complaint.created_at.slice(0, 10)}` : ''}
        </p>
      </div>

      {capas.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>CAPA</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {capas.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/quality/capa/${c.id}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '10px 14px', borderRadius: 10, border: `1px solid ${BORDER.light}`,
                  background: 'rgba(255,255,255,.5)', textDecoration: 'none',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{c.capa_number}</span>
                <span style={{ fontSize: 12.5, color: TEXT.muted }}>{c.title}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${CAPA_STATUS_HEX[c.status]}1a`, color: CAPA_STATUS_HEX[c.status], whiteSpace: 'nowrap' }}>
                  {c.status}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
          type="button"
          style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${DANGER.border}`, background: DANGER.light, color: DANGER.text, fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? 'Deleting…' : 'Delete Complaint'}
        </button>
        <button onClick={handleSave} disabled={saving} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this complaint?"
        message={`This permanently deletes "${complaint.complaint_number}". This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
