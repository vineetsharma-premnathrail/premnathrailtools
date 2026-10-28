'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityContract, QualityInspectionLot, QualityOrderProjectRequirement } from '@/types'
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/ProjectUnitPicker'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'
import { ErrorBanner } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'

interface ItemOpt { id: number; item_code: string; item_name: string; uom?: string }

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }
function F({ label, flex = '1 1 200px', children }: { label: React.ReactNode; flex?: string; children: React.ReactNode }) {
  return <div style={{ flex, minWidth: 0 }}><label style={sheetLabel}>{label}</label>{children}</div>
}

export default function NewInspectionCallPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const [items, setItems] = useState<ItemOpt[]>([])
  const [contracts, setContracts] = useState<QualityContract[]>([])
  const [agencies, setAgencies] = useState<{ value: string; label: string }[]>([])
  const [itemLots, setLots] = useState<QualityInspectionLot[]>([])
  const [form, setForm] = useState({
    erp_project_id: '', order_reference: '', customer_name: '', item_id: '', quantity: '', batch_number: '', lot_id: '',
    agency: '', requested_date: new Date().toISOString().slice(0, 10), call_date: '', inspector_name: '', remarks: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  // Project (the build): its Sales Order decides the agency.
  const [op, setOp] = useState<OrderProjectValue | null>(null)
  const [req, setReq] = useState<QualityOrderProjectRequirement | null>(null)
  const [reqError, setReqError] = useState('')
  const draft = useFormDraft('quality-inspection-call-new', { form, op }, (d) => {
    if (d.form) setForm((f) => ({ ...f, ...d.form }))
    setOp(d.op || null)
  })

  useEffect(() => {
    if (!op) return
    let ignore = false
    qualityApi.orderProjectRequirement({ element_id: op.elementId, project_id: op.projectId })
      .then((r: QualityOrderProjectRequirement) => {
        if (ignore) return
        setReq(r); setReqError('')
        setForm((f) => ({ ...f, agency: r.agency || '' }))
      })
      .catch((e) => {
        if (ignore) return
        const msg = extractErrorMessages(e, 'Could not read the Sales Order of this project.')
        setReq(null); setReqError(Array.isArray(msg) ? msg.join(' ') : msg)
      })
    return () => { ignore = true }
  }, [op])

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.lookupItems('').then(setItems).catch((e) => setError(extractErrorMessages(e, 'Failed to load items.')))
    qualityApi.listContracts().then(setContracts).catch(() => setContracts([]))
    qualityApi.getInspectionCallMeta().then((m) => setAgencies(m.agencies || [])).catch(() => setAgencies([]))
  }, [isAuthorized])

  useEffect(() => {
    if (!form.item_id) return
    qualityApi.listLots({ status: 'decision_made' })
      .then((d: QualityInspectionLot[]) => setLots(d.filter((l) => String(l.item_id) === form.item_id && (l.accepted_qty || 0) > 0 && ['final', 'first_article'].includes(l.inspection_type))))
      .catch(() => setLots([]))
  }, [form.item_id])

  const lots = form.item_id ? itemLots : []
  const contract = contracts.find((c) => String(c.id) === form.erp_project_id)
  const item = items.find((i) => String(i.id) === form.item_id)

  const submit = async () => {
    setError('')
    if (!op && !form.erp_project_id && !form.order_reference.trim()) return setError('Pick the Project unit (vehicle / lot), or the ERP machine / order, or type the customer order reference.')
    if (op && req && !req.agency) return setError(`Sales Order ${req.so_number} has no inspecting agency, so no third-party inspection is due for ${req.op_number}. Ask Sales to amend the order's inspection agency first.`)
    if (!form.item_id) return setError('Pick the item offered for inspection.')
    if (!(Number(form.quantity) > 0)) return setError('Enter the quantity offered for inspection.')
    if (!op && !form.agency && !contract?.inspection_agency) return setError('Pick the inspecting agency.')
    setBusy(true)
    try {
      const call = await qualityApi.createInspectionCall({
        order_project_id: op?.projectId ?? null, order_project_element_id: op?.elementId ?? null,
        erp_project_id: form.erp_project_id ? Number(form.erp_project_id) : null, order_reference: form.order_reference.trim() || null,
        customer_name: form.customer_name.trim() || null, item_id: Number(form.item_id), quantity: Number(form.quantity),
        batch_number: form.batch_number.trim() || null, lot_id: form.lot_id ? Number(form.lot_id) : null,
        agency: form.agency || null, requested_date: form.requested_date || null, call_date: form.call_date || null,
        inspector_name: form.inspector_name.trim() || null, remarks: form.remarks.trim() || null,
      })
      draft.clear()
      router.push(recordPath('/dashboard/quality/inspection-calls', call))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise the inspection call.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  const back = () => router.push('/dashboard/quality/inspection-calls')

  return (
    <FormPage nav={<QualityNav />} icon="shield" title="New Inspection Call" subtitle="Offer material to the customer's / third-party inspector (RITES, RDSO, customer)." onBack={back} backTour="qa-call-new-back"
      footer={<>
        <button type="button" onClick={back} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="send" size={16} />{busy ? 'Saving…' : 'Raise Call'}</button>
      </>}>
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <DraftBanner draft={draft} />
          <SheetSection icon="building" title="Order">
            <div style={row}>
              <F label="Project — Unit (vehicle / lot)" flex="1 1 100%">
                <OrderProjectPicker value={op} onChange={(v) => { setOp(v); setReq(null); setReqError('') }} />
              </F>
            </div>
            {reqError && <p style={{ ...sheetHint, color: '#b91c1c' }}>{reqError}</p>}
            {op && req && (
              <p style={{ ...sheetHint, color: req.agency ? (req.required ? '#b45309' : SHEET.INK) : '#b91c1c' }}>
                {req.agency
                  ? `${req.agency_label || req.agency} inspection${req.required ? ' required before dispatch' : ''} — from Sales Order ${req.so_number}.`
                  : `Sales Order ${req.so_number} has no inspecting agency — no third-party inspection is due. Ask Sales to amend the order if the customer now wants one.`}
                {req.calls.length > 0 ? ` Calls already raised for this vehicle / lot: ${req.calls.map((c) => `${c.call_number} (${c.status.replace('_', ' ')})`).join(', ')}.` : ''}
              </p>
            )}
            <div style={row}>
              <F label={<>Machine / order (ERP) <Optional /></>} flex="1 1 100%">
                <SearchableSelect value={form.erp_project_id} placeholder="Search serial, PO, customer"
                  onChange={(v) => {
                    const c = contracts.find((x) => String(x.id) === v)
                    setForm({ ...form, erp_project_id: v, agency: form.agency || c?.inspection_agency || '' })
                  }}
                  options={contracts.map((c) => ({ value: String(c.id), label: `${c.label}${c.third_party_inspection_required ? ' · inspection required' : ''}` }))} />
              </F>
            </div>
            <div style={row}>
              <F label="Customer order ref."><input style={sheetInput} value={form.order_reference} placeholder={req?.order_reference || contract?.po_number || 'PO / contract no.'} onChange={(e) => setForm({ ...form, order_reference: e.target.value })} /></F>
              <F label="Customer"><input style={sheetInput} value={form.customer_name} placeholder={req?.customer_name || contract?.client_company || ''} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></F>
            </div>
            <p style={sheetHint}>
              {op
                ? 'Order reference and customer default from the Sales Order when left blank.'
                : contract
                ? (contract.third_party_inspection_required
                  ? `This contract needs ${contract.inspection_agency_label || contract.inspection_agency} inspection before dispatch.`
                  : 'This contract has no third-party inspection requirement — the call is for the record.')
                : 'Pick the Project unit (vehicle / lot), the ERP machine / order, or type the customer order reference.'}
            </p>
          </SheetSection>
          <SheetSection icon="box" title="Material offered">
            <div style={row}>
              <F label={<>Item <Req /></>} flex="1 1 100%">
                <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v, lot_id: '' })} placeholder="Search item"
                  options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
              </F>
            </div>
            <div style={row}>
              <F label={<>Quantity{item?.uom ? ` (${item.uom})` : ''} <Req /></>} flex="0 1 150px">
                <input type="number" min={0} step="any" style={sheetInput} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </F>
              <F label="Batch / serial"><input style={sheetInput} value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} /></F>
            </div>
            <F label={<>Our final inspection lot <Optional /></>}>
              <Select style={sheetInput} value={form.lot_id} onChange={(e) => {
                const l = lots.find((x) => String(x.id) === e.target.value)
                setForm({ ...form, lot_id: e.target.value, batch_number: form.batch_number || l?.batch_number || '' })
              }}>
                <option value="">—</option>
                {lots.map((l) => <option key={l.id} value={l.id}>{l.lot_number} · {l.batch_number || ''} · {l.accepted_qty} accepted</option>)}
              </Select>
            </F>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="calendar" title="Call">
            <label style={sheetLabel}>Agency <Req /></label>
            {op ? (
              <div style={{ ...sheetInput, background: 'rgba(15,23,42,.04)', cursor: 'default' }} title="The agency comes from the Sales Order — ask Sales to amend the order to change it.">
                {req?.agency ? `${req.agency_label || req.agency} · from Sales Order ${req.so_number}` : (req ? 'None on the Sales Order' : 'Reading the Sales Order…')}
              </div>
            ) : (
              <Select style={sheetInput} value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })}>
                <option value="">Select…</option>
                {agencies.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </Select>
            )}
            <div style={{ ...row, marginTop: 14 }}>
              <F label="Call raised on" flex="1 1 140px"><DateField value={form.requested_date} onChange={(v) => setForm({ ...form, requested_date: v })} /></F>
              <F label="Inspection date" flex="1 1 140px"><DateField value={form.call_date} onChange={(v) => setForm({ ...form, call_date: v })} /></F>
            </div>
            <label style={sheetLabel}>Inspector</label>
            <input style={sheetInput} value={form.inspector_name} onChange={(e) => setForm({ ...form, inspector_name: e.target.value })} />
          </SheetSection>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </SheetSection>
        </>}
      />
    </FormPage>
  )
}
