'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { accountsApi, costCentersApi } from '@/lib/api'
import { GLAccount, BankAccount, Vendor, InternalOrder, CostCenter } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import FinanceNav from '@/components/finance/FinanceNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const cardRowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 12,
  background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.normal}`,
}
const primaryBtnStyle: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 9, border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`, color: '#fff',
}
const linkBtnStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }
const dangerLinkStyle: React.CSSProperties = { ...linkBtnStyle, color: '#b91c1c' }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={labelStyle}>{label}</label>{children}</div>
}

const SUB_TABS = ['GL Accounts', 'Bank Accounts', 'Vendors', 'Internal Orders'] as const
type SubTab = typeof SUB_TABS[number]

export default function FinanceMastersPage() {
  const { isAuthorized, isLoading } = useRequireApp('accounts')
  const [tab, setTab] = useState<SubTab>('GL Accounts')

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <FinanceNav />

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {SUB_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px', borderRadius: 9999, border: `1px solid ${tab === t ? BRAND.primary : BORDER.normal}`,
              background: tab === t ? `${BRAND.primary}1a` : '#fff', color: tab === t ? BRAND.primaryActive : TEXT.secondary,
              fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'GL Accounts' && <GLAccountsSection />}
      {tab === 'Bank Accounts' && <BankAccountsSection />}
      {tab === 'Vendors' && <VendorsSection />}
      {tab === 'Internal Orders' && <InternalOrdersSection />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GL Accounts
// ---------------------------------------------------------------------------

function emptyGLAccount() {
  return { code: '', name: '', account_type: 'asset', account_sub_type: '', status: 'active', opening_balance: '0', is_posting_account: true, is_control_account: false }
}

function GLAccountsSection() {
  const [accounts, setAccounts] = useState<GLAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyGLAccount())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<GLAccount | null>(null)

  const load = () => { setLoading(true); accountsApi.listGLAccounts().then(setAccounts).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  const startEdit = (a: GLAccount) => {
    setEditingId(a.id)
    setForm({
      code: a.code, name: a.name, account_type: a.account_type, account_sub_type: a.account_sub_type || '',
      status: a.status, opening_balance: String(a.opening_balance ?? 0),
      is_posting_account: a.is_posting_account, is_control_account: a.is_control_account,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyGLAccount()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.code.trim() || !form.name.trim()) { setError('Code and Name are required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, opening_balance: form.opening_balance ? Number(form.opening_balance) : 0 }
      if (editingId) await accountsApi.updateGLAccount(editingId, payload)
      else await accountsApi.createGLAccount(payload)
      cancel()
      load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save GL account.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await accountsApi.deleteGLAccount(deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to delete GL account.')
      setDeleteTarget(null)
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{editingId ? 'Edit GL Account' : 'Add GL Account'}</h2>
        {editingId && <button type="button" style={linkBtnStyle} onClick={cancel}>Cancel edit</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="GL Account Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Delete this GL account?" message={`Delete "${deleteTarget?.name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Code *"><input style={inputStyle} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} /></Field>
        <Field label="Name *"><input style={inputStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="Account Type">
          <select style={inputStyle} value={form.account_type} onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value }))}>
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
            <option value="equity">Equity</option>
            <option value="revenue">Revenue</option>
            <option value="expense">Expense</option>
          </select>
        </Field>
        <Field label="Sub Type"><input style={inputStyle} value={form.account_sub_type} onChange={(e) => setForm((f) => ({ ...f, account_sub_type: e.target.value }))} /></Field>
        <Field label="Opening Balance"><input type="number" style={inputStyle} value={form.opening_balance} onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))} /></Field>
        <Field label="Status">
          <select style={inputStyle} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <Field label="Posting Account">
          <select style={inputStyle} value={form.is_posting_account ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, is_posting_account: e.target.value === '1' }))}>
            <option value="1">Yes — can receive postings</option>
            <option value="0">No — group/header account</option>
          </select>
        </Field>
        <Field label="Control Account">
          <select style={inputStyle} value={form.is_control_account ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, is_control_account: e.target.value === '1' }))}>
            <option value="0">No</option>
            <option value="1">Yes — reconciles a sub-ledger (AP/AR)</option>
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save GL Account'}</button>
        </div>
      </form>

      {loading ? <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p> : accounts.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No GL accounts yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {accounts.map((a) => (
            <div key={a.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{a.code} — {a.name}</span>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0, textTransform: 'capitalize' }}>
                    {[a.account_type, a.account_sub_type, a.status, a.is_posting_account ? 'Posting' : 'Group', a.is_control_account ? 'Control' : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button type="button" style={linkBtnStyle} onClick={() => startEdit(a)}>Edit</button>
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(a)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bank Accounts
// ---------------------------------------------------------------------------

function emptyBankAccount() {
  return { bank_name: '', account_no: '', account_holder_name: '', branch_name: '', ifsc_code: '', opening_balance: '0', status: 'active' }
}

function BankAccountsSection() {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyBankAccount())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BankAccount | null>(null)

  const load = () => { setLoading(true); accountsApi.listBankAccounts().then(setAccounts).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  const startEdit = (a: BankAccount) => {
    setEditingId(a.id)
    setForm({
      bank_name: a.bank_name, account_no: a.account_no, account_holder_name: a.account_holder_name || '',
      branch_name: a.branch_name || '', ifsc_code: a.ifsc_code || '', opening_balance: String(a.opening_balance), status: a.status,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyBankAccount()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.bank_name.trim() || !form.account_no.trim()) { setError('Bank Name and Account No. are required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, opening_balance: form.opening_balance ? Number(form.opening_balance) : 0 }
      if (editingId) {
        const { opening_balance: _drop, ...updatePayload } = payload
        await accountsApi.updateBankAccount(editingId, updatePayload)
      } else {
        await accountsApi.createBankAccount(payload)
      }
      cancel()
      load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save bank account.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await accountsApi.deleteBankAccount(deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to delete bank account.')
      setDeleteTarget(null)
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{editingId ? 'Edit Bank Account' : 'Add Bank Account'}</h2>
        {editingId && <button type="button" style={linkBtnStyle} onClick={cancel}>Cancel edit</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Bank Account Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Delete this bank account?" message={`Delete "${deleteTarget?.bank_name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Bank Name *"><input style={inputStyle} value={form.bank_name} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} /></Field>
        <Field label="Account No. *"><input style={inputStyle} value={form.account_no} onChange={(e) => setForm((f) => ({ ...f, account_no: e.target.value }))} disabled={!!editingId} /></Field>
        <Field label="Account Holder Name"><input style={inputStyle} value={form.account_holder_name} onChange={(e) => setForm((f) => ({ ...f, account_holder_name: e.target.value }))} /></Field>
        <Field label="Branch"><input style={inputStyle} value={form.branch_name} onChange={(e) => setForm((f) => ({ ...f, branch_name: e.target.value }))} /></Field>
        <Field label="IFSC Code"><input style={inputStyle} value={form.ifsc_code} onChange={(e) => setForm((f) => ({ ...f, ifsc_code: e.target.value }))} /></Field>
        <Field label={editingId ? 'Opening Balance (locked after creation)' : 'Opening Balance'}>
          <input type="number" style={inputStyle} value={form.opening_balance} disabled={!!editingId} onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))} />
        </Field>
        <Field label="Status">
          <select style={inputStyle} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Bank Account'}</button>
        </div>
      </form>

      {loading ? <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p> : accounts.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No bank accounts yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {accounts.map((a) => (
            <div key={a.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{a.bank_name} — {a.account_no}</span>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>Balance: {a.current_balance.toLocaleString('en-IN')} · {a.status}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button type="button" style={linkBtnStyle} onClick={() => startEdit(a)}>Edit</button>
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(a)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

function emptyVendor() {
  return {
    code: '', name: '', gstin: '', pan: '', city: '', state: '', contact_name: '', contact_phone: '', contact_email: '',
    bank_name: '', bank_account_no: '', ifsc_code: '', credit_limit: '', payment_days: '', status: 'active',
  }
}

function VendorsSection() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyVendor())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Vendor | null>(null)

  const load = () => { setLoading(true); accountsApi.listVendors().then(setVendors).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  const startEdit = (v: Vendor) => {
    setEditingId(v.id)
    setForm({
      code: v.code, name: v.name, gstin: v.gstin || '', pan: v.pan || '', city: v.city || '', state: v.state || '',
      contact_name: v.contact_name || '', contact_phone: v.contact_phone || '', contact_email: v.contact_email || '',
      bank_name: v.bank_name || '', bank_account_no: v.bank_account_no || '', ifsc_code: v.ifsc_code || '',
      credit_limit: v.credit_limit != null ? String(v.credit_limit) : '', payment_days: v.payment_days != null ? String(v.payment_days) : '',
      status: v.status,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyVendor()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.code.trim() || !form.name.trim()) { setError('Code and Name are required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        credit_limit: form.credit_limit ? Number(form.credit_limit) : null,
        payment_days: form.payment_days ? Number(form.payment_days) : null,
      }
      if (editingId) await accountsApi.updateVendor(editingId, payload)
      else await accountsApi.createVendor(payload)
      cancel()
      load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save vendor.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await accountsApi.deleteVendor(deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to delete vendor.')
      setDeleteTarget(null)
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{editingId ? 'Edit Vendor' : 'Add Vendor'}</h2>
        {editingId && <button type="button" style={linkBtnStyle} onClick={cancel}>Cancel edit</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Vendor Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Delete this vendor?" message={`Delete "${deleteTarget?.name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Code *"><input style={inputStyle} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} /></Field>
        <Field label="Name *"><input style={inputStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="GSTIN"><input style={inputStyle} value={form.gstin} onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value }))} /></Field>
        <Field label="PAN"><input style={inputStyle} value={form.pan} onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value }))} /></Field>
        <Field label="City"><input style={inputStyle} value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} /></Field>
        <Field label="State"><input style={inputStyle} value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} /></Field>
        <Field label="Contact Name"><input style={inputStyle} value={form.contact_name} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))} /></Field>
        <Field label="Contact Phone"><input style={inputStyle} value={form.contact_phone} onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))} /></Field>
        <Field label="Contact Email"><input style={inputStyle} value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))} /></Field>
        <Field label="Bank Name"><input style={inputStyle} value={form.bank_name} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} /></Field>
        <Field label="Bank Account No."><input style={inputStyle} value={form.bank_account_no} onChange={(e) => setForm((f) => ({ ...f, bank_account_no: e.target.value }))} /></Field>
        <Field label="IFSC Code"><input style={inputStyle} value={form.ifsc_code} onChange={(e) => setForm((f) => ({ ...f, ifsc_code: e.target.value }))} /></Field>
        <Field label="Credit Limit"><input type="number" style={inputStyle} value={form.credit_limit} onChange={(e) => setForm((f) => ({ ...f, credit_limit: e.target.value }))} /></Field>
        <Field label="Payment Days"><input type="number" style={inputStyle} value={form.payment_days} onChange={(e) => setForm((f) => ({ ...f, payment_days: e.target.value }))} /></Field>
        <Field label="Status">
          <select style={inputStyle} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="blocked">Blocked</option>
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Vendor'}</button>
        </div>
      </form>

      {loading ? <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p> : vendors.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No vendors yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {vendors.map((v) => (
            <div key={v.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{v.code} — {v.name}</span>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{[v.city, v.state, v.gstin, v.status].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button type="button" style={linkBtnStyle} onClick={() => startEdit(v)}>Edit</button>
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(v)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Internal Orders
// ---------------------------------------------------------------------------

function emptyInternalOrder() {
  return { code: '', name: '', description: '', order_type: 'capital', start_date: '', end_date: '', budgeted_amount: '', cost_center_id: '', status: 'open' }
}

function InternalOrdersSection() {
  const [orders, setOrders] = useState<InternalOrder[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyInternalOrder())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<InternalOrder | null>(null)

  const load = () => {
    setLoading(true)
    Promise.all([accountsApi.listInternalOrders(), costCentersApi.listCostCenters()])
      .then(([o, cc]) => { setOrders(o); setCostCenters(cc) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const startEdit = (o: InternalOrder) => {
    setEditingId(o.id)
    setForm({
      code: o.code, name: o.name, description: o.description || '', order_type: o.order_type,
      start_date: o.start_date || '', end_date: o.end_date || '',
      budgeted_amount: o.budgeted_amount != null ? String(o.budgeted_amount) : '',
      cost_center_id: o.cost_center_id ? String(o.cost_center_id) : '', status: o.status,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyInternalOrder()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.code.trim() || !form.name.trim()) { setError('Code and Name are required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        budgeted_amount: form.budgeted_amount ? Number(form.budgeted_amount) : null,
        cost_center_id: form.cost_center_id ? Number(form.cost_center_id) : null,
      }
      if (editingId) await accountsApi.updateInternalOrder(editingId, payload)
      else await accountsApi.createInternalOrder(payload)
      cancel()
      load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save internal order.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await accountsApi.deleteInternalOrder(deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to delete internal order.')
      setDeleteTarget(null)
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{editingId ? 'Edit Internal Order' : 'Add Internal Order'}</h2>
        {editingId && <button type="button" style={linkBtnStyle} onClick={cancel}>Cancel edit</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Internal Order Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Delete this internal order?" message={`Delete "${deleteTarget?.name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Code *"><input style={inputStyle} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} /></Field>
        <Field label="Name *"><input style={inputStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="Order Type">
          <select style={inputStyle} value={form.order_type} onChange={(e) => setForm((f) => ({ ...f, order_type: e.target.value }))}>
            <option value="capital">Capital</option>
            <option value="maintenance">Maintenance</option>
            <option value="it">IT</option>
            <option value="training">Training</option>
          </select>
        </Field>
        <Field label="Start Date"><input type="date" style={inputStyle} value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} /></Field>
        <Field label="End Date"><input type="date" style={inputStyle} value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} /></Field>
        <Field label="Budgeted Amount"><input type="number" style={inputStyle} value={form.budgeted_amount} onChange={(e) => setForm((f) => ({ ...f, budgeted_amount: e.target.value }))} /></Field>
        <Field label="Cost Center">
          <select style={inputStyle} value={form.cost_center_id} onChange={(e) => setForm((f) => ({ ...f, cost_center_id: e.target.value }))}>
            <option value="">— None —</option>
            {costCenters.map((cc) => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select style={inputStyle} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Description"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Internal Order'}</button>
        </div>
      </form>

      {loading ? <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p> : orders.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No internal orders yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {orders.map((o) => (
            <div key={o.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{o.code} — {o.name}</span>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0, textTransform: 'capitalize' }}>{[o.order_type, o.cost_center_name, o.status].filter(Boolean).join(' · ')}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button type="button" style={linkBtnStyle} onClick={() => startEdit(o)}>Edit</button>
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(o)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
