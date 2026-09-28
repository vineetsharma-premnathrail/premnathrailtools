'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityCapa, QualityInspection, QualityNcr, QualityNcrSeverity, QualityNcrSource, QualityNcrStatus, QualityRejection } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import QualityNav from '@/components/quality/QualityNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { open: 'Open', under_review: 'Under Review', capa_assigned: 'CAPA Assigned', closed: 'Closed', rejected: 'Rejected', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { open: '#F59E0B', under_review: '#2563EB', capa_assigned: '#7C3AED', closed: '#16A34A', rejected: '#DC2626', cancelled: '#78716c' }
const REJ_STATUS_HEX: Record<string, string> = { open: '#F59E0B', in_progress: '#2563EB', closed: '#16A34A' }
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

export default function QualityNcrDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const params = useParams()
  const ncrId = Number(params.id)

  const [ncr, setNcr] = useState<QualityNcr | null>(null)
  const [failedInspections, setFailedInspections] = useState<QualityInspection[]>([])
  const [rejections, setRejections] = useState<QualityRejection[]>([])
  const [capas, setCapas] = useState<QualityCapa[]>([])
  const [loading, setLoading] = useState(true)

  const [source, setSource] = useState<QualityNcrSource>('inspection')
  const [severity, setSeverity] = useState<QualityNcrSeverity>('minor')
  const [status, setStatus] = useState<QualityNcrStatus>('open')
  const [inspectionId, setInspectionId] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [description, setDescription] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [ncrDate, setNcrDate] = useState('')
  const [remarks, setRemarks] = useState('')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !ncrId) return
    ;(async () => {
      try {
        const [n, plans, rej, cap] = await Promise.all([
          qualityApi.getNcr(ncrId),
          qualityApi.listInspections({ status: 'failed' }),
          qualityApi.listRejections({ ncr_id: ncrId }),
          qualityApi.listCapas({ ncr_id: ncrId }),
        ])
        setNcr(n)
        setFailedInspections(Array.isArray(plans) ? plans : [])
        setRejections(Array.isArray(rej) ? rej : [])
        setCapas(Array.isArray(cap) ? cap : [])
        setSource(n.source)
        setSeverity(n.severity)
        setStatus(n.status)
        setInspectionId(n.inspection_id ? String(n.inspection_id) : '')
        setItemName(n.item_name)
        setItemCode(n.item_code || '')
        setDescription(n.description)
        setRootCause(n.root_cause || '')
        setNcrDate(n.ncr_date || '')
        setRemarks(n.remarks || '')
      } catch (err: any) {
        setError(extractErrorMessages(err, 'Failed to load NCR.'))
      } finally {
        setLoading(false)
      }
    })()
  }, [isAuthorized, ncrId])

  if (isLoading || !isAuthorized) return null
  if (loading || !ncr) return null

  const handleSave = async () => {
    setError('')
    if (!itemName.trim()) { setError('Item name is required.'); return }
    if (!description.trim()) { setError('Description is required.'); return }

    setSaving(true)
    try {
      const updated = await qualityApi.updateNcr(ncrId, {
        source,
        severity,
        status,
        inspection_id: source === 'inspection' && inspectionId ? Number(inspectionId) : undefined,
        item_name: itemName.trim(),
        item_code: itemCode.trim() || undefined,
        description: description.trim(),
        root_cause: rootCause.trim() || undefined,
        ncr_date: ncrDate || undefined,
        remarks: remarks.trim() || undefined,
      })
      setNcr(updated)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to save NCR.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    setError('')
    setDeleting(true)
    try {
      await qualityApi.deleteNcr(ncrId)
      router.push('/dashboard/quality/ncr')
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete NCR.'))
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{ncr.ncr_number}</h1>
        </div>
        <button onClick={() => router.push('/dashboard/quality/ncr')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>NCR Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Source *</label>
            <select style={inputStyle} value={source} onChange={(e) => setSource(e.target.value as QualityNcrSource)}>
              <option value="inspection">Inspection</option>
              <option value="complaint">Complaint</option>
              <option value="internal">Internal</option>
            </select>
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Severity *</label>
            <select style={inputStyle} value={severity} onChange={(e) => setSeverity(e.target.value as QualityNcrSeverity)}>
              <option value="minor">Minor</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div style={{ flex: '0 1 190px', minWidth: 170 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as QualityNcrStatus)}>
              <option value="open">Open</option>
              <option value="under_review">Under Review</option>
              <option value="capa_assigned">CAPA Assigned</option>
              <option value="closed">Closed</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          {source === 'inspection' && (
            <div style={{ flex: '1 1 260px', minWidth: 220 }}>
              <label style={labelStyle}>Related Inspection</label>
              <SearchableSelect
                value={inspectionId}
                onChange={setInspectionId}
                options={failedInspections.map((i) => ({ value: String(i.id), label: `${i.inspection_number} — ${i.item_name}` }))}
                placeholder="Search failed inspection…"
              />
            </div>
          )}
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Item Name *</label>
            <input style={inputStyle} value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Item Code</label>
            <input style={inputStyle} value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>NCR Date</label>
            <DateField value={ncrDate} onChange={setNcrDate} />
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Description *</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Root Cause</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
        <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '14px 0 0' }}>
          Raised by {ncr.raised_by_name || '—'}{ncr.created_at ? ` on ${ncr.created_at.slice(0, 10)}` : ''}
        </p>
      </div>

      {rejections.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Rejections</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rejections.map((r) => (
              <Link
                key={r.id}
                href={`/dashboard/quality/rejections/${r.id}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '10px 14px', borderRadius: 10, border: `1px solid ${BORDER.light}`,
                  background: 'rgba(255,255,255,.5)', textDecoration: 'none',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{r.rejection_number}</span>
                <span style={{ fontSize: 12.5, color: TEXT.muted }}>{r.item_name}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${REJ_STATUS_HEX[r.status]}1a`, color: REJ_STATUS_HEX[r.status], whiteSpace: 'nowrap' }}>
                  {r.status}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

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
          {deleting ? 'Deleting…' : 'Delete NCR'}
        </button>
        <button onClick={handleSave} disabled={saving} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this NCR?"
        message={`This permanently deletes "${ncr.ncr_number}". This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
