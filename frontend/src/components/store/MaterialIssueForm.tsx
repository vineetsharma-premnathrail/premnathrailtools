'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi, salesApi } from '@/lib/api'
import { StoreItem, StoreLocation, StoreDocType, StoreIssueFormStandard, StoreStockBalance } from '@/types'
import { TEXT } from '@/lib/theme'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import BatchPicker from '@/components/store/BatchPicker'
import BinSerialPicker from '@/components/store/BinSerialPicker'
import { recordPath } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/OrderProjectPicker'
import Select from '@/components/shared/Select'

const inputStyle = sheetInput
const smallBtn = (): React.CSSProperties => ({ ...sheetBtn('secondary', SHEET.INK), padding: '6px 12px', minHeight: 30, fontSize: 12 })

/** Sheet-styled labelled field. */
function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
      <label style={sheetLabel}>{label}</label>
      {children}
    </div>
  )
}

interface DispatchRow {
  schedule_id: number
  so_id: number
  so_number: string
  customer_name?: string | null
  label: string
  description?: string | null
  store_item_id?: number | null
  open_qty: number
  uom?: string | null
}

// binId / serials: WM pick bin and the serial numbers of a serialised item.
interface Line { itemId: string; quantity: string; batchNumber: string; remarks: string; binId?: string; serials?: string[] }
const emptyLine = (): Line => ({ itemId: '', quantity: '', batchNumber: '', remarks: '', binId: '', serials: [] })

// Stock shown on each line is the store's free stock less reservations — the
// same "available" the backend checks when the issue posts. It refreshes when
// the store changes, every 30 s, and on "Refresh stock".
type Avail = { available: number; onHand: number; reserved: number; held: number }
type Val = string | boolean | null
type Option = { id: number; label: string }
// "Against" pick-lists, loaded from /store/material-issues/lookups/<list>.
const LOOKUP_OF: Record<string, string> = {
  department: 'departments', maintenance_work_order: 'maintenance_work_orders', asset: 'assets',
  ncr: 'ncrs', inspection_lot: 'inspection_lots', customer: 'customers', vendor: 'vendors',
  service_request: 'service_requests',
}

// The issue type decides which fields the form shows and which are mandatory
// (backend store/issue_forms.py — the same standard the server validates):
//   required · optional · one_of:<group> (at least one) · if:<field>[=true|false]
const condHolds = (cond: string, vals: Record<string, Val>) => {
  const [f, want] = cond.split('=')
  const v = vals[f]
  return want === undefined ? v !== null && v !== '' && v !== undefined : v === (want === 'true')
}
type LineState = 'none' | 'ok' | 'short' | 'out'

// A job-work challan is a Material Issue of type "job_work", but it is started
// only from Store › Job Work (/store/job-work/new, `challan`): there the type is
// fixed, and the plain Material Issue form doesn't offer Job Work — one way in.
const JOB_WORK = 'job_work'

/** New Material Issue (/store/issues/new) — or, with `challan`, a New Job Work
 *  Challan (/store/job-work/new). */
