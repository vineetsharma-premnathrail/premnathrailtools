'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { organizationApi, usersApi } from '@/lib/api'
import { Branch, Company, DirectoryUser } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import DateField from '@/components/erp/DateField'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { FormPage, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'

const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }

/** One field: label + control, sized by its flex basis (short fields stay short). */
function F({ label, req, basis = 240, max, children }: { label: string; req?: boolean; basis?: number; max?: number; children: React.ReactNode }) {
  return (
    <div style={{ flex: `1 1 ${basis}px`, minWidth: Math.min(basis, 160), maxWidth: max }}>
      <label style={sheetLabel}>{label} {req && <Req />}</label>
      {children}
    </div>
  )
}

export const PLANT_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  under_maintenance: 'Under Maintenance',
  under_construction: 'Under Construction',
  closed: 'Closed',
}
export const PLANT_STATUS_HEX: Record<string, string> = {
  active: '#16A34A',
  inactive: '#78716c',
  under_maintenance: '#F59E0B',
  under_construction: '#2563EB',
  closed: '#DC2626',
}

type FormState = Partial<Branch>

interface PlantFormProps {
  title: string
  /** One line under the title (FormPage header). */
  subtitle?: string
  /** Module sub-nav, rendered above the header. */
  nav?: React.ReactNode
  tabBar?: React.ReactNode
  initial?: Branch
  submitLabel: string
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => Promise<Branch>
  onSaved: (plant: Branch) => void
}

/** Basic-Information-only form, used for creating a new branch. Address,
 * Operational Configuration, Users, Stores, Cost Centers, and Documents
 * are managed from the branch's Edit page once it exists (those are
 * repeatable child records that need a real branch_id to attach to). */
