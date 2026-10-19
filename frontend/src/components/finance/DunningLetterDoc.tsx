'use client'

import { useState } from 'react'
import { accountsApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import ManagedDocumentPanel, { openRecordInWord } from '@/components/shared/ManagedDocumentPanel'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/finance/financeUi'
import { extractErrorMessages } from '@/lib/validation'
import { DunningLetter } from '@/types'

/**
 * A customer reminder (dunning) letter as a managed Word document: "Save &
 * Edit in Word" builds the letterhead .docx once and opens it in Word Online;
 * the panel keeps version history / upload. PDF is secondary and renders the
 * Word document of record once it exists.
 */
export default function DunningLetterDoc({ letter, canModify }: { letter: DunningLetter; canModify: boolean }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'' | 'word' | 'pdf'>('')
  const [reloadKey, setReloadKey] = useState(0)
  const live = letter.status === 'issued'

  const openWord = () => {
    setError('')
    setBusy('word')
    const tab = window.open('', '_blank')
    openRecordInWord('accounts_dunning_letter', letter.id, tab)
      .then(() => setTimeout(() => setReloadKey((k) => k + 1), 1500))
      .catch((err) => setError(`Could not open reminder ${letter.letter_number} in Word: ${extractErrorMessages(err, 'unknown error').join(' ')}`))
      .finally(() => setBusy(''))
  }

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
          Word is the document of record — edit it in Word Online, then send it to the customer from Outlook.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canModify && live && (
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
      <ManagedDocumentPanel key={reloadKey} entityType="accounts_dunning_letter" entityId={letter.id} revision={0}
        canModify={canModify && live} recordLabel="reminder letter" downloadName={`Reminder-${letter.letter_number}`} />
    </div>
  )
}
