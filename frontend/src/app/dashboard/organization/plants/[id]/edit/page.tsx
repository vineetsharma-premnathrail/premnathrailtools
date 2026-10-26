'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { organizationApi, storeApi, costCentersApi, usersApi } from '@/lib/api'
import {
  Branch, BranchAddress, BranchUserAssignment, BranchDocument, Department,
  StoreLocation, CostCenter, DirectoryUser,
} from '@/types'
import OrganizationNav from '@/components/organization/OrganizationNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import FileUploadField from '@/components/shared/FileUploadField'
import { PLANT_STATUS_LABELS } from '@/components/organization/PlantForm'
import { FormPage, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

const { INK, BODY, MUTED, LINE, SOFT, BLUE } = SHEET

const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }
const checkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: BODY }
/** The add/edit block above each list (address, user, store, cost center, document). */
const subFormStyle: React.CSSProperties = { padding: 16, borderRadius: 12, background: SOFT, border: `1px solid ${LINE}`, marginBottom: 18 }
const listRowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 12, background: '#fff', border: `1px solid ${LINE}` }
const linkBtnStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: BLUE, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }
const dangerLinkStyle: React.CSSProperties = { ...linkBtnStyle, color: '#b91c1c' }
const pill = (bg: string, color: string): React.CSSProperties => ({ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: bg, color })

/** One field: label + control, sized by its flex basis (short fields stay short). */
function F({ label, req, basis = 240, max, children }: { label: string; req?: boolean; basis?: number; max?: number; children: React.ReactNode }) {
  return (
    <div style={{ flex: `1 1 ${basis}px`, minWidth: Math.min(basis, 160), maxWidth: max }}>
      <label style={sheetLabel}>{label} {req && <Req />}</label>
      {children}
    </div>
  )
}

/** Flat underline tab — every border side set explicitly so the app-wide <button> style doesn't show through. */
function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '10px 4px', marginRight: 18, marginBottom: -1, borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderRadius: 0, boxShadow: 'none', outline: 'none',
    background: 'transparent', borderBottom: active ? `2px solid ${BLUE}` : '2px solid transparent',
    color: active ? BLUE : MUTED, fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
  }
}

function SubFormHead({ title, editing, onCancel }: { title: string; editing: boolean; onCancel: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <h4 style={{ fontSize: 13.5, fontWeight: 700, color: INK, margin: 0 }}>{title}</h4>
      {editing && <button type="button" style={linkBtnStyle} onClick={onCancel}>Cancel edit</button>}
    </div>
  )
}

function SaveBtn({ tour, saving, label, busyLabel = 'Saving…' }: { tour: string; saving: boolean; label: string; busyLabel?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <button type="submit" data-tour={tour} disabled={saving} style={sheetBtn('primary', BLUE, saving)}><SheetIcon name="check" size={16} />{saving ? busyLabel : label}</button>
    </div>
  )
}

type FormState = Partial<Branch>

const TABS = ['Basic', 'Address', 'Operational Configuration', 'Branch Users', 'Branch Departments', 'Branch Stores', 'Branch Cost Centers', 'Branch Documents'] as const
const LIST_TABS = new Set(['Address', 'Branch Users', 'Branch Departments', 'Branch Stores', 'Branch Cost Centers', 'Branch Documents'])

