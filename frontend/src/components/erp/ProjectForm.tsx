'use client'

import { useRef, useState } from 'react'
import { Project } from '@/types'
import DateField from './DateField'
import PhoneField, { isPhoneValid } from './PhoneField'
import YearField, { isFinancialYearValid } from './YearField'
import ValidatedInput from '@/components/ValidatedInput'
import { isValidEmail, isValidGST, VALIDATION_MESSAGES } from '@/lib/validation'

const MACHINE_TYPES = ['Road Rail', 'Rail Bound', 'Accessories', 'Other']
const APPLICATION_TYPES = ['OHE', 'FBW', 'CMC - Shunting', 'Track Laying', 'Other']
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'under_service', label: 'Under Service' },
  { value: 'manufacturing_under_progress', label: 'Manufacturing Under Progress' },
  { value: 'work_in_progress', label: 'Work in Progress' },
  { value: 'standby', label: 'Standby' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'decommissioned', label: 'Decommissioned' },
  { value: 'cancel', label: 'Cancel' },
]
const INDIA_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh',
  'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]
const AMC_STATUS_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'Active', label: 'Active AMC' },
  { value: 'Expired', label: 'Expired Contract' },
]
const WARRANTY_STATUS_OPTIONS = [
  { value: 'none', label: 'No Warranty' },
  { value: 'active', label: 'Active Warranty Period' },
]

const TABS = ['Machine Identity', 'Client & Site', 'Technical Specs', 'Timeline & Warranty', 'Documents'] as const

type FormState = {
  serial_number: string
  model_name: string
  machine_type: string
  engine_number: string
  chassis_number: string
  application_type: string
  status: string
  year_of_manufacture: string
  po_number: string
  po_date: string
  delivery_date: string
  commissioning_date: string
  handover_date: string
  client_company: string
  client_name: string
  client_designation: string
  client_email: string
  client_phone: string
  client_phone_alt: string
  client_address: string
  client_gst: string
  site_name: string
  site_location: string
  site_state: string
  site_pincode: string
  site_country: string
  zone: string
  warranty_start_date: string
  warranty_end_date: string
  warranty_override: string
  amc_status: string
  amc_end_date: string
  operator_name: string
  operator_phone: string
  operator_email: string
  operator_qualification: string
  specifications: string
  installed_options: string
  software_version: string
  tech_notes: string
  notes: string
}

function toFormState(initial?: Partial<Project>): FormState {
  return {
    serial_number: initial?.serial_number || '',
    model_name: initial?.model_name || '',
    machine_type: initial?.machine_type && !MACHINE_TYPES.includes(initial.machine_type) ? 'Other' : initial?.machine_type || '',
    engine_number: initial?.engine_number || '',
    chassis_number: initial?.chassis_number || '',
    application_type: initial?.application_type && !APPLICATION_TYPES.includes(initial.application_type) ? 'Other' : initial?.application_type || '',
    status: initial?.status || 'active',
    year_of_manufacture: initial?.year_of_manufacture || '',
    po_number: initial?.po_number || '',
    po_date: initial?.po_date || '',
    delivery_date: initial?.delivery_date || '',
    commissioning_date: initial?.commissioning_date || '',
    handover_date: initial?.handover_date || '',
    client_company: initial?.client_company || '',
    client_name: initial?.client_name || '',
    client_designation: initial?.client_designation || '',
    client_email: initial?.client_email || '',
    client_phone: initial?.client_phone || '',
    client_phone_alt: initial?.client_phone_alt || '',
    client_address: initial?.client_address || '',
    client_gst: initial?.client_gst || '',
    site_name: initial?.site_name || '',
    site_location: initial?.site_location || '',
    site_state: initial?.site_state || '',
    site_pincode: initial?.site_pincode || '',
    site_country: initial?.site_country || 'India',
    zone: initial?.zone || '',
    warranty_start_date: initial?.warranty_start_date || '',
    warranty_end_date: initial?.warranty_end_date || '',
    warranty_override: initial?.warranty_override || '',
    amc_status: initial?.amc_status || '',
    amc_end_date: initial?.amc_end_date || '',
    operator_name: initial?.operator_name || '',
    operator_phone: initial?.operator_phone || '',
    operator_email: initial?.operator_email || '',
    operator_qualification: initial?.operator_qualification || '',
    specifications: initial?.specifications || '',
    installed_options: initial?.installed_options || '',
    software_version: initial?.software_version || '',
    tech_notes: initial?.tech_notes || '',
    notes: initial?.notes || '',
  }
}

