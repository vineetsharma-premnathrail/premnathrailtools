'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrTravelRequest } from '@/types'
import DateField from '@/components/erp/DateField'
import { SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { FormDialog, ErrorBanner, fmtDate, fmtINR, titleCase } from './adminUi'
import { TEXT } from '@/lib/theme'

export const TRAVEL_MODE_LABELS: Record<string, string> = {
  air: 'Air', train: 'Train', bus: 'Bus', car: 'Own / hired car', company_vehicle: 'Company vehicle', other: 'Other',
}
export const TRAVEL_STATUS_LABELS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Completed' }
export const TRAVEL_STATUS_HEX: Record<string, string> = { pending: '#F59E0B', approved: '#2563EB', rejected: '#DC2626', cancelled: '#64748B', completed: '#16A34A' }

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 }

function Fld({ label, children, basis = 200, grow = false, max, req = false }: { label: string; children: React.ReactNode; basis?: number; grow?: boolean; max?: number; req?: boolean }) {
  return (
    <div style={{ flex: grow ? `1 1 ${basis}px` : `0 1 ${basis}px`, minWidth: Math.min(basis, 130), maxWidth: max }}>
      <label style={sheetLabel}>{label}{req && <> <Req /></>}</label>
      {children}
    </div>
  )
}

