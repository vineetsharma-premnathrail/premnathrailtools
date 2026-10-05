'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireAdmin } from '@/hooks/useAuth'
import { organizationApi, storeApi, costCentersApi, usersApi } from '@/lib/api'
import {
  Branch, BranchAddress, BranchUserAssignment, BranchDocument, Department,
  StoreLocation, CostCenter, DirectoryUser,
} from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import FileUploadField from '@/components/shared/FileUploadField'
import { PLANT_STATUS_LABELS } from '@/components/organization/PlantForm'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }
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

type FormState = Partial<Branch>

const TABS = ['Basic', 'Address', 'Operational Configuration', 'Branch Users', 'Branch Departments', 'Branch Stores', 'Branch Cost Centers', 'Branch Documents'] as const
const LIST_TABS = new Set(['Address', 'Branch Users', 'Branch Departments', 'Branch Stores', 'Branch Cost Centers', 'Branch Documents'])

export default function EditPlantPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const params = useParams()
  const router = useRouter()
  const plantId = Number(params.id)

  const [form, setForm] = useState<FormState>({})
  const [directory, setDirectory] = useState<DirectoryUser[]>([])
  const [addresses, setAddresses] = useState<BranchAddress[]>([])
  const [assignments, setAssignments] = useState<BranchUserAssignment[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [warehouses, setWarehouses] = useState<StoreLocation[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [documents, setDocuments] = useState<BranchDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<typeof TABS[number]>('Basic')

  const loadLists = () => {
    Promise.all([
      organizationApi.listBranchAddresses(plantId),
      organizationApi.listBranchUserAssignments(plantId),
      organizationApi.listDepartments(plantId),
      storeApi.listLocations(plantId),
      costCentersApi.listCostCenters(plantId),
      organizationApi.listBranchDocuments(plantId),
    ]).then(([a, u, d, w, cc, docs]) => {
      setAddresses(a); setAssignments(u); setDepartments(d); setWarehouses(w); setCostCenters(cc); setDocuments(docs)
    })
  }

  useEffect(() => {
    if (isAuthorized && plantId) {
      setLoading(true)
      setError('')
      Promise.all([
        organizationApi.getBranch(plantId), usersApi.directory(),
        organizationApi.listBranchAddresses(plantId), organizationApi.listBranchUserAssignments(plantId),
        organizationApi.listDepartments(plantId), storeApi.listLocations(plantId),
        costCentersApi.listCostCenters(plantId), organizationApi.listBranchDocuments(plantId),
      ])
        .then(([p, dir, a, u, d, w, cc, docs]) => {
          setForm(p); setDirectory(dir)
          setAddresses(a); setAssignments(u); setDepartments(d); setWarehouses(w); setCostCenters(cc); setDocuments(docs)
        })
        .catch(() => setError('Failed to load branch.'))
        .finally(() => setLoading(false))
    }
  }, [isAuthorized, plantId])

  const setField = (field: keyof Branch, value: unknown) => setForm((f) => ({ ...f, [field]: value }))

  const handleSave = async () => {
    if (!form.name?.trim()) { setError('Branch name is required'); return }
    if (!form.code?.trim()) { setError('Branch code is required'); return }
    setSaving(true)
    setError('')
    try {
      await organizationApi.updateBranch(plantId, form)
      router.push(`/dashboard/organization/plants/${plantId}`)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save branch.')
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <OrganizationNav />
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
              <span onClick={() => router.push(`/dashboard/organization/plants/${plantId}`)} style={{ cursor: 'pointer' }}>Branches › {form.name || '...'}</span> › Edit
            </p>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Edit Branch</h1>
          </div>
          <button type="button" onClick={() => router.push(`/dashboard/organization/plants/${plantId}`)} data-tour="org-plant-back" style={secondaryBtnStyle}>← Back</button>
        </div>

        <MessageDialog open={!!error} variant="error" title="Branch Error" message={error} onClose={() => setError('')} />

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: TEXT.muted, fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            <div data-tour="org-plant-form-tabs" style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${BORDER.normal}`, flexWrap: 'wrap' }}>
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  style={{
                    padding: '10px 6px', marginRight: 16, border: 'none', borderRadius: 0, boxShadow: 'none', outline: 'none',
                    background: 'transparent', borderBottom: tab === t ? `2px solid ${BRAND.primary}` : '2px solid transparent',
                    color: tab === t ? BRAND.primary : TEXT.secondary, fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === 'Basic' && (
              <div style={sectionStyle}>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px 0' }}>Basic Information</h2>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>Branch Name *</label>
                    <input data-tour="org-plant-name" style={inputStyle} value={form.name || ''} onChange={(e) => setField('name', e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Branch Code *</label>
                    <input data-tour="org-plant-code" style={inputStyle} value={form.code || ''} onChange={(e) => setField('code', e.target.value.toUpperCase())} />
                  </div>
                </div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>Branch Type *</label>
                    <input data-tour="org-plant-type" style={inputStyle} value={form.plant_type || ''} onChange={(e) => setField('plant_type', e.target.value)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Branch Status *</label>
                    <select data-tour="org-plant-status" style={inputStyle} value={form.status || 'active'} onChange={(e) => setField('status', e.target.value)}>
                      {Object.entries(PLANT_STATUS_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                    </select>
                  </div>
                </div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>Branch Head</label>
                    <select data-tour="org-plant-head" style={inputStyle} value={form.head_user_id || ''} onChange={(e) => setField('head_user_id', e.target.value ? Number(e.target.value) : null)}>
                      <option value="">— Select —</option>
                      {directory.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Branch Manager</label>
                    <select data-tour="org-plant-manager" style={inputStyle} value={form.manager_user_id || ''} onChange={(e) => setField('manager_user_id', e.target.value ? Number(e.target.value) : null)}>
                      <option value="">— Select —</option>
                      {directory.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                </div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>Established Date</label>
                    <input type="date" data-tour="org-plant-established-date" style={inputStyle} value={form.established_date || ''} onChange={(e) => setField('established_date', e.target.value || null)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Industry / Function</label>
                    <input data-tour="org-plant-industry" style={inputStyle} value={form.industry_function || ''} onChange={(e) => setField('industry_function', e.target.value || null)} />
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Description</label>
                  <textarea data-tour="org-plant-description" style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form.description || ''} onChange={(e) => setField('description', e.target.value || null)} />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Active From</label>
                  <input type="date" data-tour="org-plant-active-from" style={{ ...inputStyle, maxWidth: 260 }} value={form.active_from || ''} onChange={(e) => setField('active_from', e.target.value || null)} />
                </div>
                <div>
                  <label style={labelStyle}>Remarks</label>
                  <textarea data-tour="org-plant-remarks" style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form.remarks || ''} onChange={(e) => setField('remarks', e.target.value || null)} />
                </div>
              </div>
            )}

            {tab === 'Address' && <AddressesEditor branchId={plantId} addresses={addresses} onRefresh={loadLists} />}

            {tab === 'Operational Configuration' && (
              <div style={sectionStyle}>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px 0' }}>Operational Configuration</h2>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>Working Calendar *</label>
                    <input style={inputStyle} value={form.working_calendar || ''} onChange={(e) => setField('working_calendar', e.target.value || null)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Working Days</label>
                    <input style={inputStyle} value={form.working_days || ''} onChange={(e) => setField('working_days', e.target.value || null)} placeholder="Mon–Fri" />
                  </div>
                </div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>Working Hours</label>
                    <input style={inputStyle} value={form.working_hours || ''} onChange={(e) => setField('working_hours', e.target.value || null)} placeholder="09:00–18:00" />
                  </div>
                  <div>
                    <label style={labelStyle}>Time Zone</label>
                    <input style={inputStyle} value={form.timezone || ''} onChange={(e) => setField('timezone', e.target.value || null)} placeholder="Asia/Kolkata" />
                  </div>
                </div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>Default Store</label>
                    <select style={inputStyle} value={form.default_warehouse_id || ''} onChange={(e) => setField('default_warehouse_id', e.target.value ? Number(e.target.value) : null)}>
                      <option value="">— Select —</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Default Cost Center</label>
                    <select style={inputStyle} value={form.default_cost_center_id || ''} onChange={(e) => setField('default_cost_center_id', e.target.value ? Number(e.target.value) : null)}>
                      <option value="">— Select —</option>
                      {costCenters.map((cc) => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
                    </select>
                  </div>
                </div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>Default Profit Center</label>
                    <input style={inputStyle} value={form.default_profit_center || ''} onChange={(e) => setField('default_profit_center', e.target.value || null)} />
                  </div>
                  <div>
                    <label style={labelStyle}>Currency</label>
                    <input style={inputStyle} value={form.currency || ''} onChange={(e) => setField('currency', e.target.value || null)} placeholder="INR" />
                  </div>
                </div>
                <p style={{ fontSize: 11.5, color: TEXT.muted, margin: 0 }}>Stores and cost centers are managed from their own tabs on this page, then chosen as defaults here.</p>
              </div>
            )}

            {tab === 'Branch Users' && <UserAssignmentsEditor branchId={plantId} assignments={assignments} directory={directory} departments={departments} onRefresh={loadLists} />}

            {tab === 'Branch Departments' && (
              <div style={sectionStyle}>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Branch Departments</h2>
                <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '0 0 12px' }}>Departments are created and edited from Organization &gt; Department (assign a department to this branch there). This list is read-only.</p>
                {departments.length === 0 ? (
                  <p style={{ fontSize: 13, color: TEXT.muted }}>No departments under this branch yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {departments.map((d) => (
                      <div key={d.id} style={cardRowStyle}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{d.name}</span>
                        <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{[d.code, d.head_user_name].filter(Boolean).join(' · ') || '—'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'Branch Stores' && <WarehousesEditor branchId={plantId} warehouses={warehouses} directory={directory} onRefresh={loadLists} />}

            {tab === 'Branch Cost Centers' && <CostCentersEditor branchId={plantId} costCenters={costCenters} directory={directory} departments={departments} onRefresh={loadLists} />}

            {tab === 'Branch Documents' && <DocumentsEditor branchId={plantId} documents={documents} onRefresh={loadLists} />}

            {!LIST_TABS.has(tab) && (
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => router.push(`/dashboard/organization/plants/${plantId}`)}
                  disabled={saving}
                  data-tour="org-plant-cancel"
                  style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #d4d4d8', background: '#fff', color: TEXT.body, fontSize: 13.5, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1 }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  data-tour="org-plant-save"
                  style={{
                    padding: '10px 24px', borderRadius: 10, border: 'none',
                    background: saving ? '#999' : `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`,
                    color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                    boxShadow: saving ? 'none' : `0 4px 14px ${BRAND.primaryGlow}`,
                  }}
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

function emptyAddress() {
  return { address_type: '', address_line1: '', address_line2: '', landmark: '', country: '', state: '', city: '', district: '', pincode: '', is_primary: false, is_active: true }
}

function AddressesEditor({ branchId, addresses, onRefresh }: { branchId: number; addresses: BranchAddress[]; onRefresh: () => void }) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyAddress())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BranchAddress | null>(null)

  const startEdit = (a: BranchAddress) => {
    setEditingId(a.id)
    setForm({
      address_type: a.address_type || '', address_line1: a.address_line1, address_line2: a.address_line2 || '',
      landmark: a.landmark || '', country: a.country || '', state: a.state || '', city: a.city || '',
      district: a.district || '', pincode: a.pincode || '', is_primary: a.is_primary, is_active: a.is_active,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyAddress()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.address_line1.trim()) { setError('Address Line 1 is required'); return }
    setSaving(true)
    setError('')
    try {
      if (editingId) await organizationApi.updateBranchAddress(branchId, editingId, form)
      else await organizationApi.createBranchAddress(branchId, form)
      cancel()
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save address.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await organizationApi.deleteBranchAddress(branchId, deleteTarget.id)
      setDeleteTarget(null)
      onRefresh()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete address.').join(' '))
      setDeleteTarget(null)
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{editingId ? 'Edit Address' : 'Add Address'}</h2>
        {editingId && <button type="button" style={linkBtnStyle} onClick={cancel}>Cancel edit</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Address Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Delete this address?" message={`Delete the "${deleteTarget?.address_type || 'address'}" record? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Address Type *"><input style={inputStyle} value={form.address_type} onChange={(e) => setForm((f) => ({ ...f, address_type: e.target.value }))} placeholder="Main Plant" /></Field>
        <Field label="Landmark"><input style={inputStyle} value={form.landmark} onChange={(e) => setForm((f) => ({ ...f, landmark: e.target.value }))} /></Field>
        <div style={{ gridColumn: '1 / -1' }}><Field label="Address Line 1 *"><input style={inputStyle} value={form.address_line1} onChange={(e) => setForm((f) => ({ ...f, address_line1: e.target.value }))} /></Field></div>
        <div style={{ gridColumn: '1 / -1' }}><Field label="Address Line 2"><input style={inputStyle} value={form.address_line2} onChange={(e) => setForm((f) => ({ ...f, address_line2: e.target.value }))} /></Field></div>
        <Field label="Country *"><input style={inputStyle} value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} /></Field>
        <Field label="State / UT *"><input style={inputStyle} value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} /></Field>
        <Field label="City *"><input style={inputStyle} value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} /></Field>
        <Field label="District"><input style={inputStyle} value={form.district} onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))} /></Field>
        <Field label="PIN Code *"><input style={inputStyle} value={form.pincode} onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value }))} /></Field>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.body }}><input type="checkbox" checked={form.is_primary} onChange={(e) => setForm((f) => ({ ...f, is_primary: e.target.checked }))} /> Primary Address</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.body }}><input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} /> Active</label>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Address'}</button>
        </div>
      </form>

      {addresses.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No addresses added yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {addresses.map((a) => (
            <div key={a.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{a.address_type || 'Address'}</span>
                    {a.is_primary && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.12)', color: '#047857' }}>PRIMARY</span>}
                    {!a.is_active && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(220,38,38,0.1)', color: '#b91c1c' }}>INACTIVE</span>}
                  </div>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{[a.address_line1, a.address_line2, a.landmark, a.city, a.district, a.state, a.country, a.pincode].filter(Boolean).join(', ')}</p>
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
// Branch Users
// ---------------------------------------------------------------------------

function emptyAssignment() {
  return { user_id: '', employee_id: '', department_id: '', designation: '', role: '', access_level: '', is_primary_branch: false, effective_from: '', effective_to: '', status: 'active' }
}

function UserAssignmentsEditor({ branchId, assignments, directory, departments, onRefresh }: {
  branchId: number; assignments: BranchUserAssignment[]; directory: DirectoryUser[]; departments: Department[]; onRefresh: () => void
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyAssignment())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BranchUserAssignment | null>(null)

  const startEdit = (a: BranchUserAssignment) => {
    setEditingId(a.id)
    setForm({
      user_id: String(a.user_id), employee_id: a.employee_id || '', department_id: a.department_id ? String(a.department_id) : '',
      designation: a.designation || '', role: a.role || '', access_level: a.access_level || '',
      is_primary_branch: a.is_primary_branch, effective_from: a.effective_from || '', effective_to: a.effective_to || '', status: a.status,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyAssignment()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.user_id) { setError('User is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        user_id: Number(form.user_id),
        department_id: form.department_id ? Number(form.department_id) : null,
        effective_from: form.effective_from || null,
        effective_to: form.effective_to || null,
      }
      if (editingId) await organizationApi.updateBranchUserAssignment(branchId, editingId, payload)
      else await organizationApi.createBranchUserAssignment(branchId, payload)
      cancel()
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save assignment.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await organizationApi.deleteBranchUserAssignment(branchId, deleteTarget.id)
      setDeleteTarget(null)
      onRefresh()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete assignment.').join(' '))
      setDeleteTarget(null)
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{editingId ? 'Edit Branch User' : 'Add Branch User'}</h2>
        {editingId && <button type="button" style={linkBtnStyle} onClick={cancel}>Cancel edit</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Branch User Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Remove this branch user?" message={`Remove "${deleteTarget?.user_name}" from this branch? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="User *">
          <select style={inputStyle} value={form.user_id} onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}>
            <option value="">— Select —</option>
            {directory.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Employee ID"><input style={inputStyle} value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))} /></Field>
        <Field label="Department">
          <select style={inputStyle} value={form.department_id} onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))}>
            <option value="">— Select —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Designation"><input style={inputStyle} value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} /></Field>
        <Field label="Role"><input style={inputStyle} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} /></Field>
        <Field label="Access Level">
          <select style={inputStyle} value={form.access_level} onChange={(e) => setForm((f) => ({ ...f, access_level: e.target.value }))}>
            <option value="">— Select —</option>
            <option value="view">View</option>
            <option value="edit">Edit</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Field label="Effective From"><input type="date" style={inputStyle} value={form.effective_from} onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} /></Field>
        <Field label="Effective To"><input type="date" style={inputStyle} value={form.effective_to} onChange={(e) => setForm((f) => ({ ...f, effective_to: e.target.value }))} /></Field>
        <Field label="Status">
          <select style={inputStyle} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.body }}><input type="checkbox" checked={form.is_primary_branch} onChange={(e) => setForm((f) => ({ ...f, is_primary_branch: e.target.checked }))} /> Primary Branch for this user</label>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Branch User'}</button>
        </div>
      </form>

      {assignments.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No users assigned yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {assignments.map((a) => (
            <div key={a.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{a.user_name || `User #${a.user_id}`}</span>
                    {a.role && <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: BRAND.primary }}>{a.role}</span>}
                    {a.is_primary_branch && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(16,185,129,0.12)', color: '#047857' }}>PRIMARY</span>}
                  </div>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{[a.designation, a.department_name, a.access_level, a.employee_id].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button type="button" style={linkBtnStyle} onClick={() => startEdit(a)}>Edit</button>
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(a)}>Remove</button>
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
// Branch Stores
// ---------------------------------------------------------------------------

function emptyWarehouse() {
  return { name: '', code: '', warehouse_type: '', manager_user_id: '', address: '', storage_type: '', inventory_type: '', operating_hours: '', status: 'active' }
}

function WarehousesEditor({ branchId, warehouses, directory, onRefresh }: { branchId: number; warehouses: StoreLocation[]; directory: DirectoryUser[]; onRefresh: () => void }) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyWarehouse())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<StoreLocation | null>(null)

  const startEdit = (w: StoreLocation) => {
    setEditingId(w.id)
    setForm({
      name: w.name, code: w.code, warehouse_type: w.warehouse_type || '', manager_user_id: w.manager_user_id ? String(w.manager_user_id) : '',
      address: w.address || '', storage_type: w.storage_type || '', inventory_type: w.inventory_type || '', operating_hours: w.operating_hours || '', status: w.status,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyWarehouse()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.code.trim()) { setError('Store Name and Code are required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, manager_user_id: form.manager_user_id ? Number(form.manager_user_id) : null }
      if (editingId) await storeApi.updateLocation(editingId, payload)
      else await storeApi.createLocation({ ...payload, branch_id: branchId })
      cancel()
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save store.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await storeApi.deleteLocation(deleteTarget.id)
      setDeleteTarget(null)
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to delete store.')
      setDeleteTarget(null)
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{editingId ? 'Edit Store' : 'Add Store'}</h2>
        {editingId && <button type="button" style={linkBtnStyle} onClick={cancel}>Cancel edit</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Store Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Delete this store?" message={`Delete "${deleteTarget?.name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Store Name *"><input style={inputStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="Store Code *"><input style={inputStyle} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Store Type *"><input style={inputStyle} value={form.warehouse_type} onChange={(e) => setForm((f) => ({ ...f, warehouse_type: e.target.value }))} placeholder="Raw Material" /></Field>
        <Field label="Store Manager">
          <select style={inputStyle} value={form.manager_user_id} onChange={(e) => setForm((f) => ({ ...f, manager_user_id: e.target.value }))}>
            <option value="">— Select —</option>
            {directory.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1' }}><Field label="Address"><input style={inputStyle} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></Field></div>
        <Field label="Storage Type"><input style={inputStyle} value={form.storage_type} onChange={(e) => setForm((f) => ({ ...f, storage_type: e.target.value }))} /></Field>
        <Field label="Inventory Type"><input style={inputStyle} value={form.inventory_type} onChange={(e) => setForm((f) => ({ ...f, inventory_type: e.target.value }))} /></Field>
        <Field label="Operating Hours"><input style={inputStyle} value={form.operating_hours} onChange={(e) => setForm((f) => ({ ...f, operating_hours: e.target.value }))} placeholder="09:00–18:00" /></Field>
        <Field label="Status *">
          <select style={inputStyle} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="under_maintenance">Under Maintenance</option>
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Store'}</button>
        </div>
      </form>

      {warehouses.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No stores added yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {warehouses.map((w) => (
            <div key={w.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{w.name}</span>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{[w.code, w.warehouse_type, w.manager_user_name, w.status].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button type="button" style={linkBtnStyle} onClick={() => startEdit(w)}>Edit</button>
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(w)}>Delete</button>
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
// Branch Cost Centers
// ---------------------------------------------------------------------------

function emptyCostCenter() {
  return { code: '', name: '', cost_center_type: '', department_id: '', head_user_id: '', parent_cost_center_id: '', effective_from: '', effective_to: '', status: 'active' }
}

function CostCentersEditor({ branchId, costCenters, directory, departments, onRefresh }: {
  branchId: number; costCenters: CostCenter[]; directory: DirectoryUser[]; departments: Department[]; onRefresh: () => void
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyCostCenter())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CostCenter | null>(null)

  const startEdit = (cc: CostCenter) => {
    setEditingId(cc.id)
    setForm({
      code: cc.code, name: cc.name, cost_center_type: cc.cost_center_type || '', department_id: cc.department_id ? String(cc.department_id) : '',
      head_user_id: cc.head_user_id ? String(cc.head_user_id) : '', parent_cost_center_id: cc.parent_cost_center_id ? String(cc.parent_cost_center_id) : '',
      effective_from: cc.effective_from || '', effective_to: cc.effective_to || '', status: cc.status,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyCostCenter()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.code.trim() || !form.name.trim()) { setError('Cost Center Code and Name are required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        department_id: form.department_id ? Number(form.department_id) : null,
        head_user_id: form.head_user_id ? Number(form.head_user_id) : null,
        parent_cost_center_id: form.parent_cost_center_id ? Number(form.parent_cost_center_id) : null,
        effective_from: form.effective_from || null,
        effective_to: form.effective_to || null,
      }
      if (editingId) await costCentersApi.updateCostCenter(editingId, payload)
      else await costCentersApi.createCostCenter({ ...payload, branch_id: branchId })
      cancel()
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to save cost center.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await costCentersApi.deleteCostCenter(deleteTarget.id)
      setDeleteTarget(null)
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to delete cost center.')
      setDeleteTarget(null)
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{editingId ? 'Edit Cost Center' : 'Add Cost Center'}</h2>
        {editingId && <button type="button" style={linkBtnStyle} onClick={cancel}>Cancel edit</button>}
      </div>

      <MessageDialog open={!!error} variant="error" title="Cost Center Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Delete this cost center?" message={`Delete "${deleteTarget?.name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Field label="Cost Center Code *"><input style={inputStyle} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Cost Center Name *"><input style={inputStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="Cost Center Type"><input style={inputStyle} value={form.cost_center_type} onChange={(e) => setForm((f) => ({ ...f, cost_center_type: e.target.value }))} /></Field>
        <Field label="Department">
          <select style={inputStyle} value={form.department_id} onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value }))}>
            <option value="">— Select —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Cost Center Head">
          <select style={inputStyle} value={form.head_user_id} onChange={(e) => setForm((f) => ({ ...f, head_user_id: e.target.value }))}>
            <option value="">— Select —</option>
            {directory.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Parent Cost Center">
          <select style={inputStyle} value={form.parent_cost_center_id} onChange={(e) => setForm((f) => ({ ...f, parent_cost_center_id: e.target.value }))}>
            <option value="">— None —</option>
            {costCenters.filter((cc) => cc.id !== editingId).map((cc) => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
          </select>
        </Field>
        <Field label="Effective From"><input type="date" style={inputStyle} value={form.effective_from} onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} /></Field>
        <Field label="Effective To"><input type="date" style={inputStyle} value={form.effective_to} onChange={(e) => setForm((f) => ({ ...f, effective_to: e.target.value }))} /></Field>
        <Field label="Status">
          <select style={inputStyle} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Cost Center'}</button>
        </div>
      </form>

      {costCenters.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No cost centers added yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {costCenters.map((cc) => (
            <div key={cc.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{cc.name}</span>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{[cc.code, cc.cost_center_type, cc.department_name, cc.head_user_name].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button type="button" style={linkBtnStyle} onClick={() => startEdit(cc)}>Edit</button>
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(cc)}>Delete</button>
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
// Branch Documents
// ---------------------------------------------------------------------------

const DOCUMENT_TYPES = ['License', 'Certificate', 'Registration', 'Agreement', 'Compliance', 'Other']
const CONFIDENTIALITY_LEVELS = ['Public', 'Internal', 'Confidential']

function emptyDocumentMeta() {
  return { document_type: 'Other', document_name: '', document_number: '', issue_date: '', expiry_date: '', issuing_authority: '', version: '', status: '', confidentiality: 'Internal', tags: '', remarks: '' }
}

function DocumentsEditor({ branchId, documents, onRefresh }: { branchId: number; documents: BranchDocument[]; onRefresh: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState(emptyDocumentMeta())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BranchDocument | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) { setError('Select a file to upload'); return }
    if (!meta.document_name.trim()) { setError('Document Name is required'); return }
    setSaving(true)
    setError('')
    try {
      await organizationApi.uploadBranchDocument(branchId, file, meta)
      setFile(null)
      setMeta(emptyDocumentMeta())
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Failed to upload document.')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    try {
      await organizationApi.deleteBranchDocument(branchId, deleteTarget.id)
      setDeleteTarget(null)
      onRefresh()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete document.').join(' '))
      setDeleteTarget(null)
    }
  }

  return (
    <div style={sectionStyle}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Add Branch Document</h2>

      <MessageDialog open={!!error} variant="error" title="Document Error" message={error} onClose={() => setError('')} />
      <ConfirmDialog open={!!deleteTarget} title="Delete this document?" message={`Delete "${deleteTarget?.document_name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}><Field label="Document File *"><FileUploadField file={file} onChange={setFile} onRemove={() => setFile(null)} uploading={saving} /></Field></div>
        <Field label="Document Type *">
          <select style={inputStyle} value={meta.document_type} onChange={(e) => setMeta((m) => ({ ...m, document_type: e.target.value }))}>
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Document Name *"><input style={inputStyle} value={meta.document_name} onChange={(e) => setMeta((m) => ({ ...m, document_name: e.target.value }))} /></Field>
        <Field label="Document Number"><input style={inputStyle} value={meta.document_number} onChange={(e) => setMeta((m) => ({ ...m, document_number: e.target.value }))} /></Field>
        <Field label="Issue Date"><input type="date" style={inputStyle} value={meta.issue_date} onChange={(e) => setMeta((m) => ({ ...m, issue_date: e.target.value }))} /></Field>
        <Field label="Expiry Date"><input type="date" style={inputStyle} value={meta.expiry_date} onChange={(e) => setMeta((m) => ({ ...m, expiry_date: e.target.value }))} /></Field>
        <Field label="Issuing Authority"><input style={inputStyle} value={meta.issuing_authority} onChange={(e) => setMeta((m) => ({ ...m, issuing_authority: e.target.value }))} /></Field>
        <Field label="Version"><input style={inputStyle} value={meta.version} onChange={(e) => setMeta((m) => ({ ...m, version: e.target.value }))} /></Field>
        <Field label="Status"><input style={inputStyle} value={meta.status} onChange={(e) => setMeta((m) => ({ ...m, status: e.target.value }))} placeholder="Active" /></Field>
        <Field label="Confidentiality">
          <select style={inputStyle} value={meta.confidentiality} onChange={(e) => setMeta((m) => ({ ...m, confidentiality: e.target.value }))}>
            {CONFIDENTIALITY_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Tags (comma separated)"><input style={inputStyle} value={meta.tags} onChange={(e) => setMeta((m) => ({ ...m, tags: e.target.value }))} /></Field>
        <div style={{ gridColumn: '1 / -1' }}><Field label="Remarks"><input style={inputStyle} value={meta.remarks} onChange={(e) => setMeta((m) => ({ ...m, remarks: e.target.value }))} /></Field></div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.6 : 1 }}>{saving ? 'Uploading…' : 'Save Document'}</button>
        </div>
      </form>

      {documents.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted }}>No documents uploaded yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {documents.map((d) => (
            <div key={d.id} style={cardRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{d.document_name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: BRAND.primary }}>{d.document_type}</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>{d.filename}{d.expiry_date ? ` · Expires ${d.expiry_date}` : ''}{d.version ? ` · v${d.version}` : ''}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  {d.sharepoint_url && <a href={d.sharepoint_url} target="_blank" rel="noreferrer" style={linkBtnStyle}>Open</a>}
                  <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(d)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