export default function ProjectForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<Project>
  submitLabel: string
  onSubmit: (payload: Record<string, unknown>, files: File[]) => Promise<void>
  onCancel: () => void
}) {
  const [tabIndex, setTabIndex] = useState(0)
  const [form, setForm] = useState<FormState>(() => toFormState(initial))
  const [isExport, setIsExport] = useState(!!initial?.is_export)
  const [extendedWarranty, setExtendedWarranty] = useState(!!initial?.extended_warranty)
  const [extendedWarrantyEnd, setExtendedWarrantyEnd] = useState(initial?.extended_warranty_end || '')
  const [warrantyStatus, setWarrantyStatus] = useState(initial?.warranty_start_date ? 'active' : 'none')
  const [machineTypeCustom, setMachineTypeCustom] = useState(
    initial?.machine_type && !MACHINE_TYPES.includes(initial.machine_type) ? initial.machine_type : ''
  )
  const [applicationTypeCustom, setApplicationTypeCustom] = useState(
    initial?.application_type && !APPLICATION_TYPES.includes(initial.application_type) ? initial.application_type : ''
  )
  const [queuedFiles, setQueuedFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const addFiles = (files: FileList | null) => {
    if (!files) return
    setQueuedFiles((prev) => [...prev, ...Array.from(files)])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.serial_number.trim()) {
      setError('Serial number is required.')
      setTabIndex(0)
      return
    }
    if (form.machine_type === 'Other' && !machineTypeCustom.trim()) {
      setError('Please specify the custom machine classification.')
      setTabIndex(0)
      return
    }
    if (form.application_type === 'Other' && !applicationTypeCustom.trim()) {
      setError('Please specify the custom application type.')
      setTabIndex(0)
      return
    }
    if (!form.client_company.trim()) {
      setError('Client company is required.')
      setTabIndex(1)
      return
    }
    if (!isPhoneValid(form.client_phone) || !isPhoneValid(form.client_phone_alt) || !isPhoneValid(form.operator_phone)) {
      setError('Please enter a valid phone number before saving.')
      setTabIndex(!isPhoneValid(form.client_phone) || !isPhoneValid(form.client_phone_alt) ? 1 : 2)
      return
    }
    if (!isFinancialYearValid(form.year_of_manufacture)) {
      setError('Please enter a valid financial year format (e.g. 2026-27).')
      setTabIndex(0)
      return
    }
    if (!isValidEmail(form.client_email) || !isValidEmail(form.operator_email)) {
      setError(VALIDATION_MESSAGES.email)
      setTabIndex(!isValidEmail(form.client_email) ? 1 : 2)
      return
    }
    if (!isValidGST(form.client_gst)) {
      setError(VALIDATION_MESSAGES.gst)
      setTabIndex(1)
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        ...form,
        machine_type: form.machine_type === 'Other' ? machineTypeCustom : form.machine_type,
        application_type: form.application_type === 'Other' ? applicationTypeCustom : form.application_type,
        is_export: isExport,
        extended_warranty: extendedWarranty,
        extended_warranty_end: extendedWarranty ? extendedWarrantyEnd : '',
        warranty_start_date: warrantyStatus === 'active' ? form.warranty_start_date : '',
        warranty_end_date: warrantyStatus === 'active' ? form.warranty_end_date : '',
      }
      Object.keys(payload).forEach((k) => {
        if (payload[k] === '') delete payload[k]
      })
      await onSubmit(payload, queuedFiles)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to save project.')
    } finally {
      setSaving(false)
    }
  }

  const goNext = () => setTabIndex((i) => Math.min(TABS.length - 1, i + 1))
  const goPrev = () => setTabIndex((i) => Math.max(0, i - 1))

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
        {TABS.map((t, i) => (
          <button
            key={t}
            type="button"
            onClick={() => setTabIndex(i)}
            style={{
              padding: '10px 6px',
              marginRight: 16,
              border: 'none',
              background: 'transparent',
              borderBottom: tabIndex === i ? '2px solid #fa9b9b' : '2px solid transparent',
              color: tabIndex === i ? '#fa9b9b' : '#78716c',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {tabIndex === 0 && (
          <Section title="Machine Asset Identity">
            <Grid3>
              <Field label="Serial Number *"><input value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} placeholder="e.g. PNR-RR-2026-88" style={inputStyle} /></Field>
              <Field label="Model Name *"><input value={form.model_name} onChange={(e) => set('model_name', e.target.value)} placeholder="e.g. Catenary Track Car Pro" style={inputStyle} /></Field>
              <Field label="Machine Classification *">
                <select value={form.machine_type} onChange={(e) => set('machine_type', e.target.value)} style={inputStyle}>
                  <option value="">-- Select Machine Type --</option>
                  {MACHINE_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>

              {form.machine_type === 'Other' && (
                <Field label="Custom Class Specification *">
                  <input value={machineTypeCustom} onChange={(e) => setMachineTypeCustom(e.target.value)} placeholder="Specify other classification" style={inputStyle} />
                </Field>
              )}
              <Field label="Engine Number"><input value={form.engine_number} onChange={(e) => set('engine_number', e.target.value)} placeholder="Optional Engine ID" style={inputStyle} /></Field>
              <Field label="Chassis Number"><input value={form.chassis_number} onChange={(e) => set('chassis_number', e.target.value)} placeholder="Optional Chassis ID" style={inputStyle} /></Field>

              <Field label="Year of Manufacture"><YearField value={form.year_of_manufacture} onChange={(v) => set('year_of_manufacture', v)} style={inputStyle} /></Field>
              <Field label="Operational Status *">
                <select value={form.status} onChange={(e) => set('status', e.target.value)} style={inputStyle}>
                  {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Application Type">
                <select value={form.application_type} onChange={(e) => set('application_type', e.target.value)} style={inputStyle}>
                  <option value="">-- Select Application Type --</option>
                  {APPLICATION_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>

              {form.application_type === 'Other' && (
                <Field label="Custom Application Specifications *">
                  <input value={applicationTypeCustom} onChange={(e) => setApplicationTypeCustom(e.target.value)} placeholder="Enter custom application specifications" style={inputStyle} />
                </Field>
              )}
            </Grid3>
            <Field label="Production Notes & Core Details">
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} placeholder="Enter other critical identity comments..." style={{ ...inputStyle, resize: 'vertical' }} />
            </Field>
          </Section>
        )}

        {tabIndex === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Section title="Operational Site Location">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#57534e' }}>
                <input
                  type="checkbox"
                  checked={isExport}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setIsExport(checked)
                    if (checked) {
                      set('site_state', '')
                    } else {
                      set('site_country', 'India')
                    }
                  }}
                />
                International / Export Deployment
              </label>
              <Row>
                <Field label="Site Name"><input value={form.site_name} onChange={(e) => set('site_name', e.target.value)} placeholder="Enter railway station/site name" style={inputStyle} /></Field>
                <Field label="Site Location"><input value={form.site_location} onChange={(e) => set('site_location', e.target.value)} placeholder="City or Division" style={inputStyle} /></Field>
              </Row>
              <Row>
                {isExport ? (
                  <Field label="Country">
                    <input value={form.site_country} onChange={(e) => set('site_country', e.target.value)} placeholder="Enter country name" style={inputStyle} />
                  </Field>
                ) : (
                  <Field label="State">
                    <select value={form.site_state} onChange={(e) => set('site_state', e.target.value)} style={inputStyle}>
                      <option value="">-- Select State / UT --</option>
                      {INDIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Pincode"><input value={form.site_pincode} onChange={(e) => set('site_pincode', e.target.value)} placeholder="6-digit PIN code" style={inputStyle} /></Field>
              </Row>
              <Field label="Zone"><input value={form.zone} onChange={(e) => set('zone', e.target.value)} placeholder="e.g. Northern Railway (NR)" style={inputStyle} /></Field>
            </Section>

            <Section title="Client Details">
              <Field label="Client Company *"><input value={form.client_company} onChange={(e) => set('client_company', e.target.value)} placeholder="Enter client company name" style={inputStyle} /></Field>
              <Field label="Contact Person"><input value={form.client_name} onChange={(e) => set('client_name', e.target.value)} placeholder="Enter contact person name" style={inputStyle} /></Field>
              <Field label="Designation"><input value={form.client_designation} onChange={(e) => set('client_designation', e.target.value)} placeholder="e.g. Chief Engineer" style={inputStyle} /></Field>
              <Field label="Email"><ValidatedInput type="email" value={form.client_email} onChange={(v) => set('client_email', v)} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="Enter email address" style={inputStyle} /></Field>
              <Row>
                <Field label="Phone"><PhoneField value={form.client_phone} onChange={(v) => set('client_phone', v)} style={inputStyle} /></Field>
                <Field label="Alternate Phone"><PhoneField value={form.client_phone_alt} onChange={(v) => set('client_phone_alt', v)} style={inputStyle} /></Field>
              </Row>
              <Field label="GST Number"><ValidatedInput value={form.client_gst} onChange={(v) => set('client_gst', v.toUpperCase())} validator={isValidGST} errorMessage={VALIDATION_MESSAGES.gst} placeholder="15-digit GSTIN" style={inputStyle} /></Field>
              <Field label="Address">
                <textarea value={form.client_address} onChange={(e) => set('client_address', e.target.value)} rows={2} placeholder="Client corporate/billing address..." style={{ ...inputStyle, resize: 'vertical' }} />
              </Field>
            </Section>

            <Section title="Operator Details">
              <Field label="Operator Name"><input value={form.operator_name} onChange={(e) => set('operator_name', e.target.value)} placeholder="Enter machine operator name" style={inputStyle} /></Field>
              <Row>
                <Field label="Phone"><PhoneField value={form.operator_phone} onChange={(v) => set('operator_phone', v)} style={inputStyle} /></Field>
                <Field label="Email"><ValidatedInput type="email" value={form.operator_email} onChange={(v) => set('operator_email', v)} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="Enter email address" style={inputStyle} /></Field>
              </Row>
              <Field label="Qualification"><input value={form.operator_qualification} onChange={(e) => set('operator_qualification', e.target.value)} placeholder="e.g. Certified Loco Pilot" style={inputStyle} /></Field>
            </Section>
          </div>
        )}

        {tabIndex === 2 && (
          <Section title="Technical Specifications">
            <Field label="Specifications">
              <textarea value={form.specifications} onChange={(e) => set('specifications', e.target.value)} rows={3} placeholder="List model engine power, capacity, and key metrics..." style={{ ...inputStyle, resize: 'vertical' }} />
            </Field>
            <Field label="Installed Options">
              <textarea value={form.installed_options} onChange={(e) => set('installed_options', e.target.value)} rows={3} placeholder="Any specialized modular items installed..." style={{ ...inputStyle, resize: 'vertical' }} />
            </Field>
            <Field label="Software Version"><input value={form.software_version} onChange={(e) => set('software_version', e.target.value)} placeholder="e.g. v2.4.1" style={inputStyle} /></Field>
            <Field label="Notes">
              <textarea value={form.tech_notes} onChange={(e) => set('tech_notes', e.target.value)} rows={2} placeholder="Additional engineering notes..." style={{ ...inputStyle, resize: 'vertical' }} />
            </Field>
          </Section>
        )}

        {tabIndex === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Section title="Procurement & Delivery Information">
              <Grid3>
                <Field label="PO Number"><input value={form.po_number} onChange={(e) => set('po_number', e.target.value)} placeholder="Purchase Order Ref" style={inputStyle} /></Field>
                <Field label="PO Date"><DateField value={form.po_date} onChange={(v) => set('po_date', v)} /></Field>
                <Field label="Dispatch Date"><DateField value={form.delivery_date} onChange={(v) => set('delivery_date', v)} /></Field>
                <Field label="Commissioning Date"><DateField value={form.commissioning_date} onChange={(v) => set('commissioning_date', v)} /></Field>
                <Field label="Handover Date"><DateField value={form.handover_date} onChange={(v) => set('handover_date', v)} /></Field>
              </Grid3>
            </Section>

            <Section title="Warranty Coverage Details">
              <Field label="Warranty Status">
                <select value={warrantyStatus} onChange={(e) => setWarrantyStatus(e.target.value)} style={inputStyle}>
                  {WARRANTY_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              {warrantyStatus === 'active' && (
                <Row>
                  <Field label="Warranty Commencement"><DateField value={form.warranty_start_date} onChange={(v) => set('warranty_start_date', v)} /></Field>
                  <Field label="Warranty Expiration"><DateField value={form.warranty_end_date} onChange={(v) => set('warranty_end_date', v)} /></Field>
                </Row>
              )}
              <Field label="Warranty Terms & Scope">
                <input value={form.warranty_override} onChange={(e) => set('warranty_override', e.target.value)} placeholder="Clauses, limit conditions" style={inputStyle} />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#57534e' }}>
                <input type="checkbox" checked={extendedWarranty} onChange={(e) => setExtendedWarranty(e.target.checked)} />
                Extended Warranty
              </label>
              {extendedWarranty && (
                <Field label="Extended Warranty End">
                  <DateField value={extendedWarrantyEnd} onChange={setExtendedWarrantyEnd} />
                </Field>
              )}
              <Field label="AMC Service Status">
                <select value={form.amc_status} onChange={(e) => set('amc_status', e.target.value)} style={inputStyle}>
                  {AMC_STATUS_OPTIONS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              {form.amc_status && (
                <Field label="AMC End Date"><DateField value={form.amc_end_date} onChange={(v) => set('amc_end_date', v)} /></Field>
              )}
            </Section>
          </div>
        )}

        {tabIndex === 4 && (
          <Section title="Attachments & Documents">
            <p style={{ fontSize: 12.5, color: '#78716c', margin: '-6px 0 4px' }}>PDFs, Office files, images, and videos — max 10GB each</p>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
              style={{
                padding: '32px 20px',
                borderRadius: 14,
                border: `2px dashed ${dragOver ? '#fa9b9b' : 'rgba(0,0,0,0.15)'}`,
                background: dragOver ? 'rgba(244,113,59,0.05)' : '#fff',
                textAlign: 'center',
                cursor: 'pointer',
              }}
            >
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
              <p style={{ fontSize: 13.5, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>Drag &amp; drop files here</p>
              <p style={{ fontSize: 12.5, color: '#a8a29e', margin: 0 }}>or click to browse</p>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
                {['PDF', 'DOCX', 'XLSX', 'JPG/PNG', 'MP4'].map((t) => (
                  <span key={t} style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: 'rgba(0,0,0,0.05)', color: '#78716c' }}>{t}</span>
                ))}
              </div>
            </div>
            {queuedFiles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {queuedFiles.map((f, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <span style={{ fontSize: 12.5, color: '#57534e' }}>{f.name}</span>
                    <button type="button" onClick={() => setQueuedFiles((prev) => prev.filter((_, idx) => idx !== i))} style={{ border: 'none', background: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 20 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
            {tabIndex > 0 && <button type="button" onClick={goPrev} style={secondaryBtnStyle}>Previous</button>}
            {tabIndex < TABS.length - 1 && <button type="button" onClick={goNext} style={secondaryBtnStyle}>Next</button>}
          </div>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 18, borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)' }}>
      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#fa9b9b', margin: '0 0 14px' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>
}

function Grid3({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>{children}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#57534e', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.1)',
  background: '#fff',
  fontSize: 13.5,
  outline: 'none',
  boxSizing: 'border-box',
}

const primaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  padding: '10px 22px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)',
  color: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const secondaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: '10px 18px',
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.1)',
  background: '#fff',
  color: '#57534e',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
