'use client'

import Select from '@/components/shared/Select'
// Create / edit form of a customer AMC / CMC service contract (VA41 / VA42).
// Machines are the customer's own installed base (erp_projects.customer_id).

import { useEffect, useState } from 'react'
import { erpApi } from '@/lib/api'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { ServiceContract } from '@/lib/sdServiceApi'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, FormSheet, SheetColumns, SheetSection, SheetIcon, SHEET, Optional, Req, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

export const CONTRACT_TYPE_LABELS: Record<string, string> = { amc: 'AMC (labour & visits)', cmc: 'CMC (comprehensive)', extended_warranty: 'Extended warranty' }
export const FREQUENCY_LABELS: Record<string, string> = { upfront: 'Upfront (once)', monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', annual: 'Annual' }

export interface ContractFormValue {
  contract_type: string; title: string; customer_id: string; start_date: string; end_date: string; contract_value: string
  gst_rate: string; sac_code: string; billing_frequency: string; bill_in_advance: boolean; visits_included: string
  labour_covered: boolean; spares_covered: boolean; sla_response_hours: string; sla_resolution_hours: string
  customer_po_number: string; customer_po_date: string; terms: string; machine_ids: number[]
}

export function contractToForm(c?: ServiceContract | null): ContractFormValue {
  // Local calendar dates — toISOString() is UTC and gives the day before in IST.
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const t = new Date()
  const start = ymd(t)
  const end = ymd(new Date(t.getFullYear() + 1, t.getMonth(), t.getDate() - 1))
  return {
    contract_type: c?.contract_type || 'amc', title: c?.title || '', customer_id: c ? String(c.customer_id) : '',
    start_date: c?.start_date || start, end_date: c?.end_date || end, contract_value: c ? String(c.contract_value) : '',
    gst_rate: c ? String(c.gst_rate) : '18', sac_code: c?.sac_code || '', billing_frequency: c?.billing_frequency || 'quarterly',
    bill_in_advance: c ? c.bill_in_advance : true, visits_included: c ? String(c.visits_included) : '4',
    labour_covered: c ? c.labour_covered : true, spares_covered: c ? c.spares_covered : false,
    sla_response_hours: c?.sla_response_hours ? String(c.sla_response_hours) : '', sla_resolution_hours: c?.sla_resolution_hours ? String(c.sla_resolution_hours) : '',
    customer_po_number: c?.customer_po_number || '', customer_po_date: c?.customer_po_date || '', terms: c?.terms || '',
    machine_ids: c ? c.machines.map((m) => m.project_id) : [],
  }
}

export function formToPayload(f: ContractFormValue): Record<string, unknown> {
  const n = (v: string) => (v.trim() === '' ? null : Number(v))
  return {
    contract_type: f.contract_type, title: f.title || null, customer_id: Number(f.customer_id), start_date: f.start_date, end_date: f.end_date,
    contract_value: Number(f.contract_value || 0), gst_rate: Number(f.gst_rate || 0), sac_code: f.sac_code || null,
    billing_frequency: f.billing_frequency, bill_in_advance: f.bill_in_advance, visits_included: Number(f.visits_included || 0),
    labour_covered: f.labour_covered, spares_covered: f.spares_covered, sla_response_hours: n(f.sla_response_hours),
    sla_resolution_hours: n(f.sla_resolution_hours), customer_po_number: f.customer_po_number || null,
    customer_po_date: f.customer_po_date || null, terms: f.terms || null, machine_ids: f.machine_ids,
  }
}

/** Contract form. `variant="page"` renders a FormPage (the /new route);
 * `variant="sheet"` renders a FormSheet popup (edit on the detail page). */
export default function ServiceContractForm({ initial, saving, onSave, onCancel, lockCustomer, error, variant, title, subtitle, nav }: {
  initial: ContractFormValue; saving: boolean; onSave: (f: ContractFormValue) => void | boolean | Promise<boolean | void>; onCancel: () => void; lockCustomer?: boolean
  /** Shown as the red banner inside the form. */
  error?: string[]
  variant: 'page' | 'sheet'
  title: string
  subtitle: string
  /** Module sub-nav (page variant only) — rendered above the header. */
  nav?: React.ReactNode
}) {
  const [f, setF] = useState<ContractFormValue>(initial)
  const [customers, setCustomers] = useState<{ value: string; label: string }[]>([])
  const [machines, setMachines] = useState<{ id: number; serial_number: string; model_name: string | null; site_name: string | null }[]>([])
  const set = (p: Partial<ContractFormValue>) => setF((x) => ({ ...x, ...p }))
  // A new contract's typed data survives a refresh / network failure (lib/formDraft.ts). The page's onSave returns true once saved.
  const draft = useFormDraft(variant === 'page' ? 'erp-service-contract-new' : null, f,
    (d) => setF({ ...initial, ...d, machine_ids: Array.isArray(d.machine_ids) ? d.machine_ids : [] }))

  useEffect(() => {
    erpApi.getProjectLinkOptions().then((o) => setCustomers(o.customers.map((c) => ({ value: String(c.id), label: c.label || c.name })))).catch(() => setCustomers([]))
  }, [])
  useEffect(() => {
    if (!f.customer_id) { const t = setTimeout(() => setMachines([]), 0); return () => clearTimeout(t) }
    erpApi.listProjects({ customer_id: Number(f.customer_id), limit: 500 }).then((r: unknown) => {
      const rows = (Array.isArray(r) ? r : (r as { items?: unknown[] }).items || []) as { id: number; serial_number: string; model_name: string | null; site_name: string | null }[]
      setMachines(rows)
    }).catch(() => setMachines([]))
  }, [f.customer_id])

  const comprehensive = f.contract_type !== 'amc'
  const toggle = (id: number) => set({ machine_ids: f.machine_ids.includes(id) ? f.machine_ids.filter((x) => x !== id) : [...f.machine_ids, id] })
  const check: React.CSSProperties = { fontSize: 13, color: SHEET.BODY, display: 'flex', alignItems: 'center', gap: 6 }

  const footer = (
    <>
      <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} onClick={onCancel} disabled={saving}>Cancel</button>
      <button type="button" style={sheetBtn('primary', SHEET.BLUE, saving)} onClick={() => { Promise.resolve(onSave(f)).then((ok) => { if (ok === true) draft.clear() }) }} disabled={saving}>
        <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save draft'}
      </button>
    </>
  )

  const body = (
    <SheetColumns
      left={<>
        <DraftBanner draft={draft} />
        {error && error.length > 0 && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error.join(' ')}</div>
        )}
        <SheetSection icon="doc" title="Contract">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '0 1 220px', minWidth: 200 }}>
              <label style={sheetLabel}>Contract type</label>
              <Select style={sheetInput} value={f.contract_type} onChange={(e) => set({ contract_type: e.target.value, ...(e.target.value !== 'amc' ? { labour_covered: true, spares_covered: true } : {}) })}>
                {Object.entries(CONTRACT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
            <div style={{ flex: '1 1 260px', maxWidth: 420 }}>
              <label style={sheetLabel}>Customer {!lockCustomer && <Req />}</label>
              {lockCustomer ? <div style={{ fontSize: 13, paddingTop: 8, color: SHEET.INK }}>{customers.find((c) => c.value === f.customer_id)?.label || '—'}</div>
                : <SearchableSelect value={f.customer_id} onChange={(v) => set({ customer_id: v, machine_ids: [] })} options={customers} placeholder="Pick the CRM customer…" />}
            </div>
          </div>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Title <Optional /></label>
          <input style={sheetInput} value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. AMC 2026-27 — tower wagons" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}><label style={sheetLabel}>Start date</label><DateField value={f.start_date} onChange={(v) => set({ start_date: v })} /></div>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}><label style={sheetLabel}>End date</label><DateField value={f.end_date} onChange={(v) => set({ end_date: v })} /></div>
          </div>
        </SheetSection>
        <SheetSection icon="rupee" title="Value & Billing">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={sheetLabel}>Contract value ₹ (taxable)</label>
              <input type="number" min={0} style={sheetInput} value={f.contract_value} onChange={(e) => set({ contract_value: e.target.value })} />
            </div>
            <div style={{ flex: '0 1 90px', minWidth: 80 }}><label style={sheetLabel}>GST %</label><input type="number" min={0} max={40} style={sheetInput} value={f.gst_rate} onChange={(e) => set({ gst_rate: e.target.value })} /></div>
            <div style={{ flex: '0 1 110px', minWidth: 100 }}><label style={sheetLabel}>SAC</label><input style={sheetInput} value={f.sac_code} onChange={(e) => set({ sac_code: e.target.value })} placeholder="998717" /></div>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}>
              <label style={sheetLabel}>Billing</label>
              <Select style={sheetInput} value={f.billing_frequency} onChange={(e) => set({ billing_frequency: e.target.value })}>
                {Object.entries(FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
          </div>
          <label style={{ ...check, marginTop: 12 }}>
            <input type="checkbox" checked={f.bill_in_advance} onChange={(e) => set({ bill_in_advance: e.target.checked })} /> Bill each period in advance
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
            <div style={{ flex: '0 1 200px', minWidth: 170 }}><label style={sheetLabel}>Customer PO no.</label><input style={sheetInput} value={f.customer_po_number} onChange={(e) => set({ customer_po_number: e.target.value })} /></div>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}><label style={sheetLabel}>PO date</label><DateField value={f.customer_po_date} onChange={(v) => set({ customer_po_date: v })} /></div>
          </div>
        </SheetSection>
        <SheetSection icon="shield" title="Coverage & SLA">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '0 1 130px', minWidth: 120 }}><label style={sheetLabel}>Visits included</label><input type="number" min={0} style={sheetInput} value={f.visits_included} onChange={(e) => set({ visits_included: e.target.value })} /></div>
            <div style={{ flex: '0 1 140px', minWidth: 130 }}><label style={sheetLabel}>SLA response (h)</label><input type="number" min={1} style={sheetInput} value={f.sla_response_hours} onChange={(e) => set({ sla_response_hours: e.target.value })} /></div>
            <div style={{ flex: '0 1 150px', minWidth: 140 }}><label style={sheetLabel}>SLA resolution (h)</label><input type="number" min={1} style={sheetInput} value={f.sla_resolution_hours} onChange={(e) => set({ sla_resolution_hours: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
            <label style={check}>
              <input type="checkbox" disabled={comprehensive} checked={f.labour_covered} onChange={(e) => set({ labour_covered: e.target.checked })} /> Labour & visits covered
            </label>
            <label style={check}>
              <input type="checkbox" disabled={comprehensive} checked={f.spares_covered} onChange={(e) => set({ spares_covered: e.target.checked })} /> Spares covered
            </label>
          </div>
          {comprehensive && <p style={sheetHint}>CMC and extended warranty always cover labour and spares.</p>}
        </SheetSection>
      </>}
      right={<>
        <SheetSection icon="truck" title={`Covered machines (${f.machine_ids.length})`}>
          {!f.customer_id ? <p style={{ ...sheetHint, margin: 0 }}>Pick the customer to list its machines.</p>
            : machines.length === 0 ? <p style={{ ...sheetHint, margin: 0 }}>This customer has no machines linked in Service › Machines. Edit a machine and pick its Customer first.</p> : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                {machines.map((m) => (
                  <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '6px 10px', borderRadius: 9999, border: `1px solid ${SHEET.LINE}`, background: f.machine_ids.includes(m.id) ? '#eff6ff' : '#fff', cursor: 'pointer', color: SHEET.BODY }}>
                    <input type="checkbox" checked={f.machine_ids.includes(m.id)} onChange={() => toggle(m.id)} />
                    {m.serial_number}{m.model_name ? ` · ${m.model_name}` : ''}{m.site_name ? ` · ${m.site_name}` : ''}
                  </label>
                ))}
              </div>
            )}
        </SheetSection>
        <SheetSection icon="list" title="Terms" extra={<Optional />}>
          <textarea style={{ ...sheetInput, minHeight: 110, resize: 'vertical' }} value={f.terms} onChange={(e) => set({ terms: e.target.value })} />
        </SheetSection>
      </>}
    />
  )

  if (variant === 'sheet') {
    return (
      <FormSheet icon="edit" title={title} subtitle={subtitle} onClose={onCancel} busy={saving} footer={footer}>
        {body}
      </FormSheet>
    )
  }
  return (
    <FormPage icon="doc" title={title} subtitle={subtitle} onBack={onCancel} backTour="erp-scf-back" nav={nav} footer={footer}>
      {body}
    </FormPage>
  )
}
