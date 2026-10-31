'use client'

import Select from '@/components/shared/Select'
import { useEffect, useRef, useState } from 'react'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { DirectoryUser, Project } from '@/types'
import { usersApi } from '@/lib/api'
import DateField from './DateField'
import PhoneField, { isPhoneValid } from './PhoneField'
import YearField, { isFinancialYearValid } from './YearField'
import ValidatedInput from '@/components/ValidatedInput'
import { isValidEmail, isValidGST, VALIDATION_MESSAGES, extractErrorMessages } from '@/lib/validation'
import { Row } from '@/components/shared/ui'
import { FormPage, SheetSection, SheetIcon, SHEET, Optional, Req, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import SharePicker, { useShareSelection } from './SharePicker'
import Checkbox from '@/components/Checkbox'

export type ProjectAttachmentShareOptions = {
  isPrivate?: boolean
  sharedWithUserIds?: number[]
  sharedDepartments?: string[]
  sharedDesignations?: string[]
}

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
  currentUserId,
  onSubmit,
  onCancel,
  title,
  subtitle,
  nav,
  projectName,
  serialOptional,
}: {
  /** Project mode (New Project): the project name, asked first on Machine Identity. `banner` = the page's draft banner. */
  projectName?: { value: string; onChange: (v: string) => void; banner?: React.ReactNode }
  /** Serial number may be left blank (the server uses the project number). */
  serialOptional?: boolean
  initial?: Partial<Project>
  submitLabel: string
  currentUserId?: number
  onSubmit: (payload: Record<string, unknown>, files: File[], shareOptions?: ProjectAttachmentShareOptions) => Promise<void>
  /** "← Back" pill (top-right) and the footer Cancel. */
  onCancel: () => void
  title: string
  subtitle: string
  /** Module sub-nav, rendered above the header. */
  nav?: React.ReactNode
}) {
  const [tabIndex, setTabIndex] = useState(0)
  const tabLabels: string[] = [...TABS]
  const projectMode = !!projectName
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
  // A new machine's typed data survives a refresh / network failure (lib/formDraft.ts). The page-level project tab fields live in the page, not here.
  const draft = useFormDraft(initial ? null : 'erp-machine-new',
    { form, isExport, extendedWarranty, extendedWarrantyEnd, warrantyStatus, machineTypeCustom, applicationTypeCustom },
    (d) => {
      setForm(d.form); setIsExport(!!d.isExport); setExtendedWarranty(!!d.extendedWarranty); setExtendedWarrantyEnd(d.extendedWarrantyEnd || '')
      setWarrantyStatus(d.warrantyStatus || 'none'); setMachineTypeCustom(d.machineTypeCustom || ''); setApplicationTypeCustom(d.applicationTypeCustom || '')
    })
  const [queuedFiles, setQueuedFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const errorRef = useRef<HTMLDivElement>(null)
  // Bring a new error banner into view — the submit button sits in the sticky footer.
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [error])
  const [directory, setDirectory] = useState<DirectoryUser[]>([])
  const share = useShareSelection()
  // Existing CRM customer / Product links are kept as-is on edit; they are
  // no longer picked in this form.
  const customerId: number | null = initial?.customer_id ?? null
  const productId: number | null = initial?.product_id ?? null

  useEffect(() => {
    usersApi.directory().then(setDirectory).catch(() => setDirectory([]))
  }, [])

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

  const addFiles = (files: FileList | null) => {
    if (!files) return
    setQueuedFiles((prev) => [...prev, ...Array.from(files)])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (projectName && !projectName.value.trim()) {
      setError('Project name is required. Enter it on the Machine Identity tab.')
      setTabIndex(0)
      return
    }
    if (!serialOptional && !form.serial_number.trim()) {
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
      setError('Client company is required. Enter it on the Client & Site tab.')
      setTabIndex(1)
      return
    }
    if (projectMode && !form.po_number.trim()) {
      setError("Customer PO number is required. Enter the customer's purchase order number on the Timeline & Warranty tab.")
      setTabIndex(3)
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
        customer_id: customerId ?? '',
        product_id: productId ?? '',
      }
      // Create: leave blanks out. Edit: a blank must CLEAR the stored value
      // (e.g. switching to "No warranty"), so send null — the PATCH only
      // touches keys it receives.
      Object.keys(payload).forEach((k) => {
        if (payload[k] !== '') return
        if (initial) payload[k] = null
        else delete payload[k]
      })
      await onSubmit(payload, queuedFiles, {
        isPrivate: share.isPrivate,
        sharedWithUserIds: share.userIds,
        sharedDepartments: share.departments,
        sharedDesignations: share.designations,
      })
      draft.clear()
    } catch (err) {
      const msgs = extractErrorMessages(err, projectMode ? 'Failed to create the project.' : 'Failed to save project.')
      setError(msgs)
      // Server complaints about the project's own fields: show Machine Identity, where the project name is.
      if (projectMode && /project (number|name|manager)/i.test(Array.isArray(msgs) ? msgs.join(' ') : msgs)) setTabIndex(0)
    } finally {
      setSaving(false)
    }
  }

  const goNext = () => setTabIndex((i) => Math.min(tabLabels.length - 1, i + 1))
  const goPrev = () => setTabIndex((i) => Math.max(0, i - 1))

  const errorText = Array.isArray(error) ? error.join(' ') : error

  return (
    <form onSubmit={handleSubmit}>
      <FormPage tour="erp-pf-page" icon={initial ? 'edit' : 'truck'} title={title} subtitle={subtitle} onBack={onCancel} backTour="erp-pf-back" nav={nav}
        footer={<>
          <button type="button" onClick={onCancel} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)} data-tour="erp-pf-cancel-btn">Cancel</button>
          {tabIndex > 0 && <button type="button" onClick={goPrev} style={sheetBtn('secondary', SHEET.INK)}><SheetIcon name="left" size={14} />Previous</button>}
          {tabIndex < tabLabels.length - 1 &&<button type="button" onClick={goNext} style={sheetBtn('secondary', SHEET.INK)}>Next<SheetIcon name="right" size={14} /></button>}
          <button type="submit" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)} data-tour="erp-pf-submit-btn">
            <SheetIcon name="check" size={16} />{saving ? 'Saving…' : submitLabel}
          </button>
        </>}>
      <div style={{ display: 'flex', gap: 4, padding: '0 24px', borderBottom: `1px solid ${SHEET.LINE}`, flexWrap: 'wrap' }}>
        {tabLabels.map((t, i) => (
          <button
            key={t}
            type="button"
            data-tour={`erp-pf-tab-${i}`}
            onClick={() => setTabIndex(i)}
            style={{
              padding: '12px 6px',
              marginRight: 16,
              // Sit the active underline on the tab bar's divider, not 1px above it.
              marginBottom: -1,
              border: 'none',
              background: 'transparent',
              borderBottom: tabIndex === i ? `2px solid ${SHEET.BLUE}` : '2px solid transparent',
              color: tabIndex === i ? SHEET.BLUE : SHEET.MUTED,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ padding: '20px 24px' }}>
        <DraftBanner draft={draft} />
        {errorText && (
          <div ref={errorRef} style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            <b>{projectMode ? 'Cannot create the project:' : 'Cannot save the machine:'}</b> {errorText}
          </div>
        )}
        {projectName?.banner}
        {tabIndex === 0 && (
          <SheetSection icon="truck" title="Machine Asset Identity">
            <Grid3>
              {projectName && (
                <Field label="Project Name" req>
                  <input value={projectName.value} onChange={(e) => projectName.onChange(e.target.value)} placeholder="e.g. CAM Injection Car for IRCON MAHSR-T2" style={sheetInput} data-tour="pm-form-name" />
                </Field>
              )}
              <Field label="Serial Number" req={!serialOptional}>
                <input value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} placeholder={serialOptional ? 'Blank = project number' : 'e.g. PNR-RR-2026-88'} style={sheetInput} data-tour="erp-pf-serial" />
                {serialOptional && <p style={sheetHint}>Blank = project number, e.g. PEW-78.</p>}
              </Field>
              <Field label="Model Name"><input value={form.model_name} onChange={(e) => set('model_name', e.target.value)} placeholder="e.g. Catenary Track Car Pro" style={sheetInput} data-tour="erp-pf-model" /></Field>
              <Field label="Machine Classification">
                <Select value={form.machine_type} onChange={(e) => set('machine_type', e.target.value)} style={sheetInput} data-tour="erp-pf-machine-type">
                  <option value="">-- Select Machine Type --</option>
                  {MACHINE_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              </Field>

              {form.machine_type === 'Other' && (
                <Field label="Custom Class Specification" req>
                  <input value={machineTypeCustom} onChange={(e) => setMachineTypeCustom(e.target.value)} placeholder="Specify other classification" style={sheetInput} />
                </Field>
              )}
              <Field label="Engine Number"><input value={form.engine_number} onChange={(e) => set('engine_number', e.target.value)} placeholder="Optional Engine ID" style={sheetInput} data-tour="erp-pf-engine" /></Field>
              <Field label="Chassis Number"><input value={form.chassis_number} onChange={(e) => set('chassis_number', e.target.value)} placeholder="Optional Chassis ID" style={sheetInput} data-tour="erp-pf-chassis" /></Field>

              <Field label="Year of Manufacture"><div data-tour="erp-pf-year"><YearField value={form.year_of_manufacture} onChange={(v) => set('year_of_manufacture', v)} style={sheetInput} /></div></Field>
              <Field label="Operational Status">
                <Select value={form.status} onChange={(e) => set('status', e.target.value)} style={sheetInput} data-tour="erp-pf-status">
                  {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </Field>
              <Field label="Application Type">
                <Select value={form.application_type} onChange={(e) => set('application_type', e.target.value)} style={sheetInput} data-tour="erp-pf-app-type">
                  <option value="">-- Select Application Type --</option>
                  {APPLICATION_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
                </Select>
              </Field>

              {form.application_type === 'Other' && (
                <Field label="Custom Application Specifications" req>
                  <input value={applicationTypeCustom} onChange={(e) => setApplicationTypeCustom(e.target.value)} placeholder="Enter custom application specifications" style={sheetInput} />
                </Field>
              )}
            </Grid3>
            <Field label="Production Notes & Core Details">
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} placeholder="Enter other critical identity comments..." style={{ ...sheetInput, resize: 'vertical' }} data-tour="erp-pf-notes" />
            </Field>
          </SheetSection>
        )}

        {tabIndex === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <SheetSection icon="building" title="Operational Site Location">
              <span data-tour="erp-pf-export" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: SHEET.BODY }}>
                <Checkbox
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
              </span>
              <Row>
                <Field label="Site Name"><input value={form.site_name} onChange={(e) => set('site_name', e.target.value)} placeholder="Enter railway station/site name" style={sheetInput} data-tour="erp-pf-site-name" /></Field>
                <Field label="Site Location"><input value={form.site_location} onChange={(e) => set('site_location', e.target.value)} placeholder="City or Division" style={sheetInput} data-tour="erp-pf-site-location" /></Field>
              </Row>
              <Row>
                {isExport ? (
                  <Field label="Country">
                    <input value={form.site_country} onChange={(e) => set('site_country', e.target.value)} placeholder="Enter country name" style={sheetInput} />
                  </Field>
                ) : (
                  <Field label="State">
                    <Select value={form.site_state} onChange={(e) => set('site_state', e.target.value)} style={sheetInput} data-tour="erp-pf-state">
                      <option value="">-- Select State / UT --</option>
                      {INDIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </Field>
                )}
                <Field label="Pincode"><input value={form.site_pincode} onChange={(e) => set('site_pincode', e.target.value)} placeholder="6-digit PIN code" style={sheetInput} data-tour="erp-pf-pincode" /></Field>
              </Row>
              <Field label="Zone"><input value={form.zone} onChange={(e) => set('zone', e.target.value)} placeholder="e.g. Northern Railway (NR)" style={sheetInput} data-tour="erp-pf-zone" /></Field>
            </SheetSection>

            <SheetSection icon="users" title="Client Details">
              <Field label="Client Company" req><input value={form.client_company} onChange={(e) => set('client_company', e.target.value)} placeholder="Enter client company name" style={sheetInput} data-tour="erp-pf-client-company" /></Field>
              <Field label="Contact Person"><input value={form.client_name} onChange={(e) => set('client_name', e.target.value)} placeholder="Enter contact person name" style={sheetInput} data-tour="erp-pf-client-contact" /></Field>
              <Field label="Designation"><input value={form.client_designation} onChange={(e) => set('client_designation', e.target.value)} placeholder="e.g. Chief Engineer" style={sheetInput} /></Field>
              <Field label="Email"><ValidatedInput type="email" value={form.client_email} onChange={(v) => set('client_email', v)} validator={isValidEmail} errorMessage={VALIDATION_MESSAGES.email} placeholder="Enter email address" style={sheetInput} /></Field>
              <Row>
                <Field label="Phone"><PhoneField value={form.client_phone} onChange={(v) => set('client_phone', v)} style={sheetInput} /></Field>
                <Field label="Alternate Phone"><PhoneField value={form.client_phone_alt} onChange={(v) => set('client_phone_alt', v)} style={sheetInput} /></Field>
              </Row>
              <Field label="GST Number"><div data-tour="erp-pf-client-gst"><ValidatedInput value={form.client_gst} onChange={(v) => set('client_gst', v.toUpperCase())} validator={isValidGST} errorMessage={VALIDATION_MESSAGES.gst} placeholder="15-digit GSTIN" style={sheetInput} /></div></Field>
              <Field label="Address">
                <textarea value={form.client_address} onChange={(e) => set('client_address', e.target.value)} rows={2} placeholder="Client corporate/billing address..." style={{ ...sheetInput, resize: 'vertical' }} data-tour="erp-pf-client-address" />
              </Field>
            </SheetSection>

          </div>
        )}

        {tabIndex === 2 && (
          <SheetSection icon="gear" title="Technical Specifications" extra={<Optional />}>
            <Field label="Specifications">
              <textarea value={form.specifications} onChange={(e) => set('specifications', e.target.value)} rows={3} placeholder="List model engine power, capacity, and key metrics..." style={{ ...sheetInput, resize: 'vertical' }} data-tour="erp-pf-specs" />
            </Field>
            <Field label="Installed Options">
              <textarea value={form.installed_options} onChange={(e) => set('installed_options', e.target.value)} rows={3} placeholder="Any specialized modular items installed..." style={{ ...sheetInput, resize: 'vertical' }} data-tour="erp-pf-options" />
            </Field>
            <Field label="Software Version"><input value={form.software_version} onChange={(e) => set('software_version', e.target.value)} placeholder="e.g. v2.4.1" style={sheetInput} data-tour="erp-pf-software" /></Field>
            <Field label="Notes">
              <textarea value={form.tech_notes} onChange={(e) => set('tech_notes', e.target.value)} rows={2} placeholder="Additional engineering notes..." style={{ ...sheetInput, resize: 'vertical' }} data-tour="erp-pf-tech-notes" />
            </Field>
          </SheetSection>
        )}

        {tabIndex === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <SheetSection icon="cart" title="Procurement & Delivery Information">
              <Grid3>
                <Field label={projectMode ? 'Customer PO Number' : 'PO Number'} req={projectMode}><input value={form.po_number} onChange={(e) => set('po_number', e.target.value)} placeholder="Purchase Order Ref" style={sheetInput} data-tour="erp-pf-po" /></Field>
                <Field label="PO Date"><DateField value={form.po_date} onChange={(v) => set('po_date', v)} /></Field>
                <Field label="Dispatch Date"><div data-tour="erp-pf-dispatch-date"><DateField value={form.delivery_date} onChange={(v) => set('delivery_date', v)} /></div></Field>
                <Field label="Commissioning Date"><div data-tour="erp-pf-commissioning-date"><DateField value={form.commissioning_date} onChange={(v) => set('commissioning_date', v)} /></div></Field>
                <Field label="Handover Date"><div data-tour="erp-pf-handover-date"><DateField value={form.handover_date} onChange={(v) => set('handover_date', v)} /></div></Field>
              </Grid3>
            </SheetSection>

            <SheetSection icon="shield" title="Warranty Coverage Details">
              <Field label="Warranty Status">
                <Select value={warrantyStatus} onChange={(e) => setWarrantyStatus(e.target.value)} style={sheetInput} data-tour="erp-pf-warranty-status">
                  {WARRANTY_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              {warrantyStatus === 'active' && (
                <Row>
                  <Field label="Warranty Commencement"><DateField value={form.warranty_start_date} onChange={(v) => set('warranty_start_date', v)} /></Field>
                  <Field label="Warranty Expiration"><DateField value={form.warranty_end_date} onChange={(v) => set('warranty_end_date', v)} /></Field>
                </Row>
              )}
              <Field label="Warranty Terms & Scope">
                <input value={form.warranty_override} onChange={(e) => set('warranty_override', e.target.value)} placeholder="Clauses, limit conditions" style={sheetInput} data-tour="erp-pf-warranty-terms" />
              </Field>
              <span data-tour="erp-pf-extended-warranty" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: SHEET.BODY }}>
                <Checkbox checked={extendedWarranty} onChange={(e) => setExtendedWarranty(e.target.checked)} />
                Extended Warranty
              </span>
              {extendedWarranty && (
                <Field label="Extended Warranty End">
                  <DateField value={extendedWarrantyEnd} onChange={setExtendedWarrantyEnd} />
                </Field>
              )}
              <Field label="AMC Service Status">
                <Select value={form.amc_status} onChange={(e) => set('amc_status', e.target.value)} style={sheetInput} data-tour="erp-pf-amc-status">
                  {AMC_STATUS_OPTIONS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
                </Select>
              </Field>
              {form.amc_status && (
                <Field label="AMC End Date"><DateField value={form.amc_end_date} onChange={(v) => set('amc_end_date', v)} /></Field>
              )}
            </SheetSection>
          </div>
        )}

        {tabIndex === 4 && (
          <SheetSection icon="clip" title="Attachments & Documents">
            <p style={{ ...sheetHint, margin: '0 0 10px' }}>PDFs, Office files, images, and videos — max 10GB each</p>
            <div
              data-tour="erp-pf-attachments"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
              style={{
                padding: '24px 16px',
                borderRadius: 12,
                border: `1.5px dashed ${dragOver ? SHEET.BLUE : '#cbd5e1'}`,
                background: dragOver ? '#eff6ff' : '#fff',
                textAlign: 'center',
                cursor: 'pointer',
              }}
            >
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
              <SheetIcon name="clip" size={22} color={SHEET.BLUE} />
              <div style={{ fontSize: 13, color: SHEET.BODY, marginTop: 6 }}>Drag and drop files here, or <span style={{ color: SHEET.BLUE, fontWeight: 600 }}>click to browse</span></div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
                {['PDF', 'DOCX', 'XLSX', 'JPG/PNG', 'MP4'].map((t) => (
                  <span key={t} style={{ fontSize: 10.5, fontWeight: 600, padding: '3px 9px', borderRadius: 6, background: 'rgba(0,0,0,0.05)', color: '#78716c' }}>{t}</span>
                ))}
              </div>
            </div>
            {queuedFiles.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {queuedFiles.map((f, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <span style={{ fontSize: 12.5, color: '#57534e' }}>{f.name}</span>
                    <button type="button" onClick={() => setQueuedFiles((prev) => prev.filter((_, idx) => idx !== i))} style={{ border: 'none', background: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            {queuedFiles.length > 0 && (
              <div style={{ marginTop: 10, padding: 14, borderRadius: 12, background: '#fff', border: `1px solid ${SHEET.LINE}` }}>
                <SharePicker
                  directory={directory}
                  currentUserId={currentUserId}
                  isPrivate={share.isPrivate}
                  onTogglePrivate={share.setIsPrivate}
                  selectedUserIds={share.userIds}
                  onToggleUser={share.toggleUser}
                  selectedDepartments={share.departments}
                  onToggleDepartment={share.toggleDepartment}
                  selectedDesignations={share.designations}
                  onToggleDesignation={share.toggleDesignation}
                />
              </div>
            )}
          </SheetSection>
        )}

      </div>
      </FormPage>
    </form>
  )
}

function Grid3({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>{children}</div>
}

/** Labelled field in the sheet style (label above, optional required star). */
function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12, minWidth: 0 }}>
      <label style={sheetLabel}>{label} {req && <Req />}</label>
      {children}
    </div>
  )
}