export default function MaterialIssueForm({ challan = false }: { challan?: boolean }) {
  const { isAuthorized, isLoading, user } = useRequireApp('store')
  const router = useRouter()
  // Store Manager authority: may issue project stock held for another vehicle, with a reason.
  const storeManager = !!user && (user.role === 'admin' || !!user.is_store_manager)
  const [orderProject, setOrderProject] = useState<OrderProjectValue | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const isChallan = challan
  const backHref = isChallan ? '/dashboard/store/job-work' : '/dashboard/store/issues'

  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [issueTypes, setIssueTypes] = useState<StoreDocType[]>([])
  const [issueType, setIssueType] = useState(isChallan ? JOB_WORK : '')

  const [locationId, setLocationId] = useState('')
  const [standard, setStandard] = useState<StoreIssueFormStandard>({})
  const [vals, setVals] = useState<Record<string, Val>>({})
  const [lookups, setLookups] = useState<Record<string, Option[]>>({})
  const [remarks, setRemarks] = useState('')
  const [projects, setProjects] = useState<{ id: number; label: string; third_party_inspection_required: boolean; inspection_agency?: string | null }[]>([])
  const [lines, setLines] = useState<Line[]>([emptyLine()])

  const [balances, setBalances] = useState<Map<number, Avail>>(new Map())
  const [stockLoadedAt, setStockLoadedAt] = useState<Date | null>(null)
  const [stockError, setStockError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listItems().then(setItems).catch(() => setItems([]))
    storeApi.listLocations().then(setLocations).catch(() => setLocations([]))
    storeApi.listDocTypes('issue').then(setIssueTypes).catch(() => setIssueTypes([]))
    storeApi.getIssueFormStandard().then(setStandard).catch(() => setStandard({}))
    storeApi.listDispatchProjects().then(setProjects).catch(() => setProjects([]))
  }, [isAuthorized])

  const loadStock = useCallback(() => {
    if (!locationId) return
    storeApi.listStockBalances({ location_id: Number(locationId) })
      .then((rows: StoreStockBalance[]) => {
        setBalances(new Map(rows.map((b) => [b.item_id, {
          available: Number(b.available_qty || 0), onHand: Number(b.on_hand_qty || 0), reserved: Number(b.reserved_qty || 0),
          held: Number(b.quality_qty || 0) + Number(b.quarantine_qty || 0),
        }])))
        setStockLoadedAt(new Date())
        setStockError('')
      })
      .catch((err) => setStockError(extractErrorMessages(err, 'Could not load the store\'s stock.').join(' ')))
  }, [locationId])

  useEffect(() => {
    if (!locationId) return
    loadStock()
    const t = setInterval(loadStock, 30000)
    return () => clearInterval(t)
  }, [locationId, loadStock])

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  // Finished goods to a customer: Quality checks the final inspection and the
  // contract's third-party certificate before the issue posts (rule 8).
  const isDispatch = issueType === 'dispatch'
  const spec = standard[issueType]
  const setVal = (key: string, v: Val) => setVals((p) => ({ ...p, [key]: v }))
  const selectedProject = projects.find((p) => String(p.id) === String(vals.erp_project_id || ''))
  // Fields of the picked type: "if:" fields appear only once their condition holds.
  const shownFields = (spec?.fields || []).filter((f) => !f.rule.startsWith('if:') || condHolds(f.rule.slice(3), vals))
  // Dispatch against a Sales Order delivery row (spares orders have no machine):
  // the row replaces the machine as what is being dispatched.
  const [soRows, setSoRows] = useState<DispatchRow[]>([])
  const [scheduleId, setScheduleId] = useState('')
  const pickedRow = soRows.find((r) => String(r.schedule_id) === scheduleId)
  useEffect(() => {
    if (!isDispatch) return
    const pid = vals.erp_project_id ? Number(vals.erp_project_id) : undefined
    salesApi.dispatchableRows(pid ? { erp_project_id: pid } : {})
      .then((rows: DispatchRow[]) => setSoRows(rows))
      .catch(() => setSoRows([]))
  }, [isDispatch, vals.erp_project_id])
  const isRequired = (rule: string) => rule === 'required' || rule.startsWith('if:') || (rule === 'unless:sales_order' && !pickedRow)

  // Load the pick-lists the picked type needs (once each).
  useEffect(() => {
    for (const f of spec?.fields || []) {
      const list = LOOKUP_OF[f.kind]
      if (list && !lookups[list]) {
        setLookups((p) => ({ ...p, [list]: [] }))
        storeApi.issueLookups(list).then((rows: Option[]) => setLookups((p) => ({ ...p, [list]: rows }))).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueType, spec])

  const updateLine = (idx: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  const addLine = () => setLines((prev) => [...prev, emptyLine()])
  const removeLine = (idx: number) => setLines((prev) => (prev.length === 1 ? [emptyLine()] : prev.filter((_, i) => i !== idx)))

  // Demand per item across all lines (the same item on two batch lines draws
  // from one available balance).
  const demand = useMemo(() => {
    const m = new Map<number, number>()
    for (const l of lines) if (l.itemId && Number(l.quantity) > 0) m.set(Number(l.itemId), (m.get(Number(l.itemId)) || 0) + Number(l.quantity))
    return m
  }, [lines])

  const lineState = (l: Line): LineState => {
    if (!locationId || !l.itemId || !(Number(l.quantity) > 0)) return 'none'
    const avail = balances.get(Number(l.itemId))?.available || 0
    if (avail <= 0) return 'out'
    return (demand.get(Number(l.itemId)) || 0) - avail > 1e-9 ? 'short' : 'ok'
  }
  const problemLines = lines.filter((l) => ['short', 'out'].includes(lineState(l)))

  const removeUnavailable = () => setLines((prev) => {
    const kept = prev.filter((l) => lineState(l) !== 'out' && lineState(l) !== 'short')
    return kept.length ? kept : [emptyLine()]
  })
  // Cap each item's lines to what is available (first lines first), drop the rest.
  const issueWhatsAvailable = () => setLines((prev) => {
    const left = new Map<number, number>()
    const out: Line[] = []
    for (const l of prev) {
      if (!l.itemId || !(Number(l.quantity) > 0)) { out.push(l); continue }
      const id = Number(l.itemId)
      if (!left.has(id)) left.set(id, balances.get(id)?.available || 0)
      const can = Math.min(Number(l.quantity), left.get(id) || 0)
      if (can > 0) { out.push({ ...l, quantity: String(+can.toFixed(4)) }); left.set(id, (left.get(id) || 0) - can) }
    }
    return out.length ? out : [emptyLine()]
  })

  const importFile = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    try {
      const res = await storeApi.importIssueLines(file)
      const imported: Line[] = res.lines.map((l) => ({ itemId: String(l.item_id), quantity: String(l.quantity), batchNumber: l.batch_number || '', remarks: l.remarks || '' }))
      setLines((prev) => {
        const kept = prev.filter((l) => l.itemId || l.quantity)
        const all = [...kept, ...imported]
        return all.length ? all : [emptyLine()]
      })
      if (res.errors.length) {
        setImportErrors([
          `${res.lines.length} line(s) were added. ${res.errors.length} row(s) were skipped — fix them in the file and import again, or add them by hand:`,
          ...res.errors.map((e) => `Row ${e.row}${e.item_code ? ` (${e.item_code})` : ''}: ${e.reason}`),
        ])
      }
    } catch (err) {
      setImportErrors(extractErrorMessages(err, 'Could not read the file.'))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const downloadTemplate = async () => {
    try {
      const url = URL.createObjectURL(await storeApi.downloadIssueLinesTemplate())
      const a = document.createElement('a')
      a.href = url
      a.download = 'material_issue_lines_template.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setImportErrors(extractErrorMessages(err, 'Could not download the template.'))
    }
  }

  const save = async () => {
    const problems: string[] = []
    if (!locationId) problems.push('Store is required.')
    if (!issueType) problems.push('Issue Type is required.')
    const filled = (k: string) => vals[k] !== null && vals[k] !== undefined && vals[k] !== ''
    for (const f of shownFields) {
      if (isRequired(f.rule) && !filled(f.key)) problems.push(`${f.label} is required for this issue type.`)
    }
    const oneOf = (spec?.fields || []).filter((f) => f.rule.startsWith('one_of:'))
    if (oneOf.length && !oneOf.some((f) => filled(f.key))) problems.push(`Pick what this issue is against — ${oneOf.map((f) => f.label).join(' or ')}.`)
    if (spec?.remarks_label && !remarks.trim()) problems.push(`Remarks are required — ${spec.remarks_label.toLowerCase()}.`)
    const ret = vals.expected_return_date
    if (typeof ret === 'string' && ret && ret < new Date().toLocaleDateString('en-CA')) problems.push('Expected return date cannot be before today (the issue date).')
    const validLines = lines.filter((l) => l.itemId && l.quantity)
    if (!validLines.length) problems.push('At least one item is required.')
    for (const l of validLines) {
      if (Number(l.quantity) <= 0) problems.push(`${itemById.get(Number(l.itemId))?.item_name || 'An item'}: quantity must be greater than zero.`)
    }
    if (problemLines.length) {
      problems.push(`${problemLines.length} line(s) don't have enough stock in this store — remove them or use "Issue only what's available" (the red lines below).`)
    }
    if (problems.length) {
      setErrors(problems)
      return
    }
    setBusy(true)
    setErrors([])
    try {
      const issue = await storeApi.createMaterialIssue({
        location_id: Number(locationId),
        issue_type: issueType,
        // Only the picked type's fields are sent (the server clears the rest).
        ...Object.fromEntries(shownFields.filter((f) => vals[f.key] !== null && vals[f.key] !== undefined && vals[f.key] !== '').map((f) => [
          f.key,
          typeof vals[f.key] === 'boolean' ? vals[f.key]
            : (LOOKUP_OF[f.kind] || f.kind === 'erp_project' || f.kind === 'item') ? Number(vals[f.key])
            : String(vals[f.key]).trim(),
        ])),
        remarks: remarks.trim() || undefined,
        ...(spec?.order_project && orderProject ? { order_project_id: orderProject.projectId, order_project_element_id: orderProject.elementId ?? undefined } : {}),
        ...(overrideReason.trim() ? { project_stock_override_reason: overrideReason.trim() } : {}),
        ...(isDispatch && pickedRow ? { sales_order_id: pickedRow.so_id } : {}),
        items: validLines.map((l) => ({
          ...(isDispatch && pickedRow && (!pickedRow.store_item_id || pickedRow.store_item_id === Number(l.itemId)) ? { sales_schedule_id: pickedRow.schedule_id } : {}),
          item_id: Number(l.itemId),
          quantity: Number(l.quantity),
          batch_number: l.batchNumber.trim() || undefined,
          remarks: l.remarks.trim() || undefined,
          bin_id: l.binId ? Number(l.binId) : undefined,
          serials: l.serials && l.serials.length ? l.serials : undefined,
        })),
      })
      router.push(recordPath('/dashboard/store/issues', issue))
    } catch (err) {
      setErrors(extractErrorMessages(err, 'Failed to create material issue.'))
      loadStock()
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  const filledCount = lines.filter((l) => l.itemId).length

  return (
    <FormPage nav={<StoreNav />} icon={isChallan ? 'truck' : 'box'} title={isChallan ? 'New Job Work Challan' : 'New Material Issue'}
      subtitle={isChallan ? 'Material sent to a job-work vendor — it stays ours, in With-vendor stock, until it comes back.' : 'Stock leaving the store — pick the issue type; its fields follow.'}
      onBack={() => router.push(backHref)} backTour="issue-back-btn"
      footer={<>
        <button type="button" disabled={busy} onClick={() => router.push(backHref)} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button data-tour="issue-save-btn" type="button" disabled={busy} onClick={save} style={sheetBtn('primary', SHEET.BLUE, busy)}>
          <SheetIcon name={isChallan ? 'truck' : 'check'} size={16} />
          {busy ? 'Saving…' : `${isChallan ? 'Create Challan' : 'Issue Material'}${filledCount ? ` (${filledCount} line${filledCount === 1 ? '' : 's'})` : ''}`}
        </button>
      </>}>

      <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Material Issue" message={errors} onClose={() => setErrors([])} />
      <MessageDialog open={importErrors.length > 0} variant="error" title="Excel Import" message={importErrors} onClose={() => setImportErrors([])} />

      <SheetColumns
        left={
      <SheetSection icon="list" title="Issue Details">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
          <Field label={<>Store <Req /></>}>
            <Select data-tour="issue-location" style={inputStyle} value={locationId} onChange={(e) => { setLocationId(e.target.value); setBalances(new Map()); setStockLoadedAt(null) }}>
              <option value="">— Select —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          {!isChallan && (
            <Field label={<>Issue Type <Req /></>}>
              <Select data-tour="issue-type" style={inputStyle} value={issueType} onChange={(e) => { setIssueType(e.target.value); setVals({}); setOrderProject(null) }}>
                <option value="">— Select —</option>
                {issueTypes.filter((t) => t.value !== JOB_WORK).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
          )}
        </div>
        {spec && (
          <div data-tour="issue-type-fields" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 12 }}>
            {shownFields.map((f) => {
              const req = isRequired(f.rule)
              const label = <>{f.label} {req ? <Req /> : f.rule.startsWith('one_of:') ? <span style={{ fontWeight: 400, color: SHEET.MUTED }}>(or the other)</span> : null}</>
              const v = vals[f.key]
              let input: React.ReactNode
              if (f.kind === 'bool') {
                input = (
                  <Select style={inputStyle} value={v === true ? 'yes' : v === false ? 'no' : ''} onChange={(e) => setVal(f.key, e.target.value === '' ? null : e.target.value === 'yes')}>
                    <option value="">— Select —</option><option value="yes">Yes</option><option value="no">No</option>
                  </Select>
                )
              } else if (f.kind === 'choice') {
                input = (
                  <Select style={inputStyle} value={(v as string) || ''} onChange={(e) => setVal(f.key, e.target.value || null)}>
                    <option value="">— Select —</option>
                    {Object.entries(f.options || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                )
              } else if (f.kind === 'date') {
                input = <DateField value={(v as string) || ''} onChange={(d) => setVal(f.key, d)} />
              } else if (f.kind === 'erp_project') {
                input = <SearchableSelect value={(v as string) || ''} onChange={(x) => setVal(f.key, x)} placeholder="Search serial, model, customer, PO…"
                  options={projects.map((p) => ({ value: String(p.id), label: `${p.label}${isDispatch && p.third_party_inspection_required ? ' · inspection required' : ''}` }))} />
              } else if (f.kind === 'item') {
                // Job work: what comes back. Blank = the same item that is sent (plating, heat treatment…).
                input = <SearchableSelect value={(v as string) || ''} onChange={(x) => setVal(f.key, x || null)} placeholder="— same item as sent —"
                  options={[{ value: '', label: '— same item as sent —' }, ...items.map((it) => ({ value: String(it.id), label: `${it.item_code} — ${it.item_name}` }))]} />
              } else if (LOOKUP_OF[f.kind]) {
                input = <SearchableSelect value={(v as string) || ''} onChange={(x) => setVal(f.key, x)} placeholder={`Search ${f.label.toLowerCase()}…`}
                  options={(lookups[LOOKUP_OF[f.kind]] || []).map((o) => ({ value: String(o.id), label: o.label }))} />
              } else {
                input = <input style={inputStyle} value={(v as string) || ''} maxLength={f.key === 'challan_number' ? 50 : undefined} onChange={(e) => setVal(f.key, e.target.value)} />
              }
              const wide = f.kind === 'text' && f.key === 'site_address'
              return (
                <div key={f.key} style={{ flex: wide ? '1 1 320px' : '0 1 260px', minWidth: 200, maxWidth: wide ? 520 : 340 }}>
                  <Field label={label}>{input}</Field>
                </div>
              )
            })}
            {spec.order_project && (
              <div data-tour="issue-order-project" style={{ flex: '1 1 320px', minWidth: 240, maxWidth: 520 }}>
                <Field label={<>Order project element {isDispatch
                  ? <span style={{ fontWeight: 400, color: SHEET.MUTED }}>(taken from the delivery row)</span>
                  : <span style={{ fontWeight: 400, color: SHEET.MUTED }}>(required for an RRV order)</span>}</>}>
                  <OrderProjectPicker value={orderProject} onChange={(v) => setOrderProject(v)}
                    placeholder="Vehicle / lot this material goes to" />
                  <div style={sheetHint}>
                    Filled from the RRV build / work order no. when it has one. The vehicle&apos;s project stock is issued first.
                  </div>
                </Field>
              </div>
            )}
            {isDispatch && (
              <div data-tour="issue-dispatch-so-row" style={{ flex: '1 1 320px', minWidth: 240, maxWidth: 520 }}>
                <Field label={<>Sales order delivery row {vals.erp_project_id ? null : <span style={{ fontWeight: 400, color: SHEET.MUTED }}>(or the machine)</span>}</>}>
                  <SearchableSelect value={scheduleId} onChange={setScheduleId} placeholder="Search SO no., customer, item…"
                    options={soRows.map((r) => ({ value: String(r.schedule_id), label: `${r.so_number} · ${r.customer_name || ''} · ${r.label}${r.description ? ` · ${r.description}` : ''} — open ${r.open_qty} ${r.uom || ''}` }))} />
                  {pickedRow && (
                    <div style={sheetHint}>
                      Lines of this item are booked against {pickedRow.so_number} ({pickedRow.open_qty} {pickedRow.uom || ''} still to dispatch).
                    </div>
                  )}
                </Field>
              </div>
            )}
          </div>
        )}
      </SheetSection>
        }
        right={<>
          <SheetSection icon="chat" title="Remarks" extra={spec?.remarks_label ? undefined : <Optional />}>
            <Field label={spec?.remarks_label ? <>{spec.remarks_label} <Req /></> : 'Remarks'}>
              <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
            {storeManager && (
              <div data-tour="issue-override-reason" style={{ marginTop: 12 }}>
                <Field label={<>Reason for using project stock <span style={{ fontWeight: 400, color: SHEET.MUTED }}>(Store Manager)</span></>}>
                  <input style={inputStyle} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Only if stock held for another vehicle must be issued here" />
                </Field>
              </div>
            )}
          </SheetSection>
          {(spec?.leaves_factory || spec?.manager_only || isDispatch) && (
            <SheetSection icon="alert" title="Notes">
              {spec?.leaves_factory && (
                <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>This material leaves the factory, so it travels on a delivery challan.</p>
              )}
              {spec?.manager_only && (
                <p style={{ fontSize: 12.5, color: '#b45309', margin: '0 0 10px' }}>A write-off — only a Store Manager or admin can post it.</p>
              )}
              {isDispatch && (
                <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>
                  Dispatch checks (Quality rule 8): each finished-goods line needs its batch / serial and an accepted final inspection
                  {selectedProject?.third_party_inspection_required ? `, and this order needs an accepted ${(selectedProject.inspection_agency || 'third-party').toUpperCase()} inspection certificate` : ''}.
                </p>
              )}
            </SheetSection>
          )}
        </>}
      />

      <div style={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
      <SheetSection icon="box" title="Items">
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
            <button type="button" data-tour="issue-import-btn" onClick={() => fileRef.current?.click()} disabled={importing} style={smallBtn()}>
              <SheetIcon name="upload" size={14} />{importing ? 'Reading…' : 'Import from Excel'}
            </button>
            <button type="button" onClick={downloadTemplate} style={smallBtn()}><SheetIcon name="doc" size={14} />Download template</button>
          </div>
        </div>

        {problemLines.length > 0 && (
          <div data-tour="issue-shortage-banner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.2)' }}>
            <span style={{ fontSize: 13, color: '#b91c1c' }}>
              <b>{problemLines.length}</b> line(s) can&apos;t be issued in full from this store — remove them, or issue only what is available.
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={issueWhatsAvailable} style={smallBtn()}>Issue only what&apos;s available</button>
              <button type="button" onClick={removeUnavailable} style={{ ...sheetBtn('primary', '#dc2626'), padding: '6px 12px', minHeight: 30, fontSize: 12 }}>Remove short lines</button>
            </div>
          </div>
        )}

        <div style={{ overflowX: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                {['#', 'Item', 'Quantity', 'Available in store', 'Batch / bin / serial', 'Remarks', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 6px', fontSize: 11, fontWeight: 700, color: SHEET.MUTED, background: SHEET.SOFT, textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const st = lineState(line)
                const item = itemById.get(Number(line.itemId))
                const b = balances.get(Number(line.itemId))
                const need = demand.get(Number(line.itemId)) || 0
                const bad = st === 'short' || st === 'out'
                return (
                  <tr key={idx} style={{ background: bad ? 'rgba(220,38,38,0.05)' : undefined, borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ padding: '6px', fontSize: 12, color: TEXT.muted, width: 28 }}>{idx + 1}</td>
                    <td style={{ padding: '6px', minWidth: 260 }}>
                      <div {...(idx === 0 ? { 'data-tour': 'issue-item' } : {})}>
                        <SearchableSelect value={line.itemId} onChange={(v) => updateLine(idx, { itemId: v })} placeholder="Search item code or name…"
                          options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
                      </div>
                    </td>
                    <td style={{ padding: '6px', width: 120 }}>
                      <input {...(idx === 0 ? { 'data-tour': 'issue-quantity' } : {})} type="number" min="0" style={{ ...inputStyle, borderColor: bad ? '#dc2626' : undefined }}
                        value={line.quantity} placeholder={item?.uom || ''} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                    </td>
                    <td style={{ padding: '6px', width: 190, fontSize: 12.5, lineHeight: 1.35 }} {...(idx === 0 ? { 'data-tour': 'issue-available' } : {})}>
                      {!locationId || !line.itemId ? <span style={{ color: TEXT.muted }}>—</span> : (
                        <>
                          <span style={{ fontWeight: 700, color: st === 'out' ? '#b91c1c' : st === 'short' ? '#b91c1c' : '#15803d' }}>
                            {(b?.available || 0)} {item?.uom || ''} available
                          </span>
                          {st === 'out' && <div style={{ color: '#b91c1c' }}>Not in stock</div>}
                          {st === 'short' && <div style={{ color: '#b91c1c' }}>Short by {+(need - (b?.available || 0)).toFixed(4)}{need !== Number(line.quantity) ? ' (all lines of this item)' : ''}</div>}
                          {b && b.reserved > 0 && <div style={{ color: TEXT.muted, fontSize: 11.5 }}>{b.onHand} on hand, {b.reserved} reserved</div>}
                          {b && b.held > 0 && <div style={{ color: '#d97706', fontSize: 11.5 }}>{b.held} held in Quality / Blocked</div>}
                        </>
                      )}
                    </td>
                    <td style={{ padding: '6px', width: 130 }}>
                      {item?.batch_controlled && locationId ? (
                        <BatchPicker itemId={item.id} locationId={Number(locationId)} quantity={Number(line.quantity || 0)}
                          value={line.batchNumber} onChange={(v) => updateLine(idx, { batchNumber: v })} />
                      ) : (
                        <input style={inputStyle} value={line.batchNumber} onChange={(e) => updateLine(idx, { batchNumber: e.target.value })} />
                      )}
                      {item && locationId && (
                        <BinSerialPicker locationId={Number(locationId)} itemId={item.id} serialised={!!item.serial_controlled}
                          quantity={Number(line.quantity || 0)} binId={line.binId || ''} serials={line.serials || []}
                          onChange={(patch) => updateLine(idx, patch)} />
                      )}
                    </td>
                    <td style={{ padding: '6px', minWidth: 140 }}>
                      <input style={inputStyle} value={line.remarks} onChange={(e) => updateLine(idx, { remarks: e.target.value })} />
                    </td>
                    <td style={{ padding: '6px', width: 44 }}>
                      <button type="button" title="Remove this line" onClick={() => removeLine(idx)}
                        aria-label="Remove line" style={{ ...sheetBtn('secondary', SHEET.INK), padding: 0, width: 38, height: 38, justifyContent: 'center', color: bad ? '#b91c1c' : undefined }}><SheetIcon name="trash" size={15} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button type="button" data-tour="issue-add-item-btn" onClick={addLine} style={{ ...sheetBtn('ghost', SHEET.BLUE), marginTop: 10 }}><SheetIcon name="plus" size={15} />Add Item</button>
      </SheetSection>
      </div>
    </FormPage>
  )
}
