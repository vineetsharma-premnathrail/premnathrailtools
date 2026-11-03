'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItem, StoreLocation, StoreStockBalance, StoreStockReservation } from '@/types'
import { CONTROL, TEXT, SUCCESS, DANGER, INFO, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle, segmentBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import OrderProjectPicker, { OrderProjectChip, OrderProjectValue } from '@/components/sales/ProjectUnitPicker'
import { recordPath } from '@/lib/recordRef'
import Select from '@/components/shared/Select'
import { formatDate } from '@/lib/format'
import { itemOptionDetail } from '@/lib/itemOptions'

const STATUS_LABELS: Record<string, string> = { active: 'Active', fulfilled: 'Fulfilled', cancelled: 'Cancelled' }
const STATUS_COLORS: Record<string, string> = { active: INFO.primary, fulfilled: SUCCESS.primary, cancelled: TEXT.muted }

type Line = { itemId: string; quantity: string; remarks: string }
const emptyLine = (): Line => ({ itemId: '', quantity: '', remarks: '' })
const smallBtn = (): React.CSSProperties => ({ ...sheetBtn('secondary', SHEET.INK), padding: '6px 12px', minHeight: 30, fontSize: 12 })

export default function StoreStockReservationsPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { can } = useCan()
  const router = useRouter()
  // List filter: all / project stock only / one Project (vehicle / lot).
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
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [locationId, setLocationId] = useState('')
  const [project, setProject] = useState('')
  const [productionOrder, setProductionOrder] = useState('')
  const [requiredDate, setRequiredDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const draft = useFormDraft(showModal ? 'store-reservation-new-lines' : null, { lines, locationId, project, productionOrder, orderProject, requiredDate, remarks }, (d) => {
    setLines(d.lines?.length ? d.lines : [emptyLine()]); setLocationId(d.locationId ?? ''); setProject(d.project ?? ''); setProductionOrder(d.productionOrder ?? '')
    setOrderProject(d.orderProject ?? null); setRequiredDate(d.requiredDate ?? ''); setRemarks(d.remarks ?? '')
  })

  // Live available stock of the picked store, per item (refreshed every 30 s).
  const [balances, setBalances] = useState<Map<number, { available: number; onHand: number; reserved: number }>>(new Map())
  const [stockError, setStockError] = useState('')
  const [stockLoadedAt, setStockLoadedAt] = useState<Date | null>(null)
  const loadStock = useCallback(() => {
    if (!locationId || !showModal) return
    storeApi.listStockBalances({ location_id: Number(locationId) })
      .then((rows: StoreStockBalance[]) => {
        setBalances(new Map(rows.map((b) => [b.item_id, { available: Number(b.available_qty || 0), onHand: Number(b.on_hand_qty || 0), reserved: Number(b.reserved_qty || 0) }])))
        setStockLoadedAt(new Date())
        setStockError('')
      })
      .catch((err) => setStockError(extractErrorMessages(err, "Could not load the store's stock. Click Refresh stock to try again.").join(' ')))
  }, [locationId, showModal])
  useEffect(() => {
    if (!locationId || !showModal) return
    loadStock()
    const t = setInterval(loadStock, 30000)
    return () => clearInterval(t)
  }, [locationId, showModal, loadStock])

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const itemOptions = useMemo(() => items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}`, description: itemOptionDetail(i) })), [items])
  // Total asked per item across lines (the same item may sit on two lines).
  const demand = useMemo(() => {
    const m = new Map<number, number>()
    for (const l of lines) if (l.itemId && Number(l.quantity) > 0) m.set(Number(l.itemId), (m.get(Number(l.itemId)) || 0) + Number(l.quantity))
    return m
  }, [lines])
  const isShort = (l: Line) => !!locationId && !!stockLoadedAt && !!l.itemId && Number(l.quantity) > 0
    && (demand.get(Number(l.itemId)) || 0) > (balances.get(Number(l.itemId))?.available || 0)

  const updateLine = (idx: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  const removeLine = (idx: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : [emptyLine()]))

  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const importFile = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    setImportErrors([])
    try {
      const res = await storeApi.importReservationLines(file)
      const imported: Line[] = res.lines.map((l) => ({ itemId: String(l.item_id), quantity: String(l.quantity), remarks: l.remarks || '' }))
      setLines((prev) => {
        const all = [...prev.filter((l) => l.itemId || l.quantity), ...imported]
        return all.length ? all : [emptyLine()]
      })
      if (res.errors.length) {
        setImportErrors([
          `${res.lines.length} line(s) were added. ${res.errors.length} row(s) were skipped — fix them in the file and import again, or add them by hand:`,
          ...res.errors.map((e) => `Row ${e.row}${e.item_code ? ` (${e.item_code})` : ''}: ${e.reason}`),
        ])
      }
    } catch (err) {
      setImportErrors(extractErrorMessages(err, 'Could not read the file. Use the downloaded template (.xlsx or .csv) and keep its header row.'))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  const downloadTemplate = async () => {
    try {
      const url = URL.createObjectURL(await storeApi.downloadReservationLinesTemplate())
      const a = document.createElement('a')
      a.href = url
      a.download = 'stock_reservation_lines_template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setImportErrors(extractErrorMessages(err, 'Could not download the template. Reload the page and try again.'))
    }
  }

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
    setLines([emptyLine()])
    setLocationId('')
    setBalances(new Map())
    setStockLoadedAt(null)
    setImportErrors([])
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
    const filled = lines.filter((l) => l.itemId || l.quantity || l.remarks.trim())
    if (!locationId) problems.push('Store is required — pick the store the stock is held in.')
    if (!filled.length) problems.push('Add at least one item line.')
    filled.forEach((l, i) => {
      const code = itemById.get(Number(l.itemId))?.item_code
      if (!l.itemId) problems.push(`Line ${i + 1}: pick the item.`)
      else if (!(Number(l.quantity) > 0)) problems.push(`Line ${i + 1} (${code}): quantity must be greater than zero.`)
      else if (isShort(l)) problems.push(`Line ${i + 1} (${code}): only ${(balances.get(Number(l.itemId))?.available || 0).toLocaleString('en-IN')} available in this store — lower the quantity or remove the line.`)
    })
    if (problems.length) {
      setFormErrors(problems)
      return
    }
    setSaving(true)
    setFormErrors([])
    try {
      await storeApi.createStockReservationsBulk({
        location_id: Number(locationId),
        lines: filled.map((l) => ({ item_id: Number(l.itemId), quantity: Number(l.quantity), remarks: l.remarks.trim() || undefined })),
        project: project.trim() || undefined,
        production_order: productionOrder.trim() || undefined,
        order_project_id: orderProject?.projectId,
        order_project_element_id: orderProject?.elementId ?? undefined,
        required_date: requiredDate || undefined,
        remarks: remarks.trim() || undefined,
      })
      draft.clear()
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
        <FormSheet width={980} icon="flag" title="New Reservation" subtitle="Earmark on-hand stock for a project or production order — it stops being available to others." onClose={() => setShowModal(false)} busy={saving}
          footer={<>
            <button data-tour="res-modal-cancel-btn" type="button" onClick={() => setShowModal(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button data-tour="res-save-btn" type="button" onClick={handleCreate} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : `Reserve Stock${lines.filter((l) => l.itemId).length > 1 ? ` (${lines.filter((l) => l.itemId).length} lines)` : ''}`}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <DraftBanner draft={draft} />
            {formErrors.length > 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {formErrors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <SheetSection icon="building" title="Reserve From">
              <div style={{ maxWidth: 360 }}>
                <label style={sheetLabel}>Store <Req /></label>
                <Select data-tour="res-location" style={sheetInput} value={locationId} onChange={(e) => { setLocationId(e.target.value); setBalances(new Map()); setStockLoadedAt(null) }}>
                  <option value="">— Select —</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
                <p style={sheetHint}>Every line is held in this store.</p>
              </div>
            </SheetSection>

            <SheetSection icon="box" title="Items to Reserve">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
                  {!locationId ? 'Pick the store to see live available stock on each line.'
                    : stockError ? <span style={{ color: '#b91c1c' }}>{stockError}</span>
                    : stockLoadedAt ? <>Live stock of <b>{locations.find((l) => String(l.id) === locationId)?.name}</b> · updated {stockLoadedAt.toLocaleTimeString()}</>
                    : 'Loading stock…'}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {locationId && <button type="button" onClick={loadStock} style={smallBtn()}><SheetIcon name="history" size={14} />Refresh stock</button>}
                  <input ref={fileRef} type="file" hidden accept=".xlsx,.xlsm,.csv" onChange={(e) => importFile(e.target.files?.[0])} />
                  <button type="button" data-tour="res-import-btn" onClick={() => fileRef.current?.click()} disabled={importing} style={smallBtn()}>
                    <SheetIcon name="upload" size={14} />{importing ? 'Reading…' : 'Import from Excel'}
                  </button>
                  <button type="button" onClick={downloadTemplate} style={smallBtn()}><SheetIcon name="doc" size={14} />Download template</button>
                </div>
              </div>
              {importErrors.length > 0 && (
                <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', color: '#92400e', fontSize: 12.5 }}>
                  {importErrors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
              <div style={{ overflowX: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead>
                    <tr>
                      {['#', 'Item', 'Quantity', 'Available', 'Remarks', ''].map((h, hi) => (
                        <th key={hi} style={{ textAlign: 'left', padding: '8px 6px', fontSize: 11, fontWeight: 700, color: SHEET.MUTED, background: SHEET.SOFT, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                          {h}{hi === 1 && <RowCount count={lines.length} />}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => {
                      const item = itemById.get(Number(line.itemId))
                      const bal = balances.get(Number(line.itemId))
                      const short = isShort(line)
                      return (
                        <tr key={idx} style={{ background: short ? 'rgba(220,38,38,0.05)' : undefined, borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                          <td style={{ padding: 6, fontSize: 12, color: TEXT.muted, width: 28 }}>{idx + 1}</td>
                          <td style={{ padding: 6, minWidth: 280 }}>
                            <div {...(idx === 0 ? { 'data-tour': 'res-item' } : {})}>
                              <SearchableSelect value={line.itemId} onChange={(v) => updateLine(idx, { itemId: v })} placeholder="Search item code or name…" options={itemOptions} />
                            </div>
                          </td>
                          <td style={{ padding: 6, width: 120 }}>
                            <input {...(idx === 0 ? { 'data-tour': 'res-quantity' } : {})} type="number" min="0" style={{ ...sheetInput, borderColor: short ? '#dc2626' : undefined }}
                              value={line.quantity} placeholder={item?.uom || ''} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                          </td>
                          <td style={{ padding: 6, width: 170, fontSize: 12.5, lineHeight: 1.35 }}>
                            {!locationId || !line.itemId || !stockLoadedAt ? <span style={{ color: TEXT.muted }}>—</span> : (
                              <>
                                <span style={{ fontWeight: 700, color: short || !(bal?.available) ? '#b91c1c' : '#15803d' }}>
                                  {(bal?.available || 0).toLocaleString('en-IN')} {item?.uom || ''} available
                                </span>
                                {bal && bal.reserved > 0 && <div style={{ color: TEXT.muted, fontSize: 11.5 }}>{bal.onHand.toLocaleString('en-IN')} on hand, {bal.reserved.toLocaleString('en-IN')} already reserved</div>}
                              </>
                            )}
                          </td>
                          <td style={{ padding: 6, minWidth: 140 }}>
                            <input style={sheetInput} value={line.remarks} onChange={(e) => updateLine(idx, { remarks: e.target.value })} />
                          </td>
                          <td style={{ padding: 6, width: 44 }}>
                            <button type="button" title="Remove this line" aria-label="Remove line" onClick={() => removeLine(idx)}
                              style={{ ...sheetBtn('secondary', SHEET.INK), padding: 0, width: CONTROL.height, height: CONTROL.height, justifyContent: 'center' }}><SheetIcon name="trash" size={15} /></button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <button type="button" data-tour="res-add-line" onClick={() => setLines((prev) => [...prev, emptyLine()])}
                style={{ marginTop: 10, border: 'none', background: 'none', padding: '4px 0', color: SHEET.BLUE, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <SheetIcon name="plus" size={14} />Add Item
              </button>
            </SheetSection>
            <SheetSection icon="link" title="Reserved For" extra={<Optional />}>
              <div data-tour="res-order-project" style={{ marginBottom: 14 }}>
                <label style={sheetLabel}>Project — Unit (vehicle / lot)</label>
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
              <p style={{ ...sheetHint, marginTop: 0 }}>Used for every line that has no remarks of its own.</p>
              <textarea style={{ ...sheetInput, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <div data-tour="res-filters" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'inline-flex', gap: 4 }}>
          {([['all', 'All reservations'], ['project', 'Project stock']] as const).map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => { setView(k); if (k === 'all') setFilterProject(null) }}
              style={segmentBtnStyle(view === k)}>{lbl}</button>
          ))}
        </div>
        {view === 'project' && (
          <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
            <OrderProjectPicker value={filterProject} onChange={(v) => setFilterProject(v)} requireElement={false}
              placeholder="Every project — or pick one / a unit" />
          </div>
        )}
      </div>

      <div data-tour="res-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              {['Reservation #', 'Item', 'Store', 'Quantity', 'Project / PO', 'Required Date', 'Status', ''].map((h, hi) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', ...(h === 'Quantity' ? { textAlign: 'right' as const } : {}) }}>{h}{hi === 0 && <RowCount count={reservations.length} />}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && reservations.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>{view === 'project' || filterProject ? 'No project stock reservations match this filter.' : 'No stock reservations yet — use + New Reservation to earmark stock for a project or production order.'}</td></tr>
            )}
            {reservations.map((r, idx) => (
              <tr key={r.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{r.reservation_number}</td>
                <td title={`${r.item_code || ''} — ${r.item_name || ''}`} style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.item_code || '—'} — {r.item_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{r.location_name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{Number(r.quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 })} {r.uom || ''}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>
                  {r.op_number ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      <OrderProjectChip opNumber={r.op_number} elementNo={r.element_no} label={r.element_label}
                        onClick={can('projects', 'all_projects', 'view') ? () => router.push(recordPath('/dashboard/projects', r, 'order_project_id')) : undefined} />
                      {r.source_reference && <span style={{ fontSize: 11.5, color: TEXT.muted }}>Held from {r.source_reference}</span>}
                    </div>
                  ) : ([r.project, r.production_order].filter(Boolean).join(' / ') || '—')}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{r.required_date ? formatDate(r.required_date) : '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <Pill label={STATUS_LABELS[r.status] || r.status} hex={STATUS_COLORS[r.status] || TEXT.muted} />
                </td>
                <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                  {r.status === 'active' && can('store', 'reservations', 'edit') && (
                    <span style={{ display: 'inline-flex', gap: 10 }}>
                      <span {...(idx === 0 ? { 'data-tour': 'res-fulfill-btn' } : {})} onClick={() => setConfirmAction({ id: r.id, type: 'fulfill' })} style={{ color: SUCCESS.primary, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Fulfill</span>
                      <span {...(idx === 0 ? { 'data-tour': 'res-cancel-btn' } : {})} onClick={() => setConfirmAction({ id: r.id, type: 'cancel' })} style={{ color: DANGER.primary, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</span>
                    </span>
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
