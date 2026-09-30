'use client'

import { Fragment, useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi, organizationApi } from '@/lib/api'
import { StoreLocation, StoreBin, Branch } from '@/types'
import { TEXT, BRAND, GLASS, SHADOWS } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const BIN_TYPES = [
  { value: 'rack', label: 'Rack' },
  { value: 'shelf', label: 'Shelf' },
  { value: 'bin', label: 'Bin' },
]

export default function StoreLocationsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
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

  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [bins, setBins] = useState<Record<number, StoreBin[]>>({})
  const [binsLoading, setBinsLoading] = useState<number | null>(null)
  const [newBinCode, setNewBinCode] = useState('')
  const [newBinType, setNewBinType] = useState('rack')
  const [addingBin, setAddingBin] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      // Branches only feed the form's Branch dropdown — a failure there must
      // not hide the warehouse list itself.
      const [l, b] = await Promise.all([storeApi.listLocations(), organizationApi.listBranches().catch(() => [])])
      setLocations(l)
      setBranches(b)
    } catch (err) {
      setLoadError(extractErrorMessages(err, 'Failed to load warehouses.').join(' '))
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
      setFormErrors(extractErrorMessages(err, 'Failed to create warehouse.'))
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
      setDeleteErrors(extractErrorMessages(err, 'Failed to delete warehouse.'))
      setDeleteTarget(null)
    }
  }

  const refreshBins = async (locationId: number) => {
    try {
      const data = await storeApi.listBins(locationId)
      setBins((prev) => ({ ...prev, [locationId]: data }))
    } catch {
      // leave existing list as-is on refresh failure
    }
  }

  const toggleExpand = async (loc: StoreLocation) => {
    if (expandedId === loc.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(loc.id)
    setNewBinCode('')
    if (!bins[loc.id]) {
      setBinsLoading(loc.id)
      try {
        const data = await storeApi.listBins(loc.id)
        setBins((prev) => ({ ...prev, [loc.id]: data }))
      } catch {
        setBins((prev) => ({ ...prev, [loc.id]: [] }))
      } finally {
        setBinsLoading(null)
      }
    }
  }

  const handleAddBin = async (locationId: number) => {
    if (!newBinCode.trim()) return
    setAddingBin(true)
    try {
      await storeApi.createBin({ location_id: locationId, bin_type: newBinType, code: newBinCode.trim() })
      setNewBinCode('')
      await refreshBins(locationId)
    } catch {
      // swallow — bin list simply won't reflect the change
    } finally {
      setAddingBin(false)
    }
  }

  const handleRemoveBin = async (locationId: number, binId: number) => {
    try {
      await storeApi.deleteBin(binId)
      await refreshBins(locationId)
    } catch {
      // swallow — bin list simply won't reflect the change
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Warehouses</h1>
        </div>
        <button data-tour="wh-add-btn" onClick={openModal} style={primaryBtnStyle}>
          <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Add Warehouse
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 20px' }}>
        Click a warehouse to manage its racks, shelves, and bins.
      </p>

      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Warehouses" message={loadError} onClose={() => setLoadError('')} actionLabel="Reload" onAction={() => window.location.reload()} />
      <MessageDialog open={deleteErrors.length > 0} variant="error" title="Cannot Delete Warehouse" message={deleteErrors} onClose={() => setDeleteErrors([])} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this warehouse?"
        message={`This permanently removes "${deleteTarget?.name}". This cannot be undone.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />

      {showModal && (
        <div onClick={() => !saving && setShowModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, maxWidth: 460, width: '100%', padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0', color: TEXT.heading }}>Add Warehouse</h2>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Name *</label>
              <input data-tour="wh-name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Store — Plant 1" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Code *</label>
              <input data-tour="wh-code" style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} placeholder="WH-01" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Branch</label>
              <select data-tour="wh-branch" style={inputStyle} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">— Select —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Warehouse Type</label>
              <input data-tour="wh-type" style={inputStyle} value={warehouseType} onChange={(e) => setWarehouseType(e.target.value)} placeholder="Raw Material, Finished Goods…" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Address</label>
              <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>

            {formErrors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {formErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
              <button data-tour="wh-save-btn" onClick={handleCreate} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Save Warehouse'}</button>
            </div>
          </div>
        </div>
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
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No warehouses yet.</td></tr>
            )}
            {locations.map((loc) => {
              const isOpen = expandedId === loc.id
              const list = bins[loc.id]
              return (
                <Fragment key={loc.id}>
                  <tr onClick={() => toggleExpand(loc)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer', background: isOpen ? 'rgba(255,122,69,0.05)' : undefined }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', color: TEXT.muted, transition: 'transform .15s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      {loc.name}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{loc.code}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{loc.branch_name || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{loc.warehouse_type || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: loc.is_active ? `${BRAND.primary}1a` : 'rgba(100,116,139,0.12)', color: loc.is_active ? BRAND.primaryActive : TEXT.muted }}>
                        {loc.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={{ padding: '0 16px', textAlign: 'right' }}>
                      <span onClick={() => setDeleteTarget(loc)} style={{ color: '#b91c1c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Delete</span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} style={{ padding: '4px 16px 16px 40px', background: 'rgba(0,0,0,0.015)' }} onClick={(e) => e.stopPropagation()}>
                        {binsLoading === loc.id ? (
                          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Loading…</p>
                        ) : !list || list.length === 0 ? (
                          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px 0' }}>No racks, shelves, or bins set up yet.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
                            {list.map((b, i) => (
                              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0', color: TEXT.secondary }}>
                                <span style={{ color: TEXT.muted, fontFamily: 'monospace' }}>{i === list.length - 1 ? '└─' : '├─'}</span>
                                <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(255,122,69,0.14)', color: BRAND.primaryActive, textTransform: 'uppercase' }}>{b.bin_type}</span>
                                <span style={{ fontWeight: 600 }}>{b.code}</span>
                                {b.name && <span style={{ color: TEXT.muted }}>· {b.name}</span>}
                                <span onClick={() => handleRemoveBin(loc.id, b.id)} style={{ color: '#b91c1c', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Remove</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div data-tour="wh-bin-add-row" style={{ display: 'flex', gap: 8, maxWidth: 380 }}>
                          <select style={{ ...inputStyle, fontSize: 12.5, padding: '7px 10px', flex: '0 0 100px' }} value={newBinType} onChange={(e) => setNewBinType(e.target.value)}>
                            {BIN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                          <input
                            style={{ ...inputStyle, fontSize: 12.5, padding: '7px 10px', flex: 1 }}
                            value={newBinCode}
                            onChange={(e) => setNewBinCode(e.target.value)}
                            placeholder="Code — R1, S1-A, B1-A-01…"
                            disabled={addingBin}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddBin(loc.id)}
                          />
                          <button onClick={() => handleAddBin(loc.id)} disabled={addingBin || !newBinCode.trim()} style={{ ...secondaryBtnStyle, padding: '7px 14px', fontSize: 12.5, opacity: addingBin || !newBinCode.trim() ? 0.5 : 1 }}>
                            + Add
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
