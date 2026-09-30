'use client'

import { useEffect, useState } from 'react'
import { hrApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrTravelRequest } from '@/types'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { FormDialog, ErrorBanner, formInputStyle, labelStyle, primaryActionStyle, fmtDate, fmtINR, titleCase } from './adminUi'
import { TEXT } from '@/lib/theme'

export const TRAVEL_MODE_LABELS: Record<string, string> = {
  air: 'Air', train: 'Train', bus: 'Bus', car: 'Own / hired car', company_vehicle: 'Company vehicle', other: 'Other',
}
export const TRAVEL_STATUS_LABELS: Record<string, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Completed' }
export const TRAVEL_STATUS_HEX: Record<string, string> = { pending: '#F59E0B', approved: '#16A34A', rejected: '#DC2626', cancelled: '#64748B', completed: '#2563EB' }

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 }

function Fld({ label, children, basis = 200, grow = false, max }: { label: string; children: React.ReactNode; basis?: number; grow?: boolean; max?: number }) {
  return (
    <div style={{ flex: grow ? `1 1 ${basis}px` : `0 1 ${basis}px`, minWidth: Math.min(basis, 130), maxWidth: max }}>
      <label style={labelStyle}>{label}</label>
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
      title={request ? `Edit ${request.request_no}` : 'New travel request'}
      subtitle={request ? undefined : 'Goes to your reporting manager for approval (or to HR if you have no manager set).'}
      onClose={onClose}
      maxWidth={640}
      footer={<>
        <button type="button" style={secondaryBtnStyle} onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" style={{ ...primaryActionStyle, opacity: saving ? 0.7 : 1 }} onClick={save} disabled={saving}>{saving ? 'Saving…' : request ? 'Save changes' : 'Submit request'}</button>
      </>}
    >
      <ErrorBanner error={error} />
      <div>
        <label style={labelStyle}>Purpose *</label>
        <textarea rows={2} style={{ ...formInputStyle, resize: 'vertical' }} value={f.purpose} onChange={(e) => set('purpose')(e.target.value)} placeholder="Customer site visit, vendor audit, training…" />
      </div>
      <div style={row}>
        <Fld label="From *" basis={180} grow max={260}><input style={formInputStyle} value={f.from_city} onChange={(e) => set('from_city')(e.target.value)} /></Fld>
        <Fld label="To *" basis={180} grow max={260}><input style={formInputStyle} value={f.to_city} onChange={(e) => set('to_city')(e.target.value)} /></Fld>
      </div>
      <div style={row}>
        <Fld label="Depart *" basis={160}><DateField value={f.depart_date} onChange={set('depart_date')} /></Fld>
        <Fld label="Return" basis={160}><DateField value={f.return_date} onChange={set('return_date')} /></Fld>
        <Fld label="Mode" basis={180}>
          <select style={formInputStyle} value={f.travel_mode} onChange={(e) => set('travel_mode')(e.target.value)}>
            {Object.entries(TRAVEL_MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Fld>
      </div>
      <div style={row}>
        <Fld label="Estimated cost (₹)" basis={160}><input style={formInputStyle} inputMode="decimal" value={f.estimated_cost} onChange={(e) => set('estimated_cost')(money(e.target.value))} /></Fld>
        <Fld label="Advance needed (₹)" basis={160}><input style={formInputStyle} inputMode="decimal" value={f.advance_required} onChange={(e) => set('advance_required')(money(e.target.value))} placeholder="0" /></Fld>
        <Fld label="Project / reference" basis={200} grow max={280}><input style={formInputStyle} value={f.project_reference} onChange={(e) => set('project_reference')(e.target.value)} /></Fld>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer' }}>
        <input type="checkbox" checked={f.accommodation_required} onChange={(e) => set('accommodation_required')(e.target.checked)} />
        Accommodation required
      </label>
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
