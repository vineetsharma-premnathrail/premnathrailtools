'use client'

import { useState } from 'react'
import { qualityApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { extractErrorMessages } from '@/lib/validation'

/**
 * One Quality document of record (inspection report, test certificate,
 * deviation approval). Word is primary: "Save & Edit in Word" creates the
 * letterhead .docx (once) and opens it in Word Online; the panel below keeps
 * the version history / upload. PDF is secondary and renders the Word
 * document of record once it exists.
 */
export default function QualityRecordDoc({ title, hint, entityType, entityId, pdfKind, canModify, downloadName, revision = 0 }: {
  title: string
  hint: string
  entityType: 'quality_inspection_report' | 'quality_test_certificate' | 'quality_deviation_approval' | 'quality_8d_report'
  entityId: number
  pdfKind: 'inspection-report' | 'test-certificate' | 'deviation-approval' | '8d-report'
  canModify: boolean
  downloadName: string
  /** Record revision (8D report: bumps when the CAPA is reopened). */
  revision?: number
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'' | 'pdf'>('')

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
      </div>
      {error && (
        <div style={{ padding: '10px 14px', marginTop: 10, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}
      <ManagedDocumentPanel entityType={entityType} entityId={entityId} revision={revision} canModify={canModify}
        recordLabel={title.toLowerCase()} downloadName={downloadName}
        extraItems={[{ label: busy === 'pdf' ? 'Building PDF…' : 'Download PDF', onClick: openPdf }]} />
    </div>
  )
}
