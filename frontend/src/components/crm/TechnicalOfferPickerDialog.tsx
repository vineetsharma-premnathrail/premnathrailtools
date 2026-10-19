'use client'

import { useEffect, useState } from 'react'
import { crmApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { CrmDocument, ManagedDocumentState, RndRequestAssignment } from '@/types'
import Checkbox from '@/components/Checkbox'
import DateField from '@/components/erp/DateField'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'


const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Props = {
  open: boolean
  relatedModule: 'inquiry' | 'tender'
  relatedId: number
  sending: boolean
  onSend: (documentIds: number[], assignment: RndRequestAssignment) => void
  onCancel: () => void
}

// Mounted only while open, so every opening starts fresh.
export default function TechnicalOfferPickerDialog(props: Props) {
  if (!props.open) return null
  return <TorSheet {...props} />
}

function TorSheet({ relatedModule, relatedId, sending, onSend, onCancel }: Props) {
  const [clientDocs, setClientDocs] = useState<CrmDocument[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [wordDoc, setWordDoc] = useState<ManagedDocumentState | null>(null)
  const [dueDate, setDueDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [formError, setFormError] = useState('')
  // Picking reference documents needs Inquiries & Tenders › Documents › View; without it the list is skipped.
  const seeDocs = useCan().canFeature('crm', 'inquiries_tenders', 'documents', 'view')

  useEffect(() => {
    if (!seeDocs) { Promise.resolve().then(() => { setClientDocs([]); setLoading(false) }); return }
    crmApi.listDocuments({ related_module: relatedModule, related_id: relatedId })
      .then((docs: CrmDocument[]) => setClientDocs(docs.filter((d) => d.folder_type === 'client')))
      .catch(() => setClientDocs([]))
      .finally(() => setLoading(false))
  }, [relatedModule, relatedId, seeDocs])

  const toggle = (id: number) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  // A draft made for an earlier send is stale: this send needs a fresh one.
  const wordReady = !!wordDoc && !wordDoc.is_stale

  const submit = () => {
    if (!wordReady) { setFormError('Create the Technical Offer Word document first ("Create Word" below), review or edit it, then press Send.'); return }
    if (!dueDate) { setFormError('Set the Response Due Date — the date R&D must reply by.'); return }
    if (dueDate < todayIso()) { setFormError('Response Due Date is in the past — pick today or a later date.'); return }
    setFormError('')
    onSend(selected, { response_due_date: dueDate, remarks: remarks.trim() || undefined })
  }

  return (
    <FormSheet icon="send" title="Send Technical Requirement to R&D" onClose={onCancel} busy={sending}
      subtitle="Two steps: 1. Create the Technical Offer Word document (edit it in Word if needed), 2. Send it. The whole R&D team sees it under R&D › Requirements; whoever answers after the due date must give a reason."
      footer={<>
        <button type="button" onClick={onCancel} disabled={sending} data-tour="tor-cancel-btn" style={sheetBtn('secondary', SHEET.INK, sending)}>Cancel</button>
        <button type="button" onClick={submit} disabled={sending || !wordReady} title={wordReady ? undefined : 'Create the Word document first'} data-tour="tor-send-btn"
          style={sheetBtn('primary', SHEET.BLUE, sending || !wordReady)}>
          <SheetIcon name="send" size={16} />{sending ? 'Sending…' : 'Send'}
        </button>
      </>}>
      <SheetColumns
        left={<>
          <SheetError error={formError} />
          <SheetSection icon="calendar" title="Response">
            <div data-tour="tor-due-date" style={{ maxWidth: 200 }}>
              <label style={sheetLabel}>Response Due Date <Req /></label>
              <DateField value={dueDate} onChange={setDueDate} />
            </div>
            <div data-tour="tor-remarks" style={{ marginTop: 14 }}>
              <label style={sheetLabel}>Remarks to R&amp;D <Optional /></label>
              <textarea
                style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="What you need back — e.g. feasibility + drawing, or a technical deviation list"
              />
            </div>
          </SheetSection>
          <SheetSection icon="clip" title="Reference client documents" extra={<Optional />}>
            {loading ? (
              <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Loading client documents…</p>
            ) : clientDocs.length === 0 ? (
              <p style={{ fontSize: 13, color: SHEET.MUTED, fontStyle: 'italic', margin: 0 }}>No client documents uploaded yet.</p>
            ) : (
              <div data-tour="tor-doc-picker" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                {clientDocs.map((d) => (
                  <div key={d.id} onClick={() => toggle(d.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: `1px solid ${SHEET.LINE}`, cursor: 'pointer', fontSize: 13, background: '#fff' }}>
                    <span onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />
                    </span>
                    <span style={{ color: SHEET.INK }}>{d.file_name}</span>
                  </div>
                ))}
              </div>
            )}
          </SheetSection>
        </>}
        right={
          <div data-tour="tor-word-doc">
            <SheetSection icon="doc" title="Technical Offer document" extra={<Req />}>
              <p style={{ fontSize: 12, color: SHEET.MUTED, margin: '0 0 10px', lineHeight: 1.5 }}>
                Press <strong>Create Word</strong>, edit it in Word if needed, then press Send. R&amp;D gets the PDF of this Word file.
                The sent PDF is saved on SharePoint and filed under the {relatedModule}&apos;s Internal Documents.
              </p>
              <ManagedDocumentPanel
                entityType={`crm_tor_${relatedModule}`}
                entityId={relatedId}
                revision={0}
                canModify
                recordLabel="requirement"
                downloadName={`Technical-Offer-${relatedModule}-${relatedId}`}
                onDocumentChange={setWordDoc}
              />
            </SheetSection>
          </div>
        }
      />
    </FormSheet>
  )
}
