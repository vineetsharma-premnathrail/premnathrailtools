'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityStandard, QualityStandardStatus } from '@/types'
import DateField from '@/components/erp/DateField'
import QualityNav from '@/components/quality/QualityNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { ErrorBanner } from '@/components/quality/QualityBits'
import { FormPage, SheetSection, SheetIcon, sheetInput, sheetLabel, sheetHint, sheetBtn, Req, Optional, SHEET } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'

const inputStyle = sheetInput
const labelStyle = sheetLabel

export default function QualityStandardDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const { can, canDelete } = useCan()
  // Saving needs quality:standards:edit (backend PATCH /quality/standards/{id}).
  const canEdit = can('quality', 'standards', 'edit')
  const router = useRouter()
  const params = useParams()
  const { id: recordId, error: linkError } = useRecordId(params.id as string)
  const standardId = recordId ?? 0

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
  if (linkError) return (<div><QualityNav /><InvalidRecordLink message={linkError} listHref="/dashboard/quality/standards" listLabel="Back to standards" /></div>)
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
    } catch (err) {
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
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete Quality Standard.'))
      setDeleting(false)
    }
  }

  return (
    <FormPage nav={<QualityNav />} icon="doc" title={standard.standard_code} subtitle={`Quality · Standard · ${standard.title}`}
      onBack={() => router.push('/dashboard/quality/standards')} backTour="qa-std-back"
      footer={<>
        {canDelete('quality', 'standards', (standard as { created_by_id?: number | null } | null)?.created_by_id ?? null) && (
          <button type="button" onClick={() => setConfirmOpen(true)} disabled={deleting} style={{ ...sheetBtn('secondary', SHEET.INK, deleting), color: '#b91c1c', marginRight: 'auto' }}>
            <SheetIcon name="trash" size={16} />{deleting ? 'Deleting…' : 'Delete standard'}
          </button>
        )}
        <button type="button" onClick={() => router.push('/dashboard/quality/standards')} style={sheetBtn('secondary')}>{canEdit ? 'Cancel' : 'Close'}</button>
        {canEdit && (
          <button type="button" onClick={handleSave} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <ErrorBanner error={error} />
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <SheetSection icon="doc" title="Standard details">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
              <div style={{ flex: '0 1 180px', minWidth: 160 }}>
                <label style={labelStyle}>Standard code <Req /></label>
                <input style={inputStyle} value={standardCode} onChange={(e) => setStandardCode(e.target.value)} />
              </div>
              <div style={{ flex: '1 1 260px', minWidth: 220 }}>
                <label style={labelStyle}>Title <Req /></label>
                <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div style={{ flex: '0 1 200px', minWidth: 180 }}>
                <label style={labelStyle}>Category <Optional /></label>
                <input style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
              <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                <label style={labelStyle}>Effective date <Optional /></label>
                <DateField value={effectiveDate} onChange={setEffectiveDate} />
              </div>
              <div style={{ flex: '0 1 160px', minWidth: 140 }}>
                <label style={labelStyle}>Status</label>
                <Select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as QualityStandardStatus)}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="obsolete">Obsolete</option>
                </Select>
              </div>
            </div>
            <label style={labelStyle}>Description <Optional /></label>
            <textarea style={{ ...inputStyle, minHeight: 90 }} value={description} onChange={(e) => setDescription(e.target.value)} />
            <p style={sheetHint}>
              Created by {standard.created_by_name || '—'}{standard.created_at ? ` on ${standard.created_at.slice(0, 10)}` : ''}
            </p>
          </SheetSection>
        </fieldset>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this Standard?"
        message={`This permanently deletes "${standard.standard_code} — ${standard.title}". This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </FormPage>
  )
}
