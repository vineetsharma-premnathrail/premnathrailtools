'use client'

import { useState } from 'react'
import { accountsApi } from '@/lib/api'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { extractErrorMessages } from '@/lib/validation'
import { DunningLetter } from '@/types'

/**
 * A customer reminder (dunning) letter as a managed Word document: one Word
 * button builds the letterhead .docx once and opens it in Word Online, then
 * offers edit / download / PDF. PDF renders the Word document of record.
 */
export default function DunningLetterDoc({ letter, canModify }: { letter: DunningLetter; canModify: boolean }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'' | 'pdf'>('')
  const live = letter.status === 'issued'

  const openPdf = async () => {
    setError('')
    setBusy('pdf')
    const tab = window.open('', '_blank')
    try {
      const blob = await accountsApi.dunningLetterPdf(letter.id)
      const url = URL.createObjectURL(blob)
      if (tab) tab.location.href = url
      else window.open(url, '_blank')
    } catch (err) {
      tab?.close()
      setError(extractErrorMessages(err, `Could not build the PDF of ${letter.letter_number}.`).join(' '))
    } finally {
      setBusy('')
    }
  }

  return (
    <div style={{ padding: '10px 0' }}>
      {error && (
        <div style={{ padding: '10px 14px', marginTop: 10, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}
      <ManagedDocumentPanel entityType="accounts_dunning_letter" entityId={letter.id} revision={0}
        canModify={canModify && live} recordLabel="reminder letter" downloadName={`Reminder-${letter.letter_number}`}
        extraItems={[{ label: busy === 'pdf' ? 'Building PDF…' : 'Download PDF', onClick: openPdf }]} />
    </div>
  )
}
