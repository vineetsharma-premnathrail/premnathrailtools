'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreLocation, StoreStockReservation } from '@/types'
import { TEXT, SUCCESS, DANGER, INFO, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import OrderProjectPicker, { OrderProjectChip, OrderProjectValue } from '@/components/sales/OrderProjectPicker'
import { recordPath } from '@/lib/recordRef'
import Select from '@/components/shared/Select'

const STATUS_LABELS: Record<string, string> = { active: 'Active', fulfilled: 'Fulfilled', cancelled: 'Cancelled' }
const STATUS_COLORS: Record<string, string> = { active: INFO.primary, fulfilled: SUCCESS.primary, cancelled: TEXT.muted }

export default function StoreStockReservationsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can } = useCan()
  const router = useRouter()
  // List filter: all / project stock only / one Order Project (vehicle / lot).
  const [view, setView] = useState<'all' | 'project'>('all')
  const [filterProject, setFilterProject] = useState<OrderProjectValue | null>(null)
  const [orderProject, setOrderProject] = useState<OrderProjectValue | null>(null)
  const [reservations, setReservations] = useState<StoreStockReservation[]>([])
  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [itemId, setItemId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [project, setProject] = useState('')
  const [productionOrder, setProductionOrder] = useState('')
  const [requiredDate, setRequiredDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<string[]>([])

  const [confirmAction, setConfirmAction] = useState<{ id: number; type: 'cancel' | 'fulfill' } | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const params: Record<string, unknown> = {}
      if (filterProject) {
        params.order_project_id = filterProject.projectId
        if (filterProject.elementId) params.order_project_element_id = filterProject.elementId
      } else if (view === 'project') params.project_stock = true
      const [r, i, l] = await Promise.all([storeApi.listStockReservations(params), storeApi.listItems(), storeApi.listLocations()])
      setReservations(r)
      setItems(i)
      setLocations(l)
    } catch (err) {
      setLoadError(extractErrorMessages(err, 'Failed to load stock reservations.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, view, filterProject])

  const openModal = () => {
    setItemId('')
    setLocationId('')
    setQuantity('')
    setProject('')
    setProductionOrder('')
    setOrderProject(null)
    setRequiredDate('')
    setRemarks('')
    setFormErrors([])
    setShowModal(true)
  }

  const handleCreate = async () => {
    const problems: string[] = []
    if (!itemId) problems.push('Item is required.')
    if (!locationId) problems.push('Store is required.')
    if (!quantity || Number(quantity) <= 0) problems.push('Quantity must be greater than zero.')
    if (problems.length) {
      setFormErrors(problems)
      return
    }
    setSaving(true)
    setFormErrors([])
    try {
      await storeApi.createStockReservation({
        item_id: Number(itemId),
        location_id: Number(locationId),
        quantity: Number(quantity),
        project: project.trim() || undefined,
        production_order: productionOrder.trim() || undefined,
        order_project_id: orderProject?.projectId,
        order_project_element_id: orderProject?.elementId ?? undefined,
        required_date: requiredDate || undefined,
        remarks: remarks.trim() || undefined,
      })
      setShowModal(false)
      load()
    } catch (err) {
      setFormErrors(extractErrorMessages(err, 'Failed to create stock reservation.'))
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmAction = async () => {
    if (!confirmAction) return
    try {
      if (confirmAction.type === 'cancel') await storeApi.cancelStockReservation(confirmAction.id)
      else await storeApi.fulfillStockReservation(confirmAction.id)
      setConfirmAction(null)
      load()
    } catch (err) {
      setConfirmAction(null)
      setActionError(extractErrorMessages(err, 'Failed to update this reservation.').join(' '))
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Stock Reservations</h1>
        </div>
        {can('store', 'reservations', 'create') && (
          <button data-tour="res-add-btn" onClick={openModal} style={primaryBtnStyle}>
            <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> New Reservation
          </button>
        )}
      </div>

      <MessageDialog open={!!loadError} variant="error" title="Failed to Load Stock Reservations" message={loadError} onClose={() => setLoadError('')} actionLabel="Reload" onAction={() => window.location.reload()} />
      <MessageDialog open={!!actionError} variant="error" title="Action Failed" message={actionError} onClose={() => setActionError('')} />
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.type === 'cancel' ? 'Cancel this reservation?' : 'Mark this reservation as fulfilled?'}
        message={
          confirmAction?.type === 'cancel'
            ? 'This releases the reserved quantity back to available stock.'
            : 'This releases the earmark, assuming the material has already been issued separately via a Material Issue. It does not itself reduce stock.'
        }
        confirmLabel={confirmAction?.type === 'cancel' ? 'Cancel Reservation' : 'Mark Fulfilled'}
        danger={confirmAction?.type === 'cancel'}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
      />

      {showModal && (
        <FormSheet width={580} icon="flag" title="New Reservation" subtitle="Earmark on-hand stock for a project or production order — it stops being available to others." onClose={() => setShowModal(false)} busy={saving}
          footer={<>
            <button data-tour="res-modal-cancel-btn" type="button" onClick={() => setShowModal(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button data-tour="res-save-btn" type="button" onClick={handleCreate} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Reserve Stock'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {formErrors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {formErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <SheetSection icon="box" title="Stock to Reserve">
              <label style={sheetLabel}>Item <Req /></label>
              <div data-tour="res-item">
                <SearchableSelect value={itemId} onChange={setItemId} placeholder="— Select —"
                  options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                <div style={{ flex: '1 1 220px' }}>
                  <label style={sheetLabel}>Store <Req /></label>
                  <Select data-tour="res-location" style={sheetInput} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                    <option value="">— Select —</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                </div>
                <div style={{ flex: '0 1 140px', minWidth: 110 }}>
                  <label style={sheetLabel}>Quantity <Req /></label>
                  <input data-tour="res-quantity" type="number" style={sheetInput} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </div>
              </div>
            </SheetSection>
            <SheetSection icon="link" title="Reserved For" extra={<Optional />}>
              <div data-tour="res-order-project" style={{ marginBottom: 14 }}>
                <label style={sheetLabel}>Order project — vehicle / lot</label>
                <OrderProjectPicker value={orderProject} onChange={(v) => setOrderProject(v)}
                  placeholder="Hold this stock for an RRV order's vehicle / lot (project stock)" />
                <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 4 }}>
                  Project stock can only be issued to this vehicle / lot — anyone else needs a Store Manager override with a reason.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>Project (note)</label>
                  <input style={sheetInput} value={project} onChange={(e) => setProject(e.target.value)} />
                </div>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>Production Order</label>
                  <input style={sheetInput} value={productionOrder} onChange={(e) => setProductionOrder(e.target.value)} />
                </div>
              </div>
              <div data-tour="res-required-date" style={{ maxWidth: 200, marginTop: 14 }}>
                <label style={sheetLabel}>Required Date</label>
                <DateField value={requiredDate} onChange={setRequiredDate} />
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks</label>
              <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <div data-tour="res-filters" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'inline-flex', borderRadius: 9999, border: '1px solid rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          {([['all', 'All reservations'], ['project', 'Project stock']] as const).map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => { setView(k); if (k === 'all') setFilterProject(null) }}
              style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: view === k ? INFO.primary : 'transparent', color: view === k ? '#fff' : TEXT.secondary }}>{lbl}</button>
          ))}
        </div>
        {view === 'project' && (
          <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
            <OrderProjectPicker value={filterProject} onChange={(v) => setFilterProject(v)} requireElement={false}
              placeholder="Every Order Project — or pick one / a vehicle" />
          </div>
        )}
      </div>

      <div data-tour="res-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {['Reservation #', 'Item', 'Store', 'Quantity', 'Project / PO', 'Required Date', 'Status', ''].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && reservations.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No stock reservations yet.</td></tr>
            )}
            {reservations.map((r, idx) => (
              <tr key={r.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{r.reservation_number}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{r.item_code} — {r.item_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{r.location_name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{r.quantity} {r.uom}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>
                  {r.op_number ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <OrderProjectChip opNumber={r.op_number} elementNo={r.element_no} label={r.element_label}
                        onClick={can('projects', 'order_projects', 'view') ? () => router.push(recordPath('/dashboard/projects/order-projects', r, 'order_project_id')) : undefined} />
                      {r.source_reference && <span style={{ fontSize: 11.5, color: TEXT.muted }}>Held from {r.source_reference}</span>}
                    </div>
                  ) : ([r.project, r.production_order].filter(Boolean).join(' / ') || '—')}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{r.required_date || '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_COLORS[r.status]}1a`, color: STATUS_COLORS[r.status] }}>
                    {STATUS_LABELS[r.status] || r.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', display: 'flex', gap: 10 }}>
                  {r.status === 'active' && can('store', 'reservations', 'edit') && (
                    <>
                      <span {...(idx === 0 ? { 'data-tour': 'res-fulfill-btn' } : {})} onClick={() => setConfirmAction({ id: r.id, type: 'fulfill' })} style={{ color: SUCCESS.primary, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Fulfill</span>
                      <span {...(idx === 0 ? { 'data-tour': 'res-cancel-btn' } : {})} onClick={() => setConfirmAction({ id: r.id, type: 'cancel' })} style={{ color: DANGER.primary, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
