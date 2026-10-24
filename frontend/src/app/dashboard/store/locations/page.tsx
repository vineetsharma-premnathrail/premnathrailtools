'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi, organizationApi } from '@/lib/api'
import { StoreLocation, Branch } from '@/types'
import { TEXT, GLASS, SHADOWS, SUCCESS } from '@/lib/theme'
import { primaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import StoreSettingsNav from '@/components/store/StoreSettingsNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import Select from '@/components/shared/Select'

export default function StoreLocationsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can, canDelete } = useCan()
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [branchId, setBranchId] = useState('')
  const [warehouseType, setWarehouseType] = useState('')
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<StoreLocation | null>(null)
  const [deleteErrors, setDeleteErrors] = useState<string[]>([])


  const load = async () => {
    setLoading(true)
    try {
      // Branches only feed the form's Branch dropdown — a failure there must
      // not hide the store list itself.
      const [l, b] = await Promise.all([storeApi.listLocations(), organizationApi.listBranches().catch(() => [])])
      setLocations(l)
      setBranches(b)
    } catch (err) {
      setLoadError(extractErrorMessages(err, 'Failed to load stores.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const openModal = () => {
    setName('')
    setCode('')
    setBranchId('')
    setWarehouseType('')
    setAddress('')
    setFormErrors([])
    setShowModal(true)
  }

  const handleCreate = async () => {
    const problems: string[] = []
    if (!name.trim()) problems.push('Name is required.')
    if (!code.trim()) problems.push('Code is required.')
    if (problems.length) {
      setFormErrors(problems)
      return
    }
    setSaving(true)
    setFormErrors([])
    try {
      await storeApi.createLocation({
        name: name.trim(),
        code: code.trim(),
        branch_id: branchId ? Number(branchId) : undefined,
        warehouse_type: warehouseType.trim() || undefined,
        address: address.trim() || undefined,
      })
      setShowModal(false)
      load()
    } catch (err) {
      setFormErrors(extractErrorMessages(err, 'Failed to create store.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await storeApi.deleteLocation(deleteTarget.id)
      setDeleteTarget(null)
      load()
    } catch (err) {
      setDeleteErrors(extractErrorMessages(err, 'Failed to delete store.'))
      setDeleteTarget(null)
    }
  }


  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory · Settings
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Stores</h1>
        </div>
        {can('store', 'warehouses', 'create') && (
          <button data-tour="wh-add-btn" onClick={openModal} style={primaryBtnStyle}>
            <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Add Store
          </button>
        )}
      </div>

      <StoreSettingsNav />

      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Stores" message={loadError} onClose={() => setLoadError('')} actionLabel="Reload" onAction={() => window.location.reload()} />
      <MessageDialog open={deleteErrors.length > 0} variant="error" title="Cannot Delete Store" message={deleteErrors} onClose={() => setDeleteErrors([])} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this store?"
        message={`This permanently removes "${deleteTarget?.name}". This cannot be undone.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />

      {showModal && (
        <FormSheet width={580} icon="building" title="Add Store" subtitle="A physical store / warehouse that holds stock." onClose={() => setShowModal(false)} busy={saving}
          footer={<>
            <button data-tour="wh-cancel-btn" type="button" onClick={() => setShowModal(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button data-tour="wh-save-btn" type="button" onClick={handleCreate} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="plus" size={16} />{saving ? 'Saving…' : 'Save Store'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {formErrors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {formErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <SheetSection icon="list" title="Basic Information">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 260px', minWidth: 220 }}>
                  <label style={sheetLabel}>Name <Req /></label>
                  <input data-tour="wh-name" autoFocus style={sheetInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Store — Plant 1" />
                </div>
                <div style={{ flex: '0 1 140px', minWidth: 120 }}>
                  <label style={sheetLabel}>Code <Req /></label>
                  <input data-tour="wh-code" style={sheetInput} value={code} onChange={(e) => setCode(e.target.value)} placeholder="WH-01" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>Branch</label>
                  <Select data-tour="wh-branch" style={sheetInput} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">— Select —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </div>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>Store Type</label>
                  <input data-tour="wh-type" style={sheetInput} value={warehouseType} onChange={(e) => setWarehouseType(e.target.value)} placeholder="Raw Material, Finished Goods…" />
                </div>
              </div>
            </SheetSection>
            <SheetSection icon="building" title="Address" extra={<Optional />}>
              <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={address} onChange={(e) => setAddress(e.target.value)} />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <div data-tour="wh-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr>
              {['Name', 'Code', 'Branch', 'Type', 'Status', ''].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && locations.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No stores yet.</td></tr>
            )}
            {locations.map((loc) => {
              return (
                <tr key={loc.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {loc.name}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{loc.code}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{loc.branch_name || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{loc.warehouse_type || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: loc.is_active ? `${SUCCESS.primary}1a` : 'rgba(100,116,139,0.12)', color: loc.is_active ? SUCCESS.hover : TEXT.muted }}>
                        {loc.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={{ padding: '0 16px', textAlign: 'right' }}>
                      {canDelete('store', 'warehouses', null) && <span onClick={() => setDeleteTarget(loc)} style={{ color: '#b91c1c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>}
                    </td>
                  </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
