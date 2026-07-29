'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { crmApi, usersApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'

interface UserOption { id: number; name: string; email: string }

const ENTITIES = [
  {
    value: 'organizations', label: 'Organizations',
    columns: 'name*, org_type, parent_org, railway_zone, division_workshop, address, city, state, pin_code, gst_number, official_phone, official_email, website, then contact1_name/contact1_designation/contact1_department/contact1_email/contact1_mobile through contact10_* (up to 10 contacts per organization)',
  },
  {
    value: 'inquiries', label: 'Inquiries',
    columns: 'organization_name*, contact_name, universal_id, railway_zone, division, lead_source, bd_owner, sales_engineer, status, current_stage, product, product_category, quantity, unit, required_delivery_date (YYYY-MM-DD), delivery_location, requirement_desc, budget',
  },
  {
    value: 'tenders', label: 'Tenders',
    columns: 'organization_name*, contact_name, universal_id, tender_number, tender_name, tender_authority, tender_portal, tender_type, tender_category, tender_value, currency, status, current_stage, railway_zone, division, workshop, publish_date, doc_download_date, pre_bid_meeting_date, query_submission_date, submission_date, opening_date (all dates YYYY-MM-DD)',
  },
  {
    value: 'activities', label: 'Activities',
    columns: 'organization_name, contact_name, activity_type, related_module, next_followup (YYYY-MM-DD), assigned_to, status, remarks',
  },
] as const

export default function CrmImportPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<UserOption[]>([])
  const [entity, setEntity] = useState<typeof ENTITIES[number]['value']>('organizations')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped?: string[]; errors: { row: number; reason: string }[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    usersApi.list().then((data) => setUsers(data)).catch(() => {})
  }, [])

  if (!user) return null
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return (
      <div>
        <CrmNav />
        <p style={{ color: '#dc2626', fontSize: 14 }}>Admin access required.</p>
      </div>
    )
  }

  const active = ENTITIES.find((e) => e.value === entity)!

  const submit = async () => {
    if (!file) { setError('Select a CSV file.'); return }
    if (!ownerEmail) { setError('Select the user to attribute this data to.'); return }
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const data = await crmApi.bulkImport(entity, file, ownerEmail)
      setResult(data)
    } catch (e) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Import failed. Check the CSV format and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <CrmNav />
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: '0 0 4px' }}>Bulk Data Import</h1>
      <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 20px' }}>
        Admin-only: import Organizations, Inquiries, Tenders, or Activities from a CSV file, attributed to any user.
      </p>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
        <div>
          <label style={labelStyle}>Data type</label>
          <select value={entity} onChange={(e) => { setEntity(e.target.value as typeof entity); setResult(null) }} style={inputStyle}>
            {ENTITIES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>

        <div style={{ padding: 12, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>Required CSV columns (header row)</div>
          <div style={{ fontSize: 12, color: '#334155', fontFamily: 'monospace', lineHeight: 1.6, wordBreak: 'break-word' }}>{active.columns}</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>* = required. Other columns optional — leave blank if unknown.</div>
        </div>

        <div>
          <label style={labelStyle}>Attribute records to (created by)</label>
          <select value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} style={inputStyle}>
            <option value="">Select user…</option>
            {users.map((u) => <option key={u.id} value={u.email}>{u.name} — {u.email}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>CSV file</label>
          <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} style={inputStyle} />
        </div>

        <button
          onClick={submit}
          disabled={busy}
          style={{ padding: '11px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(140deg,#f4713b,#ff8a4c)', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, alignSelf: 'flex-start' }}
        >
          {busy ? 'Importing…' : 'Import CSV'}
        </button>

        {result && (
          <div style={{ padding: 14, borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#166534' }}>Created: {result.created}</div>
            {result.skipped && result.skipped.length > 0 && (
              <div style={{ fontSize: 12.5, color: '#92400e', marginTop: 6 }}>
                Skipped (already existed): {result.skipped.join(', ')}
              </div>
            )}
            {result.errors.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#991b1b' }}>Errors:</div>
                {result.errors.map((er, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#991b1b' }}>Row {er.row}: {er.reason}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', display: 'block', marginBottom: 6 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, boxSizing: 'border-box' }
