'use client'

import { useEffect, useState } from 'react'
import { useRequireAdmin } from '@/hooks/useAuth'
import { organizationApi } from '@/lib/api'
import { Company } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import DateField from '@/components/erp/DateField'

// This app is single-company — Organization > Company is a view/edit form
// for the one record, not a list, mirroring ERPNext's Company doctype field
// set. `key` doubles as the CompanyUpdate/CompanyCreate payload field name.
const FIELDS: {
  key: keyof Company
  label: string
  description: string
  type: 'text' | 'date' | 'boolean' | 'textarea'
}[] = [
  { key: 'name', label: 'Company Name', description: 'Identifies the legal company in ERP transactions', type: 'text' },
  { key: 'default_currency', label: 'Default Currency', description: 'Base currency for accounting and financial statements', type: 'text' },
  { key: 'country', label: 'Country', description: 'Applies regional/localization defaults', type: 'text' },
  { key: 'tax_id', label: 'Tax ID', description: 'Stores statutory tax information', type: 'text' },
  { key: 'domain', label: 'Domain', description: 'Identifies the business domain', type: 'text' },
  { key: 'date_of_establishment', label: 'Date of Establishment', description: 'Company master/reference information', type: 'date' },
  { key: 'gst_number', label: 'GSTIN / UIN', description: 'Required for Indian GST compliance', type: 'text' },
  { key: 'pan_number', label: 'PAN', description: 'Required for Indian tax processes', type: 'text' },
  { key: 'gst_category', label: 'GST Category', description: 'Determines GST treatment', type: 'text' },
  { key: 'reporting_currency', label: 'Reporting Currency', description: 'Currency used for financial reporting', type: 'text' },
  { key: 'registration_details', label: 'Registration Details', description: 'Stores official company registration information (CIN, MSME, Factory License etc.)', type: 'textarea' },
]

type FormState = Record<string, string | boolean>

function toFormState(company: Company | null): FormState {
  const state: FormState = {}
  for (const f of FIELDS) {
    const val = company ? company[f.key] : undefined
    state[f.key] = f.type === 'boolean' ? !!val : (val as string) || ''
  }
  return state
}

export default function OrganizationCompanyPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<FormState>(toFormState(null))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await organizationApi.listCompanies()
      const first = data[0] || null
      setCompany(first)
      setForm(toFormState(first))
      setEditing(!first)
    } catch {
      setError('Failed to load company.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const setField = (key: string, value: string | boolean) => setForm((prev) => ({ ...prev, [key]: value }))

  const save = async () => {
    setError('')
    if (!(form.name as string)?.trim()) {
      setError('Company Name is required.')
      return
    }
    setBusy(true)
    const payload: Record<string, unknown> = {}
    for (const f of FIELDS) {
      const val = form[f.key]
      payload[f.key] = f.type === 'boolean' ? val : ((val as string).trim() || undefined)
    }
    try {
      if (company) {
        await organizationApi.updateCompany(company.id, payload)
      } else {
        await organizationApi.createCompany(payload)
      }
      await load()
      setEditing(false)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to save company.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Organization
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Company</h1>

      <OrganizationNav />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : (
        <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>
              {company ? 'Company Details' : 'Set Up Company (no company created yet)'}
            </span>
            {company && !editing && (
              <button onClick={() => setEditing(true)} style={secondaryBtnStyle}>Edit</button>
            )}
          </div>

          {!editing ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {FIELDS.map((f) => {
                  const raw = company ? company[f.key] : null
                  const display = f.type === 'boolean' ? (raw ? 'Yes' : 'No') : (raw as string) || '—'
                  return (
                    <tr key={f.key} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                      <td style={{ padding: '10px 20px', fontSize: 12.5, fontWeight: 600, color: TEXT.secondary, whiteSpace: 'nowrap', width: 160 }}>{f.label}</td>
                      <td style={{ padding: '10px 20px', fontSize: 13, color: TEXT.heading, fontWeight: 600, minWidth: 260 }}>{display}</td>
                      <td style={{ padding: '10px 20px', fontSize: 12.5, color: TEXT.muted }}>{f.description}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, alignItems: 'start' }}>
              {FIELDS.map((f) => (
                <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: f.type === 'textarea' ? '1 / -1' : undefined }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary }}>{f.label}</label>
                  {f.type === 'boolean' ? (
                    <select style={inputStyle} value={form[f.key] ? 'yes' : 'no'} onChange={(e) => setField(f.key, e.target.value === 'yes')}>
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form[f.key] as string} onChange={(e) => setField(f.key, e.target.value)} />
                  ) : f.type === 'date' ? (
                    <DateField value={form[f.key] as string} onChange={(v) => setField(f.key, v)} style={inputStyle} />
                  ) : (
                    <input
                      type="text"
                      style={inputStyle}
                      value={form[f.key] as string}
                      onChange={(e) => setField(f.key, e.target.value)}
                    />
                  )}
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, marginTop: 6 }}>
                <button disabled={busy} onClick={save} style={{ ...primaryBtnStyle, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                {company && (
                  <button disabled={busy} onClick={() => { setForm(toFormState(company)); setEditing(false); setError('') }} style={secondaryBtnStyle}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
