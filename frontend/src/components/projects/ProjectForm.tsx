'use client'

import { useEffect, useState } from 'react'
import { projectsApi, usersApi } from '@/lib/api'
import { DirectoryUser, PmProject } from '@/types'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { Optional, Req, SHEET, SheetSection, sheetHint, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { BudgetPicker } from '@/components/finance/ProjectBudget'

export type ProjectFormValues = {
  project_code: string
  name: string
  client_name: string
  customer_po_ref: string
  sales_order_ref: string
  description: string
  project_manager_id: string
  start_date: string
  target_handover_date: string
  /** Finance budget (internal order) id; '' = none. */
  internal_order_id: string
}

export const emptyProjectForm = (): ProjectFormValues => ({
  project_code: '', name: '', client_name: '', customer_po_ref: '', sales_order_ref: '', description: '',
  project_manager_id: '', start_date: '', target_handover_date: '', internal_order_id: '',
})

export const projectToForm = (p: PmProject): ProjectFormValues => ({
  project_code: p.project_code, name: p.name, client_name: p.client_name || '',
  customer_po_ref: p.customer_po_ref || '', sales_order_ref: p.sales_order_ref || '',
  description: p.description || '', project_manager_id: p.project_manager_id ? String(p.project_manager_id) : '',
  start_date: p.start_date || '', target_handover_date: p.target_handover_date || '',
  internal_order_id: p.internal_order_id ? String(p.internal_order_id) : '',
})

/** Client-side check with the same rules (and messages) as the backend.
 * On create, code and project manager may be blank (auto number / creator). */
export function validateProjectForm(f: ProjectFormValues, isEdit = false): string[] {
  const missing: string[] = []
  if (isEdit && !f.project_code.trim()) missing.push('Project number is required, e.g. PEW-78 or PEW-64A.')
  if (!f.name.trim()) missing.push('Project name is required.')
  if (!f.client_name.trim()) missing.push('Client is required.')
  if (!f.customer_po_ref.trim()) missing.push("Customer PO number is required. Enter the customer's purchase order number for this project.")
  else if (f.customer_po_ref.trim().length > 100) missing.push('Customer PO number can be at most 100 characters.')
  if (!f.sales_order_ref.trim()) missing.push('Sales order (SO) number is required. Enter the SO number this project is delivered under.')
  else if (f.sales_order_ref.trim().length > 100) missing.push('Sales order (SO) number can be at most 100 characters.')
  if (isEdit && !f.project_manager_id) missing.push('Project manager is required — one person owns the project.')
  if (!f.start_date) missing.push('Start date is required.')
  if (!f.target_handover_date) missing.push('Closing date is required.')
  if (f.start_date && f.target_handover_date && f.target_handover_date < f.start_date) missing.push('Closing date is before the start date.')
  return missing
}

export const formToPayload = (f: ProjectFormValues) => ({
  project_code: f.project_code.trim() || null, name: f.name.trim(), client_name: f.client_name.trim(),
  customer_po_ref: f.customer_po_ref.trim(), sales_order_ref: f.sales_order_ref.trim(),
  description: f.description.trim() || null,
  project_manager_id: f.project_manager_id ? Number(f.project_manager_id) : null, start_date: f.start_date,
  target_handover_date: f.target_handover_date,
  internal_order_id: f.internal_order_id ? Number(f.internal_order_id) : null,
})

/** Project header. The essentials — name, client, timeline — come first;
 * code, project manager and scope sit under "More
 * details" (on create they default: next PEW number, you as manager). */
/** Finance budget the project's spend is tracked against (Finance creates budgets). */
export function ProjectBudgetSection({ value, onChange, projectId }: { value: string; onChange: (v: string) => void; projectId?: number }) {
  return (
    <SheetSection icon="list" title="Budget" extra={<Optional />}>
      <div data-tour="pm-form-budget" style={{ maxWidth: 520 }}>
        <label style={sheetLabel}>Finance budget</label>
        <BudgetPicker value={value} onChange={onChange} load={() => projectsApi.budgetOptions(projectId)} />
        <p style={sheetHint}>Purchases and expenses booked on this budget show on the project as committed and actual spend.</p>
      </div>
    </SheetSection>
  )
}

export default function ProjectForm({ value, onChange, codeLocked, isEdit = false, projectId }: {
  value: ProjectFormValues
  onChange: (v: ProjectFormValues) => void
  codeLocked?: boolean
  isEdit?: boolean
  /** The project being edited (its own budget stays in the list). */
  projectId?: number
}) {
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [more, setMore] = useState(isEdit)
  useEffect(() => { usersApi.directory().then(setUsers).catch(() => setUsers([])) }, [])
  const set = (k: keyof ProjectFormValues, v: string) => onChange({ ...value, [k]: v })
  const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 14 }

  return (
    <>
      <SheetSection icon="list" title="Basic Information">
        <div style={row}>
          <div data-tour="pm-form-name" style={{ flex: '1 1 300px', maxWidth: 520 }}>
            <label style={sheetLabel}>Project name <Req /></label>
            <input style={sheetInput} value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. CAM Injection Car for IRCON MAHSR-T2" />
          </div>
          <div data-tour="pm-form-customer" style={{ flex: '1 1 260px', maxWidth: 400 }}>
            <label style={sheetLabel}>Client <Req /></label>
            <input style={sheetInput} value={value.client_name} onChange={(e) => set('client_name', e.target.value)} placeholder="e.g. IRCON International Limited" />
          </div>
          <div data-tour="pm-form-po" style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <label style={sheetLabel}>Customer PO number <Req /></label>
            <input style={sheetInput} value={value.customer_po_ref} maxLength={100} onChange={(e) => set('customer_po_ref', e.target.value)} placeholder="e.g. 4500123456" />
          </div>
          <div data-tour="pm-form-so" style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <label style={sheetLabel}>Sales order (SO) number <Req /></label>
            <input style={sheetInput} value={value.sales_order_ref} maxLength={100} onChange={(e) => set('sales_order_ref', e.target.value)} placeholder="e.g. SO-2026-0042" />
          </div>
        </div>
      </SheetSection>
      <SheetSection icon="calendar" title="Timeline">
        <div style={row}>
          <div data-tour="pm-form-start" style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={sheetLabel}>Start date <Req /></label>
            <DateField value={value.start_date} onChange={(v) => set('start_date', v)} />
          </div>
          <div data-tour="pm-form-handover" style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={sheetLabel}>Closing date <Req /></label>
            <DateField value={value.target_handover_date} onChange={(v) => set('target_handover_date', v)} />
          </div>
        </div>
      </SheetSection>
      <ProjectBudgetSection value={value.internal_order_id} onChange={(v) => set('internal_order_id', v)} projectId={projectId} />

      {!isEdit && (
        <button type="button" onClick={() => setMore(!more)} style={{ background: 'none', border: 'none', padding: 0, margin: '0 0 14px', color: SHEET.BLUE, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {more ? '▾ Hide more details' : '▸ More details (code, project manager, scope)'}
        </button>
      )}
      {more && (
        <SheetSection icon="user" title="Ownership & Scope" extra={isEdit ? undefined : <Optional />}>
          <div style={{ ...row, marginBottom: 14 }}>
            <div data-tour="pm-form-code" style={{ flex: '0 1 200px', minWidth: 170 }}>
              <label style={sheetLabel}>Project number {isEdit && <Req />}</label>
              <input style={{ ...sheetInput, ...(codeLocked ? { background: '#f5f5f4', color: '#78716c' } : {}) }} value={value.project_code} readOnly={codeLocked}
                onChange={(e) => set('project_code', e.target.value.toUpperCase())} placeholder={isEdit ? 'e.g. PEW-78 or PEW-64A' : 'Blank = next number (e.g. PEW-78), or type your own such as PEW-64A'} />
              {codeLocked && <p style={sheetHint}>Fixed once the project is released — departments know it by this code.</p>}
            </div>
            <div data-tour="pm-form-pm" style={{ flex: '1 1 260px', maxWidth: 360 }}>
              <label style={sheetLabel}>Project manager {isEdit && <Req />}</label>
              <SearchableSelect
                value={value.project_manager_id}
                onChange={(v) => set('project_manager_id', v)}
                options={users.map((u) => ({ value: String(u.id), label: `${u.name}${u.designation ? ` — ${u.designation}` : ''}` }))}
                placeholder={isEdit ? 'Select the single owner…' : 'Blank = you'}
              />
            </div>
          </div>
          <div data-tour="pm-form-description">
            <label style={sheetLabel}>Description / scope <Optional /></label>
            <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={value.description} onChange={(e) => set('description', e.target.value)} placeholder="What is being delivered" />
          </div>
        </SheetSection>
      )}
    </>
  )
}