export function TravelFormDialog({
  open, request, onClose, onSaved,
}: {
  open: boolean
  request?: HrTravelRequest | null
  onClose: () => void
  onSaved: (t: HrTravelRequest) => void
}) {
  const blank = {
    purpose: '', from_city: '', to_city: '', depart_date: '', return_date: '', travel_mode: 'train',
    accommodation_required: false, advance_required: '', estimated_cost: '', project_reference: '',
  }
  const [f, setF] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setError([])
    setF(request ? {
      purpose: request.purpose, from_city: request.from_city, to_city: request.to_city, depart_date: request.depart_date,
      return_date: request.return_date || '', travel_mode: request.travel_mode, accommodation_required: request.accommodation_required,
      advance_required: Number(request.advance_required) ? String(request.advance_required) : '',
      estimated_cost: request.estimated_cost != null ? String(request.estimated_cost) : '', project_reference: request.project_reference || '',
    } : blank)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request])

  const set = <K extends keyof typeof blank>(k: K) => (v: (typeof blank)[K]) => setF((p) => ({ ...p, [k]: v }))
  const money = (v: string) => v.replace(/[^0-9.]/g, '')

  const save = async () => {
    const problems: string[] = []
    if (!f.purpose.trim()) problems.push('Describe the purpose of the trip.')
    if (!f.from_city.trim()) problems.push('Enter the city you are travelling from.')
    if (!f.to_city.trim()) problems.push('Enter the destination city.')
    if (!f.depart_date) problems.push('Pick the departure date.')
    if (f.depart_date && f.return_date && f.return_date < f.depart_date) problems.push('Return date cannot be before the departure date.')
    if (problems.length) { setError(problems); return }
    setSaving(true); setError([])
    const payload = {
      purpose: f.purpose.trim(), from_city: f.from_city.trim(), to_city: f.to_city.trim(), depart_date: f.depart_date,
      return_date: f.return_date || null, travel_mode: f.travel_mode, accommodation_required: f.accommodation_required,
      advance_required: f.advance_required || '0', estimated_cost: f.estimated_cost || null, project_reference: f.project_reference || null,
    }
    try {
      const t = request ? await hrApi.updateTravel(request.id, payload) : await hrApi.createTravel(payload)
      onSaved(t)
    } catch (err) {
      setError(extractErrorMessages(err, 'The travel request could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormDialog
      open={open}
      icon={request ? 'edit' : 'truck'}
      title={request ? `Edit ${request.request_no}` : 'New travel request'}
      subtitle={request ? `${request.from_city} → ${request.to_city} — changes go to the approver.` : 'Goes to your reporting manager for approval (or to HR if you have no manager set).'}
      onClose={onClose}
      busy={saving}
      maxWidth={960}
      bare
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" data-tour="hr-travel-form-save" style={sheetBtn('primary', SHEET.BLUE, saving)} onClick={save} disabled={saving}><SheetIcon name={request ? 'check' : 'send'} size={16} />{saving ? 'Saving…' : request ? 'Save changes' : 'Submit request'}</button>
      </>}
    >
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <SheetSection icon="list" title="Trip">
            <label style={sheetLabel}>Purpose <Req /></label>
            <textarea rows={2} data-tour="hr-travel-form-purpose" style={{ ...sheetInput, resize: 'vertical' }} value={f.purpose} onChange={(e) => set('purpose')(e.target.value)} placeholder="Customer site visit, vendor audit, training…" />
            <div style={{ ...row, marginTop: 12 }}>
              <Fld label="From" req basis={180} grow max={260}><input data-tour="hr-travel-form-from" style={sheetInput} value={f.from_city} onChange={(e) => set('from_city')(e.target.value)} /></Fld>
              <Fld label="To" req basis={180} grow max={260}><input data-tour="hr-travel-form-to" style={sheetInput} value={f.to_city} onChange={(e) => set('to_city')(e.target.value)} /></Fld>
            </div>
          </SheetSection>
          <SheetSection icon="calendar" title="Schedule">
            <div data-tour="hr-travel-form-dates" style={row}>
              <Fld label="Depart" req basis={160}><DateField value={f.depart_date} onChange={set('depart_date')} /></Fld>
              <Fld label="Return" basis={160}><DateField value={f.return_date} onChange={set('return_date')} /></Fld>
              <Fld label="Mode" basis={180}>
                <Select data-tour="hr-travel-form-mode" style={sheetInput} value={f.travel_mode} onChange={(e) => set('travel_mode')(e.target.value)}>
                  {Object.entries(TRAVEL_MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Fld>
            </div>
            <label data-tour="hr-travel-form-accommodation" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: SHEET.BODY, cursor: 'pointer', marginTop: 14 }}>
              <input type="checkbox" checked={f.accommodation_required} onChange={(e) => set('accommodation_required')(e.target.checked)} />
              Accommodation required
            </label>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="rupee" title="Cost & Advance">
            <label style={sheetLabel}>Estimated cost (₹)</label>
            <input data-tour="hr-travel-form-cost" style={sheetInput} inputMode="decimal" value={f.estimated_cost} onChange={(e) => set('estimated_cost')(money(e.target.value))} />
            <label style={{ ...sheetLabel, marginTop: 14 }}>Advance needed (₹)</label>
            <input data-tour="hr-travel-form-advance" style={sheetInput} inputMode="decimal" value={f.advance_required} onChange={(e) => set('advance_required')(money(e.target.value))} placeholder="0" />
          </SheetSection>
          <SheetSection icon="link" title="Reference" extra={<Optional />}>
            <label style={sheetLabel}>Project / reference</label>
            <input data-tour="hr-travel-form-project" style={sheetInput} value={f.project_reference} onChange={(e) => set('project_reference')(e.target.value)} />
          </SheetSection>
        </>}
      />
    </FormDialog>
  )
}

/** Compact read-only summary used in approval cards and the HR list. */
export function TravelSummary({ t }: { t: HrTravelRequest }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12.5, color: TEXT.body }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading }}>{t.from_city} → {t.to_city}</span>
      <span>{fmtDate(t.depart_date)}{t.return_date ? ` – ${fmtDate(t.return_date)}` : ''} · {TRAVEL_MODE_LABELS[t.travel_mode] || titleCase(t.travel_mode)}{t.accommodation_required ? ' · stay needed' : ''}</span>
      <span style={{ color: TEXT.muted }}>{t.purpose}</span>
      <span style={{ color: TEXT.muted }}>
        Est. {fmtINR(t.estimated_cost)}{Number(t.advance_required) > 0 ? ` · advance ${fmtINR(t.advance_required)}` : ''}{t.project_reference ? ` · ${t.project_reference}` : ''}
      </span>
    </div>
  )
}
