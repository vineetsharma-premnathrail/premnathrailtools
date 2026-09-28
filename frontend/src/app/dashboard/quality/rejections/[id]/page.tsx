'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityRejection, QualityRejectionDisposition, QualityRejectionStatus } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import QualityNav from '@/components/quality/QualityNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function QualityRejectionDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const params = useParams()
  const rejectionId = Number(params.id)

  const [rejection, setRejection] = useState<QualityRejection | null>(null)
  const [loading, setLoading] = useState(true)

  const [ncrId, setNcrId] = useState('')
  const [inspectionId, setInspectionId] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [quantity, setQuantity] = useState('')
  const [disposition, setDisposition] = useState<QualityRejectionDisposition>('return_to_vendor')
  const [status, setStatus] = useState<QualityRejectionStatus>('open')
  const [vendorName, setVendorName] = useState('')
  const [rejectionDate, setRejectionDate] = useState('')
  const [remarks, setRemarks] = useState('')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !rejectionId) return
    qualityApi.getRejection(rejectionId).then((r: QualityRejection) => {
      setRejection(r)
      setNcrId(r.ncr_id ? String(r.ncr_id) : '')
      setInspectionId(r.inspection_id ? String(r.inspection_id) : '')
      setItemName(r.item_name)
      setItemCode(r.item_code || '')
      setQuantity(r.quantity != null ? String(r.quantity) : '')
      setDisposition(r.disposition)
      setStatus(r.status)
      setVendorName(r.vendor_name || '')
      setRejectionDate(r.rejection_date || '')
      setRemarks(r.remarks || '')
    }).catch((err) => setError(extractErrorMessages(err, 'Failed to load Rejection.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, rejectionId])

  if (isLoading || !isAuthorized) return null
  if (loading || !rejection) return null

  const handleSave = async () => {
    setError('')
    if (!itemName.trim()) { setError('Item name is required.'); return }

    setSaving(true)
    try {
      const updated = await qualityApi.updateRejection(rejectionId, {
        ncr_id: ncrId.trim() ? Number(ncrId.trim()) : undefined,
        inspection_id: inspectionId.trim() ? Number(inspectionId.trim()) : undefined,
        item_name: itemName.trim(),
        item_code: itemCode.trim() || undefined,
        quantity: quantity ? Number(quantity) : undefined,
        disposition,
        status,
        vendor_name: vendorName.trim() || undefined,
        rejection_date: rejectionDate || undefined,
        remarks: remarks.trim() || undefined,
      })
      setRejection(updated)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to save Rejection.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    setError('')
    setDeleting(true)
    try {
      await qualityApi.deleteRejection(rejectionId)
      router.push('/dashboard/quality/rejections')
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete Rejection.'))
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{rejection.rejection_number}</h1>
        </div>
        <button onClick={() => router.push('/dashboard/quality/rejections')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Rejection Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '0 1 140px', minWidth: 120 }}>
            <label style={labelStyle}>NCR ID</label>
            <input type="number" style={inputStyle} value={ncrId} onChange={(e) => setNcrId(e.target.value)} placeholder="Optional" />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Inspection ID</label>
            <input type="number" style={inputStyle} value={inspectionId} onChange={(e) => setInspectionId(e.target.value)} placeholder="Optional" />
          </div>
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Item Name *</label>
            <input style={inputStyle} value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Item Code</label>
            <input style={inputStyle} value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 110px', minWidth: 100 }}>
            <label style={labelStyle}>Quantity</label>
            <input type="number" style={inputStyle} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 190px', minWidth: 170 }}>
            <label style={labelStyle}>Disposition *</label>
            <select style={inputStyle} value={disposition} onChange={(e) => setDisposition(e.target.value as QualityRejectionDisposition)}>
              <option value="return_to_vendor">Return to Vendor</option>
              <option value="scrap">Scrap</option>
              <option value="rework">Rework</option>
              <option value="use_as_is">Use As Is</option>
            </select>
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as QualityRejectionStatus)}>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div style={{ flex: '0 1 200px', minWidth: 180 }}>
            <label style={labelStyle}>Vendor Name</label>
            <input style={inputStyle} value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Rejection Date</label>
            <DateField value={rejectionDate} onChange={setRejectionDate} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
        {rejection.ncr_number && (
          <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '14px 0 0' }}>
            Linked to NCR {rejection.ncr_number}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
          type="button"
          style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${DANGER.border}`, background: DANGER.light, color: DANGER.text, fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? 'Deleting…' : 'Delete Rejection'}
        </button>
        <button onClick={handleSave} disabled={saving} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this Rejection?"
        message={`This permanently deletes "${rejection.rejection_number}". This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
