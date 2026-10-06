'use client'

import { useState } from 'react'
import { qualityApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import ManagedDocumentPanel, { openRecordInWord } from '@/components/shared/ManagedDocumentPanel'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'

/**
 * One Quality document of record (inspection report, test certificate,
 * deviation approval). Word is primary: "Save & Edit in Word" creates the
 * letterhead .docx (once) and opens it in Word Online; the panel below keeps
 * the version history / upload. PDF is secondary and renders the Word
 * document of record once it exists.
 */
export default function QualityRecordDoc({ title, hint, entityType, entityId, pdfKind, canModify, downloadName }: {
  title: string
  hint: string
  entityType: 'quality_inspection_report' | 'quality_test_certificate' | 'quality_deviation_approval'
  entityId: number
  pdfKind: 'inspection-report' | 'test-certificate' | 'deviation-approval'
  canModify: boolean
  downloadName: string
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'' | 'word' | 'pdf'>('')
  const [reloadKey, setReloadKey] = useState(0)

  const openWord = () => {
    setError('')
    setBusy('word')
    const tab = window.open('', '_blank')
    openRecordInWord(entityType, entityId, tab)
      .then(() => setTimeout(() => setReloadKey((k) => k + 1), 1500))
      .catch((err) => setError(`Could not open the ${title.toLowerCase()} in Word: ${extractErrorMessages(err, 'unknown error').join(' ')}`))
      .finally(() => setBusy(''))
  }

  const openPdf = async () => {
    setError('')
    setBusy('pdf')
    const tab = window.open('', '_blank')
    try {
      const blob = await qualityApi.recordPdf(pdfKind, entityId)
      const url = URL.createObjectURL(blob)
      if (tab) tab.location.href = url
      else window.open(url, '_blank')
    } catch (err) {
      tab?.close()
      setError(extractErrorMessages(err, `Could not build the ${title.toLowerCase()} PDF.`).join(' '))
    } finally {
      setBusy('')
    }
  }

  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title}</p>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '2px 0 0' }}>{hint}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canModify && (
            <button type="button" disabled={!!busy} onClick={openWord} style={primaryBtnStyle}>
              {busy === 'word' ? 'Opening…' : 'Save & Edit in Word'}
            </button>
          )}
          <button type="button" disabled={!!busy} onClick={openPdf} style={secondaryBtnStyle}>
            {busy === 'pdf' ? 'Building…' : 'Download PDF'}
          </button>
        </div>
      </div>
      {error && (
        <div style={{ padding: '10px 14px', marginTop: 10, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}
      <ManagedDocumentPanel key={reloadKey} entityType={entityType} entityId={entityId} revision={0} canModify={canModify}
        recordLabel={title.toLowerCase()} downloadName={downloadName} />
    </div>
  )
}
