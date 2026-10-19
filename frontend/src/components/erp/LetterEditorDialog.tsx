'use client'

import { useEffect, useState } from 'react'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { erpApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { Project, ProjectLetter, ProjectLetterType } from '@/types'
import DateField from '@/components/erp/DateField'
import { FormSheet, SHEET, SheetIcon, Req, sheetBtn, sheetInput, sheetLabel, sheetHint, type SheetIconName } from '@/components/shared/FormSheet'
import { openRecordInWord } from '@/components/shared/ManagedDocumentPanel'

const inputStyle = sheetInput
const labelStyle = sheetLabel
const hintStyle: React.CSSProperties = { ...sheetHint, margin: '4px 0 0' }

/** Block heading inside the letter sheet (same look as SheetSection's header). */
function SheetHeading({ icon, title }: { icon: SheetIconName; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 12px' }}>
      <SheetIcon name={icon} size={18} color={SHEET.BLUE} />
      <h4 style={{ fontSize: 15, fontWeight: 700, color: SHEET.INK, margin: 0 }}>{title}</h4>
    </div>
  )
}

export const LETTER_TYPES: { key: ProjectLetterType; title: string; description: string }[] = [
  { key: 'delivery_cover', title: 'Delivery Cover Letter', description: 'Goes with the machine — lists the documents handed over (invoice, guarantee, test reports…).' },
  { key: 'delivery_confirmation', title: 'Delivery Confirmation', description: 'Delivery note listing every delivery challan; the customer signs it as proof of delivery.' },
  { key: 'guarantee_certificate', title: 'Guarantee Certificate', description: 'Quality guarantee against the LOA — months from commissioning / supply, whichever is later.' },
  { key: 'general', title: 'General Letter', description: 'Free-form letter on the letterhead — write your own subject and body.' },
]
// General letters are no longer created — kept above only so existing ones still show their title.
const CREATABLE_LETTER_TYPES = LETTER_TYPES.filter((t) => t.key !== 'general')
export const letterTypeTitle = (t?: string) => LETTER_TYPES.find((x) => x.key === t)?.title || 'Letter'

// Keep in sync with DEFAULT_*_STATEMENT in backend erp/reports/letter_templates.py.
const DEFAULT_CONFIRMATION_STATEMENT = 'We have delivered the vehicle, as stated in the Letter of Agreement, to your site as per the tender, against the delivery challans listed below, and it is in good condition.'
const DEFAULT_COVER_STATEMENT = 'We have delivered the vehicle, as stated in the Letter of Agreement, to your site as per the tender, with the documents listed below.'
const DEFAULT_DOCUMENTS = [
  'Invoice showing LOA reference, goods description',
  "Manufacturer's/Contractor Guarantee Certificate",
  'Inspection & Test reports',
  'Delivery Confirmation',
  'Packing List',
]
// Fields that are the same on every delivery document of one machine — copied
// from the most recent one so the second and third documents need no retyping.
const SHARED_KEYS = ['project_title', 'client', 'application', 'vehicle', 'model_no', 'loa_ref', 'invoice_no', 'invoice_date', 'receiver_org'] as const

type ChallanLine = { challan_no: string; description: string }
type TemplateData = {
  project_title: string; client: string; application: string; vehicle: string; model_no: string
  loa_ref: string; invoice_no: string; invoice_date: string; receiver_org: string
  delivery_note_no: string; statement: string; items: ChallanLine[]
  documents: string[]
  recipient: string; supply_description: string; months_commissioning: string; months_supply: string
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoToDmy(iso?: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return d && m && y ? `${d}/${m}/${y}` : iso
}

// "To" block pre-filled from the machine’s client contact, one line each, so
// a letter to the customer needs no retyping; any line can be edited.
function defaultRecipient(project: Project): string {
  return [project.client_name, project.client_designation, project.client_company, project.client_address]
    .filter((v) => v && v.trim())
    .join('\n')
}

function initialData(type: ProjectLetterType, project: Project, letter: ProjectLetter | null, previous: Record<string, unknown> | null): TemplateData {
  const saved = (letter?.data || {}) as Record<string, unknown>
  const prev = previous || {}
  const str = (key: string, fallback = '') => {
    if (letter) return saved[key] != null ? String(saved[key]) : fallback
    return prev[key] != null && String(prev[key]).trim() ? String(prev[key]) : fallback
  }
  const vehicle = str('vehicle', project.machine_type || '')
  const projectTitle = str('project_title')
  const items = Array.isArray(saved.items) ? (saved.items as ChallanLine[]) : []
  const documents = Array.isArray(saved.documents) ? (saved.documents as string[]) : []
  return {
    project_title: projectTitle,
    client: str('client', project.client_company || ''),
    application: str('application', project.application_type || ''),
    vehicle,
    model_no: str('model_no', project.model_name || ''),
    loa_ref: str('loa_ref', project.po_number ? `${project.po_number}${project.po_date ? ` DATE. ${isoToDmy(project.po_date)}` : ''}` : ''),
    invoice_no: str('invoice_no'),
    invoice_date: str('invoice_date'),
    receiver_org: str('receiver_org', project.client_company || ''),
    delivery_note_no: letter ? String(saved.delivery_note_no ?? '') : '',
    statement: letter ? String(saved.statement ?? '') : (type === 'delivery_confirmation' ? DEFAULT_CONFIRMATION_STATEMENT : DEFAULT_COVER_STATEMENT),
    items: letter ? items : [{ challan_no: '', description: '' }],
    documents: letter ? documents : [...DEFAULT_DOCUMENTS],
    recipient: letter ? String(saved.recipient ?? '') : defaultRecipient(project),
    supply_description: letter ? String(saved.supply_description ?? '') : [vehicle, projectTitle].filter(Boolean).join(' for '),
    months_commissioning: letter ? String(saved.months_commissioning ?? '') : '18',
    months_supply: letter ? String(saved.months_supply ?? '') : '24',
  }
}

export default function LetterEditorDialog({
  open,
  project,
  letter,
  letters = [],
  signatory,
  onClose,
  onSaved,
}: {
  open: boolean
  project: Project
  letter: ProjectLetter | null // null = create new
  letters?: ProjectLetter[] // this machine's existing documents, newest first (for pre-fill)
  signatory: { name?: string; designation?: string }
  onClose: () => void
  onSaved: (saved: ProjectLetter, wordError?: string) => void
}) {
  const [type, setType] = useState<ProjectLetterType | null>(null)
  const [letterDate, setLetterDate] = useState(today())
  const [recipient, setRecipient] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [data, setData] = useState<TemplateData | null>(null)
  const [signatoryName, setSignatoryName] = useState('')
  const [signatoryDesignation, setSignatoryDesignation] = useState('')
  const [partners, setPartners] = useState<{ name: string; designation: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const previousShared = (() => {
    const latest = letters.find((l) => l.letter_type && l.letter_type !== 'general' && l.data)
    if (!latest?.data) return null
    const out: Record<string, unknown> = {}
    SHARED_KEYS.forEach((k) => { out[k] = latest.data?.[k] })
    return out
  })()

  const startType = (t: ProjectLetterType) => {
    setType(t)
    setErrors([])
    if (t !== 'general') setData(initialData(t, project, letter, previousShared))
  }

  useEffect(() => {
    if (!open) return
    setErrors([])
    setLetterDate(letter?.letter_date || today())
    setRecipient(letter?.recipient ?? defaultRecipient(project))
    setSubject(letter?.subject ?? '')
    setBody(letter?.body ?? 'Dear Sir/Madam,\n\n')
    setSignatoryName(letter ? letter.signatory_name || '' : signatory.name || '')
    setSignatoryDesignation(letter ? letter.signatory_designation || '' : signatory.designation || '')
    // Partners (Company Info → Partners) sign outgoing documents — default to
    // one of them, not the logged-in user who is preparing the document.
    erpApi.getProjectLetterDefaults(project.id)
      .then((d) => {
        setPartners(d.partners || [])
        if (letter || !d.signatory_name) return
        setSignatoryName(d.signatory_name)
        setSignatoryDesignation(d.signatory_designation || '')
      })
      .catch(() => { /* keep the logged-in user as the fallback signatory */ })
    if (letter) {
      const t = (letter.letter_type || 'general') as ProjectLetterType
      setType(t)
      setData(t === 'general' ? null : initialData(t, project, letter, null))
    } else {
      setType(null)
      setData(null)
    }
  }, [open, letter, project, signatory.name, signatory.designation]) // eslint-disable-line react-hooks/exhaustive-deps

  useEscapeKey(open && !saving, onClose)
  if (!open) return null

  const set = <K extends keyof TemplateData>(key: K, value: TemplateData[K]) => setData((d) => (d ? { ...d, [key]: value } : d))

  const validate = (): string[] => {
    const missing: string[] = []
    if (!letterDate) missing.push('Date is required.')
    if (type === 'general') {
      if (!recipient.trim()) missing.push('Recipient (To) is required — who is this letter addressed to?')
      if (!subject.trim()) missing.push('Subject is required.')
      if (!body.trim()) missing.push('Letter body is required.')
      return missing
    }
    if (!data) return missing
    if (!data.loa_ref.trim()) missing.push('LOA / PO reference is required — every delivery document quotes the order the machine was supplied against.')
    if (type !== 'guarantee_certificate') {
      if (!data.client.trim()) missing.push('Client is required.')
      if (!data.invoice_no.trim()) missing.push('Invoice No. is required — the invoice the machine was billed on.')
    }
    if (type === 'delivery_confirmation') {
      if (!data.delivery_note_no.trim()) missing.push('Delivery Note No. is required.')
      const lines = data.items.filter((i) => i.challan_no.trim() || i.description.trim())
      if (!lines.length) missing.push('Add at least one delivery challan (challan no. + item delivered).')
      lines.forEach((i, n) => { if (!i.challan_no.trim() || !i.description.trim()) missing.push(`Challan line ${n + 1} needs both the challan no. and the item delivered.`) })
    }
    if (type === 'delivery_cover' && !data.documents.some((d) => d.trim())) missing.push('List at least one document handed over with the machine.')
    if (type === 'guarantee_certificate') {
      if (!data.recipient.trim()) missing.push('To is required — who the certificate is addressed to.')
      if (!data.supply_description.trim()) missing.push('"What is guaranteed" is required (machine + project).')
      if (!(Number(data.months_commissioning) > 0)) missing.push('Months from commissioning must be a whole number above 0.')
      if (!(Number(data.months_supply) > 0)) missing.push('Months from supply must be a whole number above 0.')
    }
    return missing
  }

  const save = async (editInWord: boolean) => {
    const missing = validate()
    if (missing.length) { setErrors(missing); return }

    // Opened inside the click (before any await) so the popup blocker allows it.
    const tab = editInWord ? window.open('', '_blank') : null
    setSaving(true)
    setErrors([])
    const payload = type === 'general'
      ? { letter_type: 'general', letter_date: letterDate, recipient, subject, body }
      : { letter_type: type, letter_date: letterDate, data }
    try {
      const full = { ...payload, signatory_name: signatoryName.trim() || null, signatory_designation: signatoryDesignation.trim() || null }
      const saved: ProjectLetter = letter
        ? await erpApi.updateProjectLetter(project.id, letter.id, full)
        : await erpApi.createProjectLetter(project.id, full)
      if (editInWord) {
        try {
          await openRecordInWord('erp_project_letter', saved.id, tab)
        } catch (err) {
          // Saved fine — only the Word step failed; say so instead of losing the save.
          onSaved(saved, `${saved.letter_no} was saved, but the Word document could not be opened: ${extractErrorMessages(err, 'unknown error').join(' ')} Use "Create Word" / "Edit in Word" on the document row to retry.`)
          return
        }
      }
      onSaved(saved)
    } catch (err) {
      tab?.close()
      setErrors(extractErrorMessages(err, 'Could not save the document.'))
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, key: keyof TemplateData, opts: { placeholder?: string; hint?: string; required?: boolean } = {}) => (
    <div>
      <label style={labelStyle}>{label} {opts.required && <Req />}</label>
      <input style={inputStyle} value={(data?.[key] as string) ?? ''} placeholder={opts.placeholder} onChange={(e) => set(key, e.target.value as never)} />
      {opts.hint && <p style={hintStyle}>{opts.hint}</p>}
    </div>
  )
  const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 14 }
  const smallBtn: React.CSSProperties = sheetBtn('ghost')
  const removeBtn: React.CSSProperties = { fontSize: 16, lineHeight: 1, padding: '6px 10px', borderRadius: 8, border: `1px solid ${SHEET.LINE}`, background: '#fff', color: '#b91c1c', cursor: 'pointer', alignSelf: 'flex-start' }

  const heading = letter ? `Edit ${letter.letter_no}` : type ? `New ${letterTypeTitle(type)}` : 'Create Document'

  const subtitle = type
    ? `Created as an editable Word document on the company letterhead${type !== 'general' ? ' in two copies — Original for Recipient and Duplicate for Supplier (signed copy comes back to us)' : ''}.${letter ? '' : ` Reference number is assigned on save (${project.serial_number}/LTR/…).`}`
    : 'Pick the document you want to create for this machine.'

  return (
    <FormSheet tour="erp-letter-dialog" width={820} icon={letter ? 'edit' : 'doc'} title={heading} subtitle={subtitle} onClose={onClose} busy={saving}
      footer={<>
        {!letter && type && (
          <button type="button" onClick={() => { setType(null); setErrors([]) }} disabled={saving} style={{ ...sheetBtn('secondary', SHEET.INK, saving), marginRight: 'auto' }} data-tour="erp-letter-back-btn">
            <SheetIcon name="left" size={14} />Change document
          </button>
        )}
        <button type="button" onClick={onClose} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)} data-tour="erp-letter-cancel-btn">Cancel</button>
        {type && (
          <>
            <button type="button" data-tour="erp-letter-save-btn" onClick={() => save(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" data-tour="erp-letter-save-word-btn" onClick={() => save(true)} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name="doc" size={16} />{saving ? 'Saving…' : 'Save & Edit in Word'}
            </button>
          </>
        )}
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {errors.length > 0 && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', marginBottom: 14 }}>
            {errors.map((e) => <p key={e} style={{ fontSize: 12.5, color: '#b91c1c', margin: '2px 0' }}>{e}</p>)}
          </div>
        )}

        {!type && (
          <div data-tour="erp-letter-types" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 18 }}>
            {CREATABLE_LETTER_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => startType(t.key)}
                style={{ textAlign: 'left', padding: '14px 16px', borderRadius: 12, border: `1px solid ${SHEET.LINE}`, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, color: SHEET.INK, marginBottom: 4 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: SHEET.MUTED, lineHeight: 1.45 }}>{t.description}</div>
              </button>
            ))}
          </div>
        )}

        {type === 'general' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Date <Req /></label>
                <DateField value={letterDate} onChange={setLetterDate} />
              </div>
              <div>
                <label style={labelStyle}>Subject <Req /></label>
                <input data-tour="erp-letter-subject" style={inputStyle} value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Commissioning of machine PEW-62-2" />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>To <Req /></label>
              <textarea data-tour="erp-letter-to" style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={'Name\nDesignation\nCompany\nAddress'} />
              <p style={hintStyle}>One line per row — pre-filled from the machine’s client contact.</p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Letter <Req /></label>
              <textarea data-tour="erp-letter-body" style={{ ...inputStyle, minHeight: 240, resize: 'vertical', lineHeight: 1.5 }} value={body} onChange={(e) => setBody(e.target.value)} />
              <p style={hintStyle}>Leave a blank line between paragraphs.</p>
            </div>
          </>
        )}

        {type && type !== 'general' && data && (
          <>
            {type !== 'guarantee_certificate' && (
              <>
                <SheetHeading icon="truck" title="Machine & order particulars" />
                <p style={{ ...hintStyle, margin: '-6px 0 12px' }}>
                  Pre-filled from the machine record{previousShared && !letter ? ' and this machine’s last delivery document' : ''} — check and complete what’s missing.
                </p>
                <div style={grid2}>
                  {field('Project', 'project_title', { placeholder: 'e.g. IRCON MAHSR-T2 Project' })}
                  {field('Client', 'client', { required: true })}
                  {field('Application', 'application', { placeholder: 'e.g. Cement Asphalt Mortar Mixer' })}
                  {field('Vehicle', 'vehicle', { placeholder: 'e.g. Cement Asphalt Mortar (CAM) Injection Car' })}
                  {field('Model No.', 'model_no')}
                  <div>
                    <label style={labelStyle}>Serial No.</label>
                    <input style={{ ...inputStyle, background: SHEET.SOFT, color: SHEET.MUTED }} value={project.serial_number} readOnly />
                    <p style={hintStyle}>From the machine record — change it there if wrong.</p>
                  </div>
                </div>
              </>
            )}

            {type === 'guarantee_certificate' && <SheetHeading icon="shield" title="Guarantee details" />}

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>LOA / PO reference <Req /></label>
              <textarea data-tour="erp-letter-loa" style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={data.loa_ref} onChange={(e) => set('loa_ref', e.target.value)} placeholder="e.g. IRCON/3026/MAHSR-T2/CAM-INJECTION CAR/520 DATE. 21/08/2024 & AMENDMENT LETTER DATED. 02/12/2025" />
              <p style={hintStyle}>Include amendments if any. Pre-filled from the machine’s PO number &amp; date.</p>
            </div>

            {type !== 'guarantee_certificate' && (
              <div style={grid2}>
                {field('Invoice No.', 'invoice_no', { required: true, placeholder: 'e.g. INV/P1/26-27/005' })}
                <div>
                  <label style={labelStyle}>Invoice Date</label>
                  <DateField value={data.invoice_date} onChange={(v) => set('invoice_date', v)} />
                </div>
              </div>
            )}

            <SheetHeading icon="doc" title={letterTypeTitle(type)} />
            <div style={grid2}>
              <div>
                <label style={labelStyle}>Date <Req /></label>
                <DateField value={letterDate} onChange={setLetterDate} />
              </div>
              {type === 'delivery_confirmation' && field('Delivery Note No.', 'delivery_note_no', { required: true, placeholder: 'e.g. DN/P1/26-27/03' })}
              {type !== 'guarantee_certificate' && field('Received on behalf of', 'receiver_org', { hint: 'Customer organisation that signs the receiving copy.' })}
            </div>

            {type !== 'guarantee_certificate' && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Statement</label>
                <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical', lineHeight: 1.5 }} value={data.statement} onChange={(e) => set('statement', e.target.value)} />
              </div>
            )}

            {type === 'delivery_confirmation' && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Delivery challans <Req /></label>
                <div data-tour="erp-letter-challans" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.items.map((it, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px minmax(140px, 200px) 1fr auto', gap: 8, alignItems: 'start' }}>
                      <span style={{ fontSize: 12.5, color: SHEET.MUTED, paddingTop: 11 }}>{i + 1}.</span>
                      <input style={inputStyle} value={it.challan_no} placeholder="DC/P1/26-27/0165" onChange={(e) => set('items', data.items.map((x, j) => (j === i ? { ...x, challan_no: e.target.value } : x)))} />
                      <textarea style={{ ...inputStyle, minHeight: 42, resize: 'vertical' }} value={it.description} placeholder="Item delivered, e.g. Liquid tank with integrated mechanical system assembly" onChange={(e) => set('items', data.items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                      <button type="button" title="Remove line" style={removeBtn} onClick={() => set('items', data.items.filter((_, j) => j !== i))}>×</button>
                    </div>
                  ))}
                </div>
                <button type="button" style={{ ...smallBtn, marginTop: 8 }} onClick={() => set('items', [...data.items, { challan_no: '', description: '' }])}><SheetIcon name="plus" size={14} />Add challan</button>
              </div>
            )}

            {type === 'delivery_cover' && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Documents handed over <Req /></label>
                <div data-tour="erp-letter-documents" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.documents.map((d, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12.5, color: SHEET.MUTED }}>{i + 1}.</span>
                      <input style={inputStyle} value={d} onChange={(e) => set('documents', data.documents.map((x, j) => (j === i ? e.target.value : x)))} />
                      <button type="button" title="Remove" style={{ ...removeBtn, alignSelf: 'center' }} onClick={() => set('documents', data.documents.filter((_, j) => j !== i))}>×</button>
                    </div>
                  ))}
                </div>
                <button type="button" style={{ ...smallBtn, marginTop: 8 }} onClick={() => set('documents', [...data.documents, ''])}><SheetIcon name="plus" size={14} />Add document</button>
              </div>
            )}

            {type === 'guarantee_certificate' && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>To <Req /></label>
                  <textarea data-tour="erp-letter-guarantee-to" style={{ ...inputStyle, minHeight: 110, resize: 'vertical' }} value={data.recipient} onChange={(e) => set('recipient', e.target.value)} placeholder={'The CGM Mechanical\nIRCON International Limited\n(A Govt. of India Undertaking)\nAddress'} />
                  <p style={hintStyle}>One line per row — pre-filled from the machine’s client contact.</p>
                </div>
                <div style={{ marginBottom: 14 }}>
                  {field('What is guaranteed', 'supply_description', { required: true, placeholder: 'e.g. Cement Asphalt Mortar (CAM) Injection Car for MAHSR-T2 Project Surat, Gujarat', hint: 'Printed as: “…guarantee the satisfactory operation and quality of the <this>, supplied by us…”' })}
                </div>
                <div style={grid2}>
                  {field('Months from commissioning', 'months_commissioning', { required: true })}
                  {field('Months from supply', 'months_supply', { required: true, hint: 'Whichever period ends later applies — match the LOA warranty clause.' })}
                </div>
              </>
            )}
          </>
        )}

        {type && <SheetHeading icon="user" title="Signatory" />}
        {type && (
          <div data-tour="erp-letter-signatory" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
            <div>
              <label style={labelStyle}>Signatory Name</label>
              <input style={inputStyle} value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Signatory Designation</label>
              <input style={inputStyle} value={signatoryDesignation} onChange={(e) => setSignatoryDesignation(e.target.value)} placeholder="e.g. Partner" />
            </div>
            <div style={{ gridColumn: '1 / -1', margin: '-6px 0 0', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {partners.length > 0 ? (
                <>
                  <span style={hintStyle}>Sign as partner:</span>
                  {partners.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => { setSignatoryName(p.name); setSignatoryDesignation(p.designation) }}
                      style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${signatoryName === p.name ? SHEET.BLUE : SHEET.LINE}`, background: signatoryName === p.name ? '#eff6ff' : '#fff', color: signatoryName === p.name ? SHEET.BLUE : SHEET.BODY }}
                    >
                      {p.name}
                    </button>
                  ))}
                </>
              ) : (
                <span style={hintStyle}>No partners set — an admin can add them in Organization → Company Info → Partners; they then become the default signatory.</span>
              )}
            </div>
          </div>
        )}

      </div>
    </FormSheet>
  )
}
