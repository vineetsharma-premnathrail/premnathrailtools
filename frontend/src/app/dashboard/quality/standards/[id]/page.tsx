'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityStandard, QualityStandardStatus } from '@/types'
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

export default function QualityStandardDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const params = useParams()
  const standardId = Number(params.id)

  const [standard, setStandard] = useState<QualityStandard | null>(null)
  const [loading, setLoading] = useState(true)

  const [standardCode, setStandardCode] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [status, setStatus] = useState<QualityStandardStatus>('draft')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !standardId) return
    qualityApi.getStandard(standardId).then((s: QualityStandard) => {
      setStandard(s)
      setStandardCode(s.standard_code)
      setTitle(s.title)
      setCategory(s.category || '')
      setDescription(s.description || '')
      setEffectiveDate(s.effective_date || '')
      setStatus(s.status)
    }).catch((err) => setError(extractErrorMessages(err, 'Failed to load Quality Standard.')))
      .finally(() => setLoading(false))
  }, [isAuthorized, standardId])

  if (isLoading || !isAuthorized) return null
  if (loading || !standard) return null

  const handleSave = async () => {
    setError('')
    if (!standardCode.trim()) { setError('Standard code is required.'); return }
    if (!title.trim()) { setError('Title is required.'); return }

    setSaving(true)
    try {
      const updated = await qualityApi.updateStandard(standardId, {
        standard_code: standardCode.trim(),
        title: title.trim(),
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        effective_date: effectiveDate || undefined,
        status,
      })
      setStandard(updated)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to save Quality Standard.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    setError('')
    setDeleting(true)
    try {
      await qualityApi.deleteStandard(standardId)
      router.push('/dashboard/quality/standards')
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete Quality Standard.'))
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{standard.standard_code}</h1>
        </div>
        <button onClick={() => router.push('/dashboard/quality/standards')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Standard Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '0 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Standard Code *</label>
            <input style={inputStyle} value={standardCode} onChange={(e) => setStandardCode(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 200px', minWidth: 180 }}>
            <label style={labelStyle}>Category</label>
            <input style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Effective Date</label>
            <DateField value={effectiveDate} onChange={setEffectiveDate} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as QualityStandardStatus)}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="obsolete">Obsolete</option>
            </select>
          </div>
        </div>
        <div>
          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, minHeight: 90 }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '14px 0 0' }}>
          Created by {standard.created_by_name || '—'}{standard.created_at ? ` on ${standard.created_at.slice(0, 10)}` : ''}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
          type="button"
          style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${DANGER.border}`, background: DANGER.light, color: DANGER.text, fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? 'Deleting…' : 'Delete Standard'}
        </button>
        <button onClick={handleSave} disabled={saving} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this Standard?"
        message={`This permanently deletes "${standard.standard_code} — ${standard.title}". This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