export default function PlantForm({ title, subtitle, nav, tabBar, initial, submitLabel, onCancel, onSubmit, onSaved }: PlantFormProps) {
  const [form, setForm] = useState<FormState>(initial || { status: 'active' })
  const [company, setCompany] = useState<Company | null>(null)
  const [directory, setDirectory] = useState<DirectoryUser[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const draft = useFormDraft(initial ? null : 'org-plant-new', form, (d: FormState) => setForm({ status: 'active', ...d }))

  useEffect(() => {
    organizationApi.getCompanyInfo().then(setCompany).catch(() => setCompany(null))
    usersApi.directory().then(setDirectory).catch(() => setDirectory([]))
  }, [])

  const setField = (field: keyof Branch, value: unknown) => {
    setForm((f) => ({ ...f, [field]: value }))
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name?.trim()) {
      setError('Branch name is required (e.g. Unit 3).')
      return
    }
    if (!form.code?.trim()) {
      setError('Branch code is required: a short unique code, e.g. U3.')
      return
    }
    if (!form.company_id) {
      setError('Company is required: pick it in the Company field (set up Company Info first if the list is empty).')
      return
    }
    if (!form.plant_type?.trim()) {
      setError('Branch type is required (e.g. Manufacturing).')
      return
    }
    setSubmitting(true)
    try {
      const result = await onSubmit(form)
      draft.clear()
      onSaved(result)
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not save the branch. Check the fields (the code must be unique) and try again.').join(' '))
    } finally {
      setSubmitting(false)
    }
  }

  const userOption = (u: DirectoryUser) => <option key={u.id} value={u.id}>{u.name}</option>

  return (
    <form onSubmit={handleSubmit}>
      <FormPage
        nav={nav}
        icon="building"
        title={title}
        subtitle={subtitle || 'Basic information. Address, users, stores, cost centers and documents are added after the first save.'}
        onBack={onCancel} backTour="org-plant-back"
        footer={<>
          <button type="button" onClick={onCancel} disabled={submitting} data-tour="org-plant-cancel" style={sheetBtn('secondary', SHEET.INK, submitting)}>Cancel</button>
          <button type="submit" disabled={submitting} data-tour="org-plant-save" style={sheetBtn('primary', SHEET.BLUE, submitting)}>
            <SheetIcon name="check" size={16} />{submitting ? 'Saving…' : submitLabel}
          </button>
        </>}
      >
        {tabBar && <div style={{ padding: '0 24px' }}>{tabBar}</div>}
        <div style={{ padding: '20px 24px' }}>
          <DraftBanner draft={draft} />
          {error && (
            <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {error}
            </div>
          )}

          <SheetSection icon="building" title="Basic Information">
            <div style={rowStyle}>
              <F label="Branch Name" req basis={260} max={360}>
                <input data-tour="org-plant-name" style={sheetInput} value={form.name || ''} onChange={(e) => setField('name', e.target.value)} placeholder="Unit 3" />
              </F>
              <F label="Branch Code" req basis={150} max={220}>
                <input data-tour="org-plant-code" style={sheetInput} value={form.code || ''} onChange={(e) => setField('code', e.target.value)} placeholder="Unit 3" />
              </F>
            </div>
            <div style={rowStyle}>
              <F label="Company" req basis={260} max={360}>
                <Select data-tour="org-plant-company" style={sheetInput} value={form.company_id || ''} onChange={(e) => setField('company_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Select —</option>
                  {company && <option value={company.id}>{company.name}</option>}
                </Select>
              </F>
              <F label="Branch Type" req basis={200} max={280}>
                <input data-tour="org-plant-type" style={sheetInput} value={form.plant_type || ''} onChange={(e) => setField('plant_type', e.target.value)} placeholder="Manufacturing" />
              </F>
              <F label="Branch Status" req basis={180} max={240}>
                <Select data-tour="org-plant-status" style={sheetInput} value={form.status || 'active'} onChange={(e) => setField('status', e.target.value)}>
                  {Object.entries(PLANT_STATUS_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </Select>
              </F>
            </div>
            <div style={{ ...rowStyle, marginBottom: 0 }}>
              <F label="Industry / Function" basis={240} max={340}>
                <input data-tour="org-plant-industry" style={sheetInput} value={form.industry_function || ''} onChange={(e) => setField('industry_function', e.target.value || null)} />
              </F>
            </div>
          </SheetSection>

          <SheetSection icon="users" title="People">
            <div style={{ ...rowStyle, marginBottom: 0 }}>
              <F label="Branch Head" basis={240} max={340}>
                <Select data-tour="org-plant-head" style={sheetInput} value={form.head_user_id || ''} onChange={(e) => setField('head_user_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Select —</option>
                  {directory.map(userOption)}
                </Select>
              </F>
              <F label="Branch Manager" basis={240} max={340}>
                <Select data-tour="org-plant-manager" style={sheetInput} value={form.manager_user_id || ''} onChange={(e) => setField('manager_user_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Select —</option>
                  {directory.map(userOption)}
                </Select>
              </F>
            </div>
          </SheetSection>

          <SheetSection icon="calendar" title="Dates">
            <div style={{ ...rowStyle, marginBottom: 0 }}>
              <F label="Established Date" basis={170} max={240}>
                <div data-tour="org-plant-established-date"><DateField value={form.established_date || ''} onChange={(v) => setField('established_date', v || null)} /></div>
              </F>
              <F label="Active From" basis={170} max={240}>
                <div data-tour="org-plant-active-from"><DateField value={form.active_from || ''} onChange={(v) => setField('active_from', v || null)} /></div>
              </F>
            </div>
          </SheetSection>

          <SheetSection icon="chat" title="Notes" extra={<Optional />}>
            <label style={sheetLabel}>Description</label>
            <textarea data-tour="org-plant-description" style={{ ...sheetInput, resize: 'vertical', minHeight: 70 }} value={form.description || ''} onChange={(e) => setField('description', e.target.value || null)} />
            <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks</label>
            <textarea data-tour="org-plant-remarks" style={{ ...sheetInput, resize: 'vertical', minHeight: 70 }} value={form.remarks || ''} onChange={(e) => setField('remarks', e.target.value || null)} />
          </SheetSection>
        </div>
      </FormPage>
    </form>
  )
}
