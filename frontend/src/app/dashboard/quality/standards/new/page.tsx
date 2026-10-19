'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityStandardStatus } from '@/types'
import DateField from '@/components/erp/DateField'
import QualityNav from '@/components/quality/QualityNav'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, Req, Optional } from '@/components/shared/FormSheet'
import { ErrorBanner, sheetGap } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'

export default function NewQualityStandardPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()

  const [standardCode, setStandardCode] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [status, setStatus] = useState<QualityStandardStatus>('draft')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const handleSubmit = async () => {
    setError('')
    if (!standardCode.trim()) { setError('Standard code is required.'); return }
    if (!title.trim()) { setError('Title is required.'); return }

    setSubmitting(true)
    try {
      const standard = await qualityApi.createStandard({
        standard_code: standardCode.trim(),
        title: title.trim(),
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        effective_date: effectiveDate || undefined,
        status,
      })
      router.push(recordPath('/dashboard/quality/standards', standard))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create Quality Standard.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  const back = () => router.push('/dashboard/quality/standards')

  return (
    <FormPage nav={<QualityNav />} icon="doc" title="New Standard" subtitle="Quality Module · Standards" onBack={back} backTour="qa-std-new-back"
      footer={<>
        <button type="button" onClick={back} disabled={submitting} style={sheetBtn('secondary', SHEET.INK, submitting)}>Cancel</button>
        <button type="button" onClick={handleSubmit} disabled={submitting} style={sheetBtn('primary', SHEET.BLUE, submitting)}><SheetIcon name="check" size={16} />{submitting ? 'Saving…' : 'Save Standard'}</button>
      </>}>
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <SheetSection icon="doc" title="Standard Details">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '0 1 180px', minWidth: 0 }}>
                <label style={sheetLabel}>Standard Code <Req /></label>
                <input style={sheetInput} value={standardCode} onChange={(e) => setStandardCode(e.target.value)} placeholder="e.g. QMS-001" />
              </div>
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <label style={sheetLabel}>Title <Req /></label>
                <input style={sheetInput} value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
            </div>
            <label style={{ ...sheetLabel, ...sheetGap }}>Category <Optional /></label>
            <input style={sheetInput} value={category} onChange={(e) => setCategory(e.target.value)} />
            <label style={{ ...sheetLabel, ...sheetGap }}>Description <Optional /></label>
            <textarea style={{ ...sheetInput, minHeight: 100, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="calendar" title="Status">
            <label style={sheetLabel}>Status</label>
            <select style={sheetInput} value={status} onChange={(e) => setStatus(e.target.value as QualityStandardStatus)}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="obsolete">Obsolete</option>
            </select>
            <label style={{ ...sheetLabel, ...sheetGap }}>Effective Date <Optional /></label>
            <DateField value={effectiveDate} onChange={setEffectiveDate} />
          </SheetSection>
        </>}
      />
    </FormPage>
  )
}