export default function EditPlantPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('branches', 'edit')
  const { canFeature } = useCan()
  // Plant features (core/features/organization.py): Branch Users needs its Edit here, Branch Documents its View.
  const editUsers = canFeature('organization', 'branches', 'user_assignments', 'edit')
  const seeDocs = canFeature('organization', 'branches', 'documents', 'view')
  const seeTab = (t: typeof TABS[number]) => (t === 'Branch Users' ? editUsers : t === 'Branch Documents' ? seeDocs : true)
  const params = useParams()
  const router = useRouter()
  const ref = params.id as string
  const { id: resolvedPlantId, error: linkError } = useRecordId(ref)
  const plantId = resolvedPlantId ?? 0

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
      editUsers ? organizationApi.listBranchUserAssignments(plantId) : Promise.resolve([]),
      organizationApi.listDepartments(plantId),
      storeApi.listLocations(plantId),
      costCentersApi.listCostCenters(plantId),
      seeDocs ? organizationApi.listBranchDocuments(plantId) : Promise.resolve([]),
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
        organizationApi.listBranchAddresses(plantId), editUsers ? organizationApi.listBranchUserAssignments(plantId) : Promise.resolve([]),
        organizationApi.listDepartments(plantId), storeApi.listLocations(plantId),
        costCentersApi.listCostCenters(plantId), seeDocs ? organizationApi.listBranchDocuments(plantId) : Promise.resolve([]),
      ])
        .then(([p, dir, a, u, d, w, cc, docs]) => {
          setForm(p); setDirectory(dir)
          setAddresses(a); setAssignments(u); setDepartments(d); setWarehouses(w); setCostCenters(cc); setDocuments(docs)
        })
        .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load this plant and its addresses, departments, store locations, cost centers or documents. Reload the page; if it keeps failing, check that the plant still exists under Organization > Plants.').join(' ')))
        .finally(() => setLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, plantId])

  const setField = (field: keyof Branch, value: unknown) => setForm((f) => ({ ...f, [field]: value }))

  const handleSave = async () => {
    if (!form.name?.trim()) { setError('Branch name is required — enter it on the Basic tab.'); setTab('Basic'); return }
    if (!form.code?.trim()) { setError('Branch code is required — enter it on the Basic tab (e.g. U3).'); setTab('Basic'); return }
    setSaving(true)
    setError('')
    try {
      await organizationApi.updateBranch(plantId, form)
      router.push(`/dashboard/organization/plants/${ref}`)
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not save the branch. Check the fields (the code must be unique) and try again.').join(' '))
      setSaving(false)
    }
  }

  // Plain render helpers (called as functions, not components, so inputs keep focus while typing).
  const text = (field: keyof Branch, label: string, o: { tour?: string; req?: boolean; ph?: string; basis?: number; max?: number; keepEmpty?: boolean; upper?: boolean } = {}) => (
    <F label={label} req={o.req} basis={o.basis} max={o.max}>
      <input data-tour={o.tour} style={sheetInput} value={(form[field] as string | null | undefined) || ''} placeholder={o.ph}
        onChange={(e) => setField(field, o.upper ? e.target.value.toUpperCase() : o.keepEmpty ? e.target.value : (e.target.value || null))} />
    </F>
  )
  const date = (field: keyof Branch, label: string, tour: string) => (
    <F label={label} basis={170} max={240}>
      <div data-tour={tour}><DateField value={(form[field] as string | null | undefined) || ''} onChange={(v) => setField(field, v || null)} /></div>
    </F>
  )
  const userSelect = (field: keyof Branch, label: string, tour: string) => (
    <F label={label} basis={240} max={340}>
      <Select data-tour={tour} style={sheetInput} value={(form[field] as number | null | undefined) || ''} onChange={(e) => setField(field, e.target.value ? Number(e.target.value) : null)}>
        <option value="">— Select —</option>
        {directory.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </Select>
    </F>
  )

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><OrganizationNav /><InvalidRecordLink message={linkError} listHref="/dashboard/organization/plants" listLabel="Back to branches" /></div>)
  if (!plantId) return <div><OrganizationNav /></div>

  const isList = LIST_TABS.has(tab)
  const backToPlant = () => router.push(`/dashboard/organization/plants/${ref}`)

  return (
    <FormPage
      nav={<OrganizationNav />}
      icon="building"
      title="Edit Branch"
      subtitle={`Branches › ${form.name || '...'} › Edit`}
      onBack={backToPlant} backTour="org-plant-back"
      footer={isList ? (
        <p style={{ fontSize: 12.5, color: MUTED, margin: 0, alignSelf: 'center' }}>
          {tab === 'Branch Departments' ? 'Departments are maintained under Organization › Department.' : 'Each entry on this tab saves on its own with its Save button above.'}
        </p>
      ) : (
        <>
          <button type="button" onClick={backToPlant} disabled={saving} data-tour="org-plant-cancel" style={sheetBtn('secondary', INK, saving)}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving || loading} data-tour="org-plant-save" style={sheetBtn('primary', BLUE, saving || loading)}>
            <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save Changes'}
          </button>
        </>
      )}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: MUTED, fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <div data-tour="org-plant-form-tabs" style={{ display: 'flex', flexWrap: 'wrap', padding: '0 24px', borderBottom: `1px solid ${LINE}` }}>
            {TABS.filter(seeTab).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} data-tour={`org-plant-edit-tab-${t.toLowerCase().replace(/ /g, '-')}`} style={tabStyle(tab === t)}>{t}</button>
            ))}
          </div>

          <div style={{ padding: '20px 24px' }}>
            <SheetError error={error} />

            {(tab === 'Basic' || !seeTab(tab)) && (
              <>
                <SheetSection icon="building" title="Basic Information">
                  <div style={rowStyle}>
                    {text('name', 'Branch Name', { tour: 'org-plant-name', req: true, keepEmpty: true, basis: 260, max: 360 })}
                    {text('code', 'Branch Code', { tour: 'org-plant-code', req: true, upper: true, basis: 150, max: 220 })}
                  </div>
                  <div style={rowStyle}>
                    {text('plant_type', 'Branch Type', { tour: 'org-plant-type', req: true, keepEmpty: true, basis: 200, max: 280 })}
                    <F label="Branch Status" req basis={180} max={240}>
                      <Select data-tour="org-plant-status" style={sheetInput} value={form.status || 'active'} onChange={(e) => setField('status', e.target.value)}>
                        {Object.entries(PLANT_STATUS_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                      </Select>
                    </F>
                    {text('industry_function', 'Industry / Function', { tour: 'org-plant-industry', basis: 240, max: 340 })}
                  </div>
                </SheetSection>
                <SheetSection icon="users" title="People">
                  <div style={{ ...rowStyle, marginBottom: 0 }}>
                    {userSelect('head_user_id', 'Branch Head', 'org-plant-head')}
                    {userSelect('manager_user_id', 'Branch Manager', 'org-plant-manager')}
                  </div>
                </SheetSection>
                <SheetSection icon="calendar" title="Dates">
                  <div style={{ ...rowStyle, marginBottom: 0 }}>
                    {date('established_date', 'Established Date', 'org-plant-established-date')}
                    {date('active_from', 'Active From', 'org-plant-active-from')}
                  </div>
                </SheetSection>
                <SheetSection icon="chat" title="Notes">
                  <label style={sheetLabel}>Description</label>
                  <textarea data-tour="org-plant-description" style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={form.description || ''} onChange={(e) => setField('description', e.target.value || null)} />
                  <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks</label>
                  <textarea data-tour="org-plant-remarks" style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={form.remarks || ''} onChange={(e) => setField('remarks', e.target.value || null)} />
                </SheetSection>
              </>
            )}

            {tab === 'Address' && <AddressesEditor branchId={plantId} addresses={addresses} onRefresh={loadLists} />}

            {tab === 'Operational Configuration' && (
              <>
                <SheetSection icon="clock" title="Working Time">
                  <div style={{ ...rowStyle, marginBottom: 0 }}>
                    {text('working_calendar', 'Working Calendar', { tour: 'org-plant-op-calendar', req: true, basis: 220, max: 300 })}
                    {text('working_days', 'Working Days', { tour: 'org-plant-op-working-days', ph: 'Mon–Fri', basis: 160, max: 220 })}
                    {text('working_hours', 'Working Hours', { tour: 'org-plant-op-working-hours', ph: '09:00–18:00', basis: 160, max: 220 })}
                    {text('timezone', 'Time Zone', { tour: 'org-plant-op-timezone', ph: 'Asia/Kolkata', basis: 170, max: 240 })}
                  </div>
                </SheetSection>
                <SheetSection icon="gear" title="Defaults">
                  <div style={rowStyle}>
                    <F label="Default Store" basis={240} max={340}>
                      <Select data-tour="org-plant-op-default-store" style={sheetInput} value={form.default_warehouse_id || ''} onChange={(e) => setField('default_warehouse_id', e.target.value ? Number(e.target.value) : null)}>
                        <option value="">— Select —</option>
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </Select>
                    </F>
                    <F label="Default Cost Center" basis={240} max={340}>
                      <Select data-tour="org-plant-op-default-cc" style={sheetInput} value={form.default_cost_center_id || ''} onChange={(e) => setField('default_cost_center_id', e.target.value ? Number(e.target.value) : null)}>
                        <option value="">— Select —</option>
                        {costCenters.map((cc) => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
                      </Select>
                    </F>
                  </div>
                  <div style={{ ...rowStyle, marginBottom: 0 }}>
                    {text('default_profit_center', 'Default Profit Center', { tour: 'org-plant-op-profit-center', basis: 220, max: 320 })}
                    {text('currency', 'Currency', { tour: 'org-plant-op-currency', ph: 'INR', basis: 120, max: 160 })}
                  </div>
                  <p style={sheetHint}>Stores and cost centers are managed from their own tabs on this page, then chosen as defaults here.</p>
                </SheetSection>
                <SheetSection icon="rupee" title="GST">
                  <div style={{ ...rowStyle, marginBottom: 0 }}>
                    <F label="Plant GSTIN" basis={200} max={260}>
                      <input style={sheetInput} value={form.gstin || ''} maxLength={15} onChange={(e) => setField('gstin', e.target.value.toUpperCase() || null)} placeholder="06AAACP1234C1Z5" />
                    </F>
                    <F label="GST State Code" basis={200} max={240}>
                      <input style={sheetInput} value={form.state_code || ''} maxLength={2} onChange={(e) => setField('state_code', e.target.value || null)} placeholder="From the GSTIN, e.g. 06" />
                    </F>
                  </div>
                  <p style={sheetHint}>Plants under different GSTINs are distinct persons under GST: a stock transfer between them goes on a tax invoice, and an e-way bill is needed when the state differs.</p>
                </SheetSection>
              </>
            )}

            {tab === 'Branch Users' && editUsers && <UserAssignmentsEditor branchId={plantId} assignments={assignments} directory={directory} departments={departments} onRefresh={loadLists} />}

            {tab === 'Branch Departments' && (
              <div data-tour="org-plant-edit-depts">
                <SheetSection icon="users" title="Branch Departments">
                  <p style={{ ...sheetHint, margin: '0 0 12px' }}>Departments are created and edited from Organization &gt; Department (assign a department to this branch there). This list is read-only.</p>
                  {departments.length === 0 ? (
                    <p style={{ fontSize: 13, color: MUTED }}>No departments under this branch yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {departments.map((d) => (
                        <div key={d.id} style={listRowStyle}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{d.name}</span>
                          <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>{[d.code, d.head_user_name].filter(Boolean).join(' · ') || '—'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </SheetSection>
              </div>
            )}

            {tab === 'Branch Stores' && <WarehousesEditor branchId={plantId} warehouses={warehouses} directory={directory} onRefresh={loadLists} />}

            {tab === 'Branch Cost Centers' && <CostCentersEditor branchId={plantId} costCenters={costCenters} directory={directory} departments={departments} onRefresh={loadLists} />}

            {tab === 'Branch Documents' && seeDocs && <DocumentsEditor branchId={plantId} documents={documents} onRefresh={loadLists} />}
          </div>
        </>
      )}
    </FormPage>
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
  const set = (k: keyof ReturnType<typeof emptyAddress>, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  const startEdit = (a: BranchAddress) => {
    setEditingId(a.id)
    setError('')
    setForm({
      address_type: a.address_type || '', address_line1: a.address_line1, address_line2: a.address_line2 || '',
      landmark: a.landmark || '', country: a.country || '', state: a.state || '', city: a.city || '',
      district: a.district || '', pincode: a.pincode || '', is_primary: a.is_primary, is_active: a.is_active,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyAddress()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.address_line1.trim()) { setError('Address Line 1 is required — enter the building / street.'); return }
    setSaving(true)
    setError('')
    try {
      if (editingId) await organizationApi.updateBranchAddress(branchId, editingId, form)
      else await organizationApi.createBranchAddress(branchId, form)
      cancel()
      onRefresh()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not save the address. Check the fields and try again.').join(' '))
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
    <SheetSection icon="building" title="Addresses">
      <ConfirmDialog open={!!deleteTarget} title="Delete this address?" message={`Delete the "${deleteTarget?.address_type || 'address'}" record? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={subFormStyle}>
        <SubFormHead title={editingId ? 'Edit Address' : 'Add Address'} editing={!!editingId} onCancel={cancel} />
        <SheetError error={error} />
        <div style={rowStyle}>
          <F label="Address Type" req basis={220} max={320}><input data-tour="org-plant-addr-type" style={sheetInput} value={form.address_type} onChange={(e) => set('address_type', e.target.value)} placeholder="Main Plant" /></F>
          <F label="Landmark" basis={220}><input data-tour="org-plant-addr-landmark" style={sheetInput} value={form.landmark} onChange={(e) => set('landmark', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Address Line 1" req basis={400}><input data-tour="org-plant-addr-line1" style={sheetInput} value={form.address_line1} onChange={(e) => set('address_line1', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Address Line 2" basis={400}><input data-tour="org-plant-addr-line2" style={sheetInput} value={form.address_line2} onChange={(e) => set('address_line2', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Country" req basis={160} max={220}><input data-tour="org-plant-addr-country" style={sheetInput} value={form.country} onChange={(e) => set('country', e.target.value)} /></F>
          <F label="State / UT" req basis={160} max={220}><input data-tour="org-plant-addr-state" style={sheetInput} value={form.state} onChange={(e) => set('state', e.target.value)} /></F>
          <F label="City" req basis={160} max={220}><input data-tour="org-plant-addr-city" style={sheetInput} value={form.city} onChange={(e) => set('city', e.target.value)} /></F>
          <F label="District" basis={160} max={220}><input data-tour="org-plant-addr-district" style={sheetInput} value={form.district} onChange={(e) => set('district', e.target.value)} /></F>
          <F label="PIN Code" req basis={110} max={140}><input data-tour="org-plant-addr-pincode" style={sheetInput} value={form.pincode} onChange={(e) => set('pincode', e.target.value)} /></F>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div data-tour="org-plant-addr-flags" style={{ display: 'flex', gap: 16 }}>
            <label style={checkStyle}><input type="checkbox" checked={form.is_primary} onChange={(e) => set('is_primary', e.target.checked)} /> Primary Address</label>
            <label style={checkStyle}><input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active</label>
          </div>
          <SaveBtn tour="org-plant-addr-save" saving={saving} label={editingId ? 'Save Changes' : 'Save Address'} />
        </div>
      </form>

      {addresses.length === 0 ? <p style={{ fontSize: 13, color: MUTED }}>No addresses added yet.</p> : (
        <div data-tour="org-plant-addr-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {addresses.map((a) => (
            <div key={a.id} style={listRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{a.address_type || 'Address'}</span>
                    {a.is_primary && <span style={pill('rgba(16,185,129,0.12)', '#047857')}>PRIMARY</span>}
                    {!a.is_active && <span style={pill('rgba(220,38,38,0.1)', '#b91c1c')}>INACTIVE</span>}
                  </div>
                  <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>{[a.address_line1, a.address_line2, a.landmark, a.city, a.district, a.state, a.country, a.pincode].filter(Boolean).join(', ')}</p>
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
    </SheetSection>
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
  const set = (k: keyof ReturnType<typeof emptyAssignment>, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  const startEdit = (a: BranchUserAssignment) => {
    setEditingId(a.id)
    setError('')
    setForm({
      user_id: String(a.user_id), employee_id: a.employee_id || '', department_id: a.department_id ? String(a.department_id) : '',
      designation: a.designation || '', role: a.role || '', access_level: a.access_level || '',
      is_primary_branch: a.is_primary_branch, effective_from: a.effective_from || '', effective_to: a.effective_to || '', status: a.status,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyAssignment()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.user_id) { setError('User is required — pick the person in the User field.'); return }
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
      setError(extractErrorMessages(err, 'Could not save the branch user. Check the fields (Effective To must be after Effective From) and try again.').join(' '))
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
    <SheetSection icon="users" title="Branch Users">
      <ConfirmDialog open={!!deleteTarget} title="Remove this branch user?" message={`Remove "${deleteTarget?.user_name}" from this branch? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={subFormStyle}>
        <SubFormHead title={editingId ? 'Edit Branch User' : 'Add Branch User'} editing={!!editingId} onCancel={cancel} />
        <SheetError error={error} />
        <div style={rowStyle}>
          <F label="User" req basis={240} max={340}>
            <Select data-tour="org-plant-user-user" style={sheetInput} value={form.user_id} onChange={(e) => set('user_id', e.target.value)}>
              <option value="">— Select —</option>
              {directory.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </F>
          <F label="Employee ID" basis={140} max={200}><input data-tour="org-plant-user-empid" style={sheetInput} value={form.employee_id} onChange={(e) => set('employee_id', e.target.value)} /></F>
          <F label="Department" basis={220} max={300}>
            <Select data-tour="org-plant-user-dept" style={sheetInput} value={form.department_id} onChange={(e) => set('department_id', e.target.value)}>
              <option value="">— Select —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Designation" basis={200} max={280}><input data-tour="org-plant-user-designation" style={sheetInput} value={form.designation} onChange={(e) => set('designation', e.target.value)} /></F>
          <F label="Role" basis={200} max={280}><input data-tour="org-plant-user-role" style={sheetInput} value={form.role} onChange={(e) => set('role', e.target.value)} /></F>
          <F label="Access Level" basis={140} max={180}>
            <Select data-tour="org-plant-user-access" style={sheetInput} value={form.access_level} onChange={(e) => set('access_level', e.target.value)}>
              <option value="">— Select —</option>
              <option value="view">View</option>
              <option value="edit">Edit</option>
              <option value="admin">Admin</option>
            </Select>
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Effective From" basis={170} max={220}><div data-tour="org-plant-user-from"><DateField value={form.effective_from} onChange={(v) => set('effective_from', v)} /></div></F>
          <F label="Effective To" basis={170} max={220}><div data-tour="org-plant-user-to"><DateField value={form.effective_to} onChange={(v) => set('effective_to', v)} /></div></F>
          <F label="Status" basis={130} max={170}>
            <Select data-tour="org-plant-user-status" style={sheetInput} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </F>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div data-tour="org-plant-user-primary">
            <label style={checkStyle}><input type="checkbox" checked={form.is_primary_branch} onChange={(e) => set('is_primary_branch', e.target.checked)} /> Primary Branch for this user</label>
          </div>
          <SaveBtn tour="org-plant-user-save" saving={saving} label={editingId ? 'Save Changes' : 'Save Branch User'} />
        </div>
      </form>

      {assignments.length === 0 ? <p style={{ fontSize: 13, color: MUTED }}>No users assigned yet.</p> : (
        <div data-tour="org-plant-user-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {assignments.map((a) => (
            <div key={a.id} style={listRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{a.user_name || `User #${a.user_id}`}</span>
                    {a.role && <span style={pill('#eff6ff', BLUE)}>{a.role}</span>}
                    {a.is_primary_branch && <span style={pill('rgba(16,185,129,0.12)', '#047857')}>PRIMARY</span>}
                  </div>
                  <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>{[a.designation, a.department_name, a.access_level, a.employee_id].filter(Boolean).join(' · ') || '—'}</p>
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
    </SheetSection>
  )
}

// ---------------------------------------------------------------------------
// Branch Stores
// ---------------------------------------------------------------------------

function emptyWarehouse() {
  return { name: '', code: '', warehouse_type: '', manager_user_id: '', address: '', storage_type: '', inventory_type: '', operating_hours: '', status: 'active' }
}

function WarehousesEditor({ branchId, warehouses, directory, onRefresh }: { branchId: number; warehouses: StoreLocation[]; directory: DirectoryUser[]; onRefresh: () => void }) {
  // Stores are Store-module records — the server checks Store › Stores (store:warehouses) permissions, not Branches.
  const { can } = useCan()
  const canCreate = can('store', 'warehouses', 'create')
  const canEdit = can('store', 'warehouses', 'edit')
  const canDelete = can('store', 'warehouses', 'view')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyWarehouse())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<StoreLocation | null>(null)
  const set = (k: keyof ReturnType<typeof emptyWarehouse>, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const startEdit = (w: StoreLocation) => {
    setEditingId(w.id)
    setError('')
    setForm({
      name: w.name, code: w.code, warehouse_type: w.warehouse_type || '', manager_user_id: w.manager_user_id ? String(w.manager_user_id) : '',
      address: w.address || '', storage_type: w.storage_type || '', inventory_type: w.inventory_type || '', operating_hours: w.operating_hours || '', status: w.status,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyWarehouse()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.code.trim()) { setError('Store Name and Code are required — e.g. Main Raw Material Store, RM-U3.'); return }
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, manager_user_id: form.manager_user_id ? Number(form.manager_user_id) : null }
      if (editingId) await storeApi.updateLocation(editingId, payload)
      else await storeApi.createLocation({ ...payload, branch_id: branchId })
      cancel()
      onRefresh()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not save the store. Check the fields (the code must be unique) and try again.').join(' '))
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
      setError(extractErrorMessages(err, 'Could not delete the store — it may still hold stock or be used on documents.').join(' '))
      setDeleteTarget(null)
    }
  }

  const showForm = editingId ? canEdit : canCreate

  return (
    <SheetSection icon="box" title="Branch Stores">
      <ConfirmDialog open={!!deleteTarget} title="Delete this store?" message={`Delete "${deleteTarget?.name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      {!showForm && <SheetError error={error} />}
      {showForm ? (
        <form onSubmit={submit} style={subFormStyle}>
          <SubFormHead title={editingId ? 'Edit Store' : 'Add Store'} editing={!!editingId} onCancel={cancel} />
          <SheetError error={error} />
          <div style={rowStyle}>
            <F label="Store Name" req basis={240} max={340}><input data-tour="org-plant-store-name" style={sheetInput} value={form.name} onChange={(e) => set('name', e.target.value)} /></F>
            <F label="Store Code" req basis={140} max={200}><input data-tour="org-plant-store-code" style={sheetInput} value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} /></F>
            <F label="Store Type" req basis={180} max={260}><input data-tour="org-plant-store-type" style={sheetInput} value={form.warehouse_type} onChange={(e) => set('warehouse_type', e.target.value)} placeholder="Raw Material" /></F>
            <F label="Store Manager" basis={220} max={300}>
              <Select data-tour="org-plant-store-manager" style={sheetInput} value={form.manager_user_id} onChange={(e) => set('manager_user_id', e.target.value)}>
                <option value="">— Select —</option>
                {directory.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </F>
          </div>
          <div style={rowStyle}>
            <F label="Address" basis={400}><input data-tour="org-plant-store-address" style={sheetInput} value={form.address} onChange={(e) => set('address', e.target.value)} /></F>
          </div>
          <div style={rowStyle}>
            <F label="Storage Type" basis={180} max={260}><input data-tour="org-plant-store-storage-type" style={sheetInput} value={form.storage_type} onChange={(e) => set('storage_type', e.target.value)} /></F>
            <F label="Inventory Type" basis={180} max={260}><input data-tour="org-plant-store-inventory-type" style={sheetInput} value={form.inventory_type} onChange={(e) => set('inventory_type', e.target.value)} /></F>
            <F label="Operating Hours" basis={160} max={220}><input data-tour="org-plant-store-hours" style={sheetInput} value={form.operating_hours} onChange={(e) => set('operating_hours', e.target.value)} placeholder="09:00–18:00" /></F>
            <F label="Status" req basis={170} max={220}>
              <Select data-tour="org-plant-store-status" style={sheetInput} value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="under_maintenance">Under Maintenance</option>
              </Select>
            </F>
          </div>
          <SaveBtn tour="org-plant-store-save" saving={saving} label={editingId ? 'Save Changes' : 'Save Store'} />
        </form>
      ) : (
        <p style={{ ...sheetHint, margin: '0 0 12px' }}>You can see this branch&apos;s stores but not add or change them — that needs Create/Edit on Store › Stores. Ask an admin to add it to one of your roles in Organization › Role &amp; Permissions.</p>
      )}

      {warehouses.length === 0 ? <p style={{ fontSize: 13, color: MUTED }}>No stores added yet.</p> : (
        <div data-tour="org-plant-store-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {warehouses.map((w) => (
            <div key={w.id} style={listRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{w.name}</span>
                  <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>{[w.code, w.warehouse_type, w.manager_user_name, w.status].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  {canEdit && <button type="button" style={linkBtnStyle} onClick={() => startEdit(w)}>Edit</button>}
                  {canDelete && <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(w)}>Delete</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SheetSection>
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
  const set = (k: keyof ReturnType<typeof emptyCostCenter>, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const startEdit = (cc: CostCenter) => {
    setEditingId(cc.id)
    setError('')
    setForm({
      code: cc.code, name: cc.name, cost_center_type: cc.cost_center_type || '', department_id: cc.department_id ? String(cc.department_id) : '',
      head_user_id: cc.head_user_id ? String(cc.head_user_id) : '', parent_cost_center_id: cc.parent_cost_center_id ? String(cc.parent_cost_center_id) : '',
      effective_from: cc.effective_from || '', effective_to: cc.effective_to || '', status: cc.status,
    })
  }
  const cancel = () => { setEditingId(null); setForm(emptyCostCenter()) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.code.trim() || !form.name.trim()) { setError('Cost Center Code and Name are required — e.g. CC-U3-MACH, Machine Shop.'); return }
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
      setError(extractErrorMessages(err, 'Could not save the cost center. Check the fields (the code must be unique) and try again.').join(' '))
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
      setError(extractErrorMessages(err, 'Could not delete the cost center — it may still be used on documents or as a parent.').join(' '))
      setDeleteTarget(null)
    }
  }

  return (
    <SheetSection icon="rupee" title="Branch Cost Centers">
      <ConfirmDialog open={!!deleteTarget} title="Delete this cost center?" message={`Delete "${deleteTarget?.name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      <form onSubmit={submit} style={subFormStyle}>
        <SubFormHead title={editingId ? 'Edit Cost Center' : 'Add Cost Center'} editing={!!editingId} onCancel={cancel} />
        <SheetError error={error} />
        <div style={rowStyle}>
          <F label="Cost Center Code" req basis={160} max={220}><input data-tour="org-plant-cc-code" style={sheetInput} value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} /></F>
          <F label="Cost Center Name" req basis={240} max={340}><input data-tour="org-plant-cc-name" style={sheetInput} value={form.name} onChange={(e) => set('name', e.target.value)} /></F>
          <F label="Cost Center Type" basis={180} max={260}><input data-tour="org-plant-cc-type" style={sheetInput} value={form.cost_center_type} onChange={(e) => set('cost_center_type', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Department" basis={220} max={300}>
            <Select data-tour="org-plant-cc-dept" style={sheetInput} value={form.department_id} onChange={(e) => set('department_id', e.target.value)}>
              <option value="">— Select —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </F>
          <F label="Cost Center Head" basis={220} max={300}>
            <Select data-tour="org-plant-cc-head" style={sheetInput} value={form.head_user_id} onChange={(e) => set('head_user_id', e.target.value)}>
              <option value="">— Select —</option>
              {directory.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </F>
          <F label="Parent Cost Center" basis={220} max={300}>
            <Select data-tour="org-plant-cc-parent" style={sheetInput} value={form.parent_cost_center_id} onChange={(e) => set('parent_cost_center_id', e.target.value)}>
              <option value="">— None —</option>
              {costCenters.filter((cc) => cc.id !== editingId).map((cc) => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
            </Select>
          </F>
        </div>
        <div style={rowStyle}>
          <F label="Effective From" basis={170} max={220}><div data-tour="org-plant-cc-from"><DateField value={form.effective_from} onChange={(v) => set('effective_from', v)} /></div></F>
          <F label="Effective To" basis={170} max={220}><div data-tour="org-plant-cc-to"><DateField value={form.effective_to} onChange={(v) => set('effective_to', v)} /></div></F>
          <F label="Status" basis={130} max={170}>
            <Select data-tour="org-plant-cc-status" style={sheetInput} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </F>
        </div>
        <SaveBtn tour="org-plant-cc-save" saving={saving} label={editingId ? 'Save Changes' : 'Save Cost Center'} />
      </form>

      {costCenters.length === 0 ? <p style={{ fontSize: 13, color: MUTED }}>No cost centers added yet.</p> : (
        <div data-tour="org-plant-cc-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {costCenters.map((cc) => (
            <div key={cc.id} style={listRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{cc.name}</span>
                  <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>{[cc.code, cc.cost_center_type, cc.department_name, cc.head_user_name].filter(Boolean).join(' · ') || '—'}</p>
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
    </SheetSection>
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
  const { canFeature } = useCan()
  const mayUpload = canFeature('organization', 'branches', 'documents', 'create')
  const mayDelete = canFeature('organization', 'branches', 'documents', 'delete')
  const mayOpen = canFeature('organization', 'branches', 'documents', 'export')
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState(emptyDocumentMeta())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BranchDocument | null>(null)
  const set = (k: keyof ReturnType<typeof emptyDocumentMeta>, v: string) => setMeta((m) => ({ ...m, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) { setError('Select a file to upload — click the Document File box.'); return }
    if (!meta.document_name.trim()) { setError('Document Name is required — e.g. Factory Licence.'); return }
    setSaving(true)
    setError('')
    try {
      await organizationApi.uploadBranchDocument(branchId, file, meta)
      setFile(null)
      setMeta(emptyDocumentMeta())
      onRefresh()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not upload the document. Check the file and try again; if it keeps failing, SharePoint may be unreachable — contact IT.').join(' '))
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
    <SheetSection icon="clip" title="Branch Documents">
      <ConfirmDialog open={!!deleteTarget} title="Delete this document?" message={`Delete "${deleteTarget?.document_name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      {mayUpload && <form onSubmit={submit} style={subFormStyle}>
        <SubFormHead title="Add Branch Document" editing={false} onCancel={() => undefined} />
        <SheetError error={error} />
        <div data-tour="org-plant-doc-file" style={{ marginBottom: 14 }}>
          <label style={sheetLabel}>Document File <Req /></label>
          <FileUploadField file={file} onChange={setFile} onRemove={() => setFile(null)} uploading={saving} />
        </div>
        <div style={rowStyle}>
          <F label="Document Type" req basis={170} max={220}>
            <Select data-tour="org-plant-doc-type" style={sheetInput} value={meta.document_type} onChange={(e) => set('document_type', e.target.value)}>
              {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </F>
          <F label="Document Name" req basis={260} max={360}><input data-tour="org-plant-doc-name" style={sheetInput} value={meta.document_name} onChange={(e) => set('document_name', e.target.value)} /></F>
          <F label="Document Number" basis={180} max={260}><input data-tour="org-plant-doc-number" style={sheetInput} value={meta.document_number} onChange={(e) => set('document_number', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Issue Date" basis={170} max={220}><div data-tour="org-plant-doc-issue"><DateField value={meta.issue_date} onChange={(v) => set('issue_date', v)} /></div></F>
          <F label="Expiry Date" basis={170} max={220}><div data-tour="org-plant-doc-expiry"><DateField value={meta.expiry_date} onChange={(v) => set('expiry_date', v)} /></div></F>
          <F label="Issuing Authority" basis={220} max={320}><input data-tour="org-plant-doc-authority" style={sheetInput} value={meta.issuing_authority} onChange={(e) => set('issuing_authority', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Version" basis={100} max={140}><input data-tour="org-plant-doc-version" style={sheetInput} value={meta.version} onChange={(e) => set('version', e.target.value)} /></F>
          <F label="Status" basis={140} max={200}><input data-tour="org-plant-doc-status" style={sheetInput} value={meta.status} onChange={(e) => set('status', e.target.value)} placeholder="Active" /></F>
          <F label="Confidentiality" basis={150} max={200}>
            <Select data-tour="org-plant-doc-confidentiality" style={sheetInput} value={meta.confidentiality} onChange={(e) => set('confidentiality', e.target.value)}>
              {CONFIDENTIALITY_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </F>
          <F label="Tags (comma separated)" basis={220}><input data-tour="org-plant-doc-tags" style={sheetInput} value={meta.tags} onChange={(e) => set('tags', e.target.value)} /></F>
        </div>
        <div style={rowStyle}>
          <F label="Remarks" basis={400}><input data-tour="org-plant-doc-remarks" style={sheetInput} value={meta.remarks} onChange={(e) => set('remarks', e.target.value)} /></F>
        </div>
        <SaveBtn tour="org-plant-doc-save" saving={saving} label="Save Document" busyLabel="Uploading…" />
      </form>}

      {documents.length === 0 ? <p style={{ fontSize: 13, color: MUTED }}>No documents uploaded yet.</p> : (
        <div data-tour="org-plant-doc-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {documents.map((d) => (
            <div key={d.id} style={listRowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{d.document_name}</span>
                    <span style={pill('#eff6ff', BLUE)}>{d.document_type}</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>{d.filename}{d.expiry_date ? ` · Expires ${formatDate(d.expiry_date)}` : ''}{d.version ? ` · v${d.version}` : ''}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  {d.sharepoint_url && mayOpen && <a href={d.sharepoint_url} target="_blank" rel="noreferrer" style={linkBtnStyle}>Open</a>}
                  {mayDelete && <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(d)}>Delete</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SheetSection>
  )
}
