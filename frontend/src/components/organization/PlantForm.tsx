'use client'

import { useEffect, useState } from 'react'
import { organizationApi, usersApi } from '@/lib/api'
import { Branch, Company, DirectoryUser } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
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
  breadcrumb?: React.ReactNode
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
export default function PlantForm({ title, breadcrumb, tabBar, initial, submitLabel, onCancel, onSubmit, onSaved }: PlantFormProps) {
  const [form, setForm] = useState<FormState>(initial || { status: 'active' })
  const [company, setCompany] = useState<Company | null>(null)
  const [directory, setDirectory] = useState<DirectoryUser[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

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
      setError('Branch name is required')
      return
    }
    if (!form.code?.trim()) {
      setError('Branch code is required')
      return
    }
    if (!form.company_id) {
      setError('Company is required')
      return
    }
    if (!form.plant_type?.trim()) {
      setError('Branch type is required')
      return
    }
    setSubmitting(true)
    try {
      const result = await onSubmit(form)
      onSaved(result)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save branch.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          {breadcrumb && <div style={{ fontSize: 12, color: TEXT.secondary, marginBottom: 10 }}>{breadcrumb}</div>}
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title}</h1>
        </div>
        <button type="button" onClick={onCancel} data-tour="org-plant-back" style={secondaryBtnStyle}>← Back</button>
      </div>

      {tabBar}

      <form onSubmit={handleSubmit}>
        <div style={sectionStyle}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px 0' }}>Basic Information</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Branch Name *</label>
              <input data-tour="org-plant-name" style={inputStyle} value={form.name || ''} onChange={(e) => setField('name', e.target.value)} placeholder="Unit 3" />
            </div>
            <div>
              <label style={labelStyle}>Branch Code *</label>
              <input data-tour="org-plant-code" style={inputStyle} value={form.code || ''} onChange={(e) => setField('code', e.target.value)} placeholder="Unit 3" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Company *</label>
              <select data-tour="org-plant-company" style={inputStyle} value={form.company_id || ''} onChange={(e) => setField('company_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Select —</option>
                {company && <option value={company.id}>{company.name}</option>}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Branch Type *</label>
              <input data-tour="org-plant-type" style={inputStyle} value={form.plant_type || ''} onChange={(e) => setField('plant_type', e.target.value)} placeholder="Manufacturing" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Branch Status *</label>
              <select data-tour="org-plant-status" style={inputStyle} value={form.status || 'active'} onChange={(e) => setField('status', e.target.value)}>
                {Object.entries(PLANT_STATUS_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Branch Head</label>
              <select data-tour="org-plant-head" style={inputStyle} value={form.head_user_id || ''} onChange={(e) => setField('head_user_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Select —</option>
                {directory.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Branch Manager</label>
              <select data-tour="org-plant-manager" style={inputStyle} value={form.manager_user_id || ''} onChange={(e) => setField('manager_user_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Select —</option>
                {directory.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Established Date</label>
              <input type="date" data-tour="org-plant-established-date" style={inputStyle} value={form.established_date || ''} onChange={(e) => setField('established_date', e.target.value || null)} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Industry / Function</label>
              <input data-tour="org-plant-industry" style={inputStyle} value={form.industry_function || ''} onChange={(e) => setField('industry_function', e.target.value || null)} />
            </div>
            <div>
              <label style={labelStyle}>Active From</label>
              <input type="date" data-tour="org-plant-active-from" style={inputStyle} value={form.active_from || ''} onChange={(e) => setField('active_from', e.target.value || null)} />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Description</label>
            <textarea data-tour="org-plant-description" style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }} value={form.description || ''} onChange={(e) => setField('description', e.target.value || null)} />
          </div>
          <div>
            <label style={labelStyle}>Remarks</label>
            <textarea data-tour="org-plant-remarks" style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }} value={form.remarks || ''} onChange={(e) => setField('remarks', e.target.value || null)} />
          </div>
        </div>

        {error && (
          <div style={{ padding: '12px 14px', borderRadius: 10, background: '#fee2e2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, marginBottom: 20 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            data-tour="org-plant-cancel"
            style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #d4d4d8', background: '#fff', color: TEXT.body, fontSize: 13.5, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-tour="org-plant-save"
            style={{
              padding: '10px 20px', borderRadius: 8, background: submitting ? '#999' : BRAND.primary, color: '#fff',
              fontSize: 13.5, fontWeight: 600, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Saving...' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
