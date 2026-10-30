'use client'

// Upload a Technical Offer (Word .docx or PDF). Offers are uploaded, never
// created in the portal. Used by R&D (Requirement › Technical Offers; the R&D
// head then releases it) and by BD (inquiry / tender › Technical Offers; quotable
// at once). The caller supplies `onSubmit`, so both sides share the same form.

import { useState } from 'react'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { FormSheet, SheetSection, SheetIcon, FileDropZone, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'

export interface OfferUploadPayload { file: File; title: string; offer_date: string; notes?: string }

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const OK_EXT = /\.(docx|pdf)$/i

export default function TechnicalOfferUploadSheet({ draftId, heading = 'Upload Technical Offer', subtitle, submitLabel = 'Upload Offer', hint, onSubmit, onClose }: {
  /** Names the kept draft (e.g. `rnd-offer-inquiry-12`). */
  draftId: string
  heading?: string
  subtitle: string
  submitLabel?: string
  /** What happens after the upload (who reviews it, when it is quotable). */
  hint: string
  onSubmit: (p: OfferUploadPayload) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)
  const draft = useFormDraft(draftId, { title, date, notes, files },
    (d) => { setTitle(d.title || ''); setDate(d.date || todayIso()); setNotes(d.notes || '') })

  const submit = async () => {
    const file = files[0]
    if (!title.trim()) { setError('Give the offer a title — it identifies the file in lists (e.g. “Technical Offer — 600 mm platform trolley”).'); return }
    if (!date) { setError('Pick the offer date — it is printed on the quotation.'); return }
    if (!file) { setError('Choose the offer file — Word (.docx) or PDF.'); return }
    if (!OK_EXT.test(file.name)) { setError(`“${file.name}” can't be uploaded — only Word (.docx) or PDF files are accepted as a Technical Offer.`); return }
    if (file.size === 0) { setError(`“${file.name}” is empty — pick the final offer file and upload again.`); return }
    setSaving(true)
    setError('')
    try {
      await onSubmit({ file, title: title.trim(), offer_date: date, notes: notes.trim() || undefined })
      draft.clear()
    } catch (err) {
      setError(extractErrorMessages(err, 'The Technical Offer was not uploaded. Check the file and try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet tour="rnd-offer-upload-form" width={580} icon="upload" title={heading} subtitle={subtitle} onClose={onClose} busy={saving}
      footer={<>
        <button type="button" onClick={onClose} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button data-tour="rnd-offer-upload-submit" type="button" onClick={submit} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
          <SheetIcon name="upload" size={16} />{saving ? 'Uploading…' : submitLabel}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <DraftBanner draft={draft} />
        <SheetSection icon="doc" title="Offer details">
          <label style={sheetLabel}>Title <Req /></label>
          <input style={sheetInput} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} autoFocus
            placeholder="e.g. Technical Offer — 600 mm platform trolley" />
          <label style={{ ...sheetLabel, marginTop: 14 }}>Offer date <Req /></label>
          <div style={{ maxWidth: 200 }}><DateField value={date} onChange={setDate} /></div>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Notes <Optional /></label>
          <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Context for the reviewer — what changed, assumptions, open points" />
        </SheetSection>
        <SheetSection icon="clip" title="Offer file">
          <label style={sheetLabel}>Word or PDF <Req /></label>
          <FileDropZone files={files} onChange={setFiles} accept=".docx,.pdf" max={1} hint=".docx or .pdf · one file" />
          <p style={sheetHint}>{hint}</p>
        </SheetSection>
      </div>
    </FormSheet>
  )
}
