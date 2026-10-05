'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreLocation, StoreStockReservation } from '@/types'
import { TEXT, BRAND, SUCCESS, DANGER, GLASS, SHADOWS } from '@/lib/theme'
import { Field, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { active: 'Active', fulfilled: 'Fulfilled', cancelled: 'Cancelled' }
const STATUS_COLORS: Record<string, string> = { active: BRAND.primaryActive, fulfilled: SUCCESS.primary, cancelled: TEXT.muted }

export default function StoreStockReservationsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
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
      const [r, i, l] = await Promise.all([storeApi.listStockReservations(), storeApi.listItems(), storeApi.listLocations()])
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
  }, [isAuthorized])

  const openModal = () => {
    setItemId('')
    setLocationId('')
    setQuantity('')
    setProject('')
    setProductionOrder('')
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Stock Reservations</h1>
        </div>
        <button data-tour="res-add-btn" onClick={openModal} style={primaryBtnStyle}>
          <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> New Reservation
        </button>
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
        <div onClick={() => !saving && setShowModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, maxWidth: 460, width: '100%', padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0', color: TEXT.heading }}>New Reservation</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Item *">
                <select data-tour="res-item" style={inputStyle} value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">— Select —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.item_code} — {i.item_name}</option>)}
                </select>
              </Field>
              <Field label="Store *">
                <select data-tour="res-location" style={inputStyle} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">— Select —</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
              <Field label="Quantity *">
                <input data-tour="res-quantity" type="number" style={inputStyle} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
              <Field label="Project">
                <input style={inputStyle} value={project} onChange={(e) => setProject(e.target.value)} />
              </Field>
              <Field label="Production Order">
                <input style={inputStyle} value={productionOrder} onChange={(e) => setProductionOrder(e.target.value)} />
              </Field>
              <Field label="Required Date">
                <input data-tour="res-required-date" type="date" style={inputStyle} value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} />
              </Field>
              <Field label="Remarks">
                <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </Field>
            </div>

            {formErrors.length > 0 && (
              <div style={{ padding: '10px 14px', marginTop: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {formErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={() => setShowModal(false)} disabled={saving} style={secondaryBtnStyle}>Cancel</button>
              <button data-tour="res-save-btn" onClick={handleCreate} disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : 'Reserve Stock'}</button>
            </div>
          </div>
        </div>
      )}

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
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{[r.project, r.production_order].filter(Boolean).join(' / ') || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{r.required_date || '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_COLORS[r.status]}1a`, color: STATUS_COLORS[r.status] }}>
                    {STATUS_LABELS[r.status] || r.status}
                  </span>
                </td>
                <td style={{ padding: '12px 16px', display: 'flex', gap: 10 }}>
                  {r.status === 'active' && (
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
