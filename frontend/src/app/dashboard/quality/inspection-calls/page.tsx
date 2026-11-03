'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { qualityApi } from '@/lib/api'
import { useVisibility } from '@/lib/visibility'
import { VisTd, VisTh } from '@/lib/visibilityComponents'
import { useQualityScreen } from '@/components/quality/useQualityScreen'
import { sampleCalls } from '@/lib/qualityPreviewSamples'
import { QualityContract, QualityInspectionCall } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { Field, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle, RowCount } from '@/components/shared/ui'
import {
  Pill, PageHeader, ErrorBanner, tableWrapStyle, thStyle, tdStyle, filterInputStyle, fmtDate, fmtQty,
} from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import OrderProjectPicker, { OrderProjectChip, OrderProjectValue } from '@/components/sales/ProjectUnitPicker'
import Select from '@/components/shared/Select'

const STATUS_LABELS: Record<string, string> = {
  requested: 'Requested', scheduled: 'Scheduled', accepted: 'Accepted', partially_accepted: 'Partly accepted', rejected: 'Rejected', cancelled: 'Cancelled',
}
const STATUS_HEX: Record<string, string> = {
  requested: '#78716c', scheduled: '#2563EB', accepted: '#16A34A', partially_accepted: '#F59E0B', rejected: '#DC2626', cancelled: '#a8a29e',
}
const TABS = [['calls', 'Inspection calls'], ['contracts', 'Contract requirements'], ['dispatch', 'Dispatch check']] as const
type Tab = typeof TABS[number][0]

function CallsTab() {
  const router = useRouter()
  // Columns the user's roles hide; in the Role editor's preview the list shows sample rows and loads nothing.
  const vis = useVisibility('quality:inspection_calls')
  const [rows, setRows] = useState<QualityInspectionCall[]>(vis.preview ? sampleCalls : [])
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [op, setOp] = useState<OrderProjectValue | null>(null)
  // Loading = the rows on screen aren't for the current filters yet.
  const params: Record<string, unknown> = {}
  if (status) params.status = status
  if (search.trim()) params.search = search.trim()
  if (op) {
    if (op.elementId) params.order_project_element_id = op.elementId
    else params.order_project_id = op.projectId
  }
  const filterKey = JSON.stringify(params)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = !vis.preview && loadedKey !== filterKey

  useEffect(() => {
    if (vis.preview) return  // sample rows from the first render, nothing is loaded
    const params = JSON.parse(filterKey) as Record<string, unknown>
    qualityApi.listInspectionCalls(params)
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load inspection calls.')))
      .finally(() => setLoadedKey(filterKey))
  }, [filterKey, vis.preview])

  // [label, hideable column key]: number and status are never hideable.
  const cols: [string, string | null][] = [['Call', null], ['Agency', 'agency'], ['Order / contract', 'order'], ['Item', 'item'], ['Qty', 'qty'],
    ['Call date', 'call_date'], ['Inspector', 'inspector'], ['Status', null], ['Certificate', 'certificate']]
  // The preview draws every column (hidden ones dimmed, with a toggle); normal use drops the hidden ones.
  const colCount = cols.filter(([, k]) => !k || vis.preview || vis.showColumn('calls', k)).length
  return (
    <>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input style={{ ...filterInputStyle, flex: '1 1 240px', maxWidth: 420 }} placeholder="Search call, item, order, certificate…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select style={{ ...filterInputStyle, flex: '0 1 180px' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
          <OrderProjectPicker value={op} onChange={(v) => setOp(v)} requireElement={false} placeholder="All projects" />
        </div>
      </div>
      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead><tr>{cols.map(([h, k], i) => {
            const head = <>{h}{i === 0 && <RowCount count={rows.length} />}</>
            return k ? <VisTh key={h} vis={vis} table="calls" k={k} style={thStyle}>{head}</VisTh> : <th key={h} style={thStyle}>{head}</th>
          })}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={colCount} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No inspection calls yet.</td></tr>
            ) : rows.map((c) => {
              const soon = c.days_to_call != null && c.days_to_call <= 2
              return (
                <tr key={c.id} onClick={vis.preview ? undefined : () => router.push(recordPath('/dashboard/quality/inspection-calls', c))} style={{ cursor: vis.preview ? 'default' : 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{c.call_number}</td>
                  <VisTd vis={vis} table="calls" k="agency" style={tdStyle}>{c.agency_label || c.agency}</VisTd>
                  <VisTd vis={vis} table="calls" k="order" style={tdStyle}>
                    {c.order_reference || '—'}<div style={{ fontSize: 11.5, color: TEXT.muted }}>{c.project_label || c.customer_name || ''}</div>
                    {c.op_number && <div style={{ marginTop: 4 }}><OrderProjectChip opNumber={c.op_number} elementNo={c.element_no} label={c.element_label} /></div>}
                  </VisTd>
                  <VisTd vis={vis} table="calls" k="item" style={tdStyle}>{c.item_code ? `${c.item_code} — ` : ''}{c.item_name}</VisTd>
                  <VisTd vis={vis} table="calls" k="qty" style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtQty(c.quantity, c.uom)}</VisTd>
                  <VisTd vis={vis} table="calls" k="call_date" style={{ ...tdStyle, whiteSpace: 'nowrap', color: soon ? '#DC2626' : TEXT.body, fontWeight: soon ? 700 : 400 }}>{fmtDate(c.call_date)}</VisTd>
                  <VisTd vis={vis} table="calls" k="inspector" style={tdStyle}>{c.inspector_name || '—'}</VisTd>
                  <td style={tdStyle}><Pill text={STATUS_LABELS[c.status] || c.status} hex={STATUS_HEX[c.status]} /></td>
                  <VisTd vis={vis} table="calls" k="certificate" style={tdStyle}>{c.certificate_number || '—'}</VisTd>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ContractsTab({ agencies, canApprove }: { agencies: { value: string; label: string }[]; canApprove: boolean }) {
  const [rows, setRows] = useState<QualityContract[]>([])
  const [search, setSearch] = useState('')
  const [requiredOnly, setRequiredOnly] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    const params: Record<string, unknown> = { required_only: requiredOnly }
    if (search.trim()) params.search = search.trim()
    qualityApi.listContracts(params).then(setRows).catch((err) => setError(extractErrorMessages(err, 'Failed to load contracts.')))
  }, [search, requiredOnly])

  const save = async (c: QualityContract, required: boolean, agency: string) => {
    setError('')
    setSaved('')
    try {
      const r = await qualityApi.setContractRequirement(c.id, { third_party_inspection_required: required, inspection_agency: agency || null })
      setRows((rs) => rs.map((x) => x.id === c.id ? { ...x, third_party_inspection_required: r.third_party_inspection_required, inspection_agency: r.inspection_agency } : x))
      setSaved(`Saved for ${c.label}.`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save the contract requirement.'))
    }
  }

  return (
    <>
      <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 12px', maxWidth: 900 }}>
        Customer machines / orders (ERP). Ticking &ldquo;Third-party inspection&rdquo; means finished goods for that order can&apos;t be dispatched until an inspection call by the agency is accepted with a certificate number (rule 8). Only a Quality head can change it.
      </p>
      <ErrorBanner error={error} />
      {saved && <p style={{ fontSize: 13, color: '#16A34A', margin: '0 0 10px' }}>{saved}</p>}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...filterInputStyle, flex: '1 1 240px', maxWidth: 420 }} placeholder="Search serial, PO, customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={requiredOnly} onChange={(e) => setRequiredOnly(e.target.checked)} /> Only contracts needing inspection
        </label>
      </div>
      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead><tr>{['Machine / order', 'Customer PO', 'Delivery', 'Third-party inspection', 'Agency'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No ERP machines / orders found.</td></tr>
            ) : rows.map((c) => (
              <tr key={c.id}>
                <td style={tdStyle}>{c.label}</td>
                <td style={tdStyle}>{c.po_number || '—'}</td>
                <td style={tdStyle}>{fmtDate(c.delivery_date)}</td>
                <td style={tdStyle}>
                  <input type="checkbox" checked={c.third_party_inspection_required} disabled={!canApprove}
                    onChange={(e) => save(c, e.target.checked, c.inspection_agency || agencies[0]?.value || '')} />
                </td>
                <td style={tdStyle}>
                  <Select style={{ ...inputStyle, width: 170 }} value={c.inspection_agency || ''} disabled={!canApprove || !c.third_party_inspection_required}
                    onChange={(e) => save(c, true, e.target.value)}>
                    <option value="">—</option>
                    {agencies.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function DispatchTab() {
  const [items, setItems] = useState<{ id: number; item_code: string; item_name: string }[]>([])
  const [contracts, setContracts] = useState<QualityContract[]>([])
  const [form, setForm] = useState({ item_id: '', quantity: '1', batch_number: '', erp_project_id: '' })
  const [result, setResult] = useState<{ allowed: boolean; problems: string[] } | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    qualityApi.lookupItems('').then(setItems).catch(() => setItems([]))
    qualityApi.listContracts().then(setContracts).catch(() => setContracts([]))
  }, [])

  const check = async () => {
    setError('')
    setResult(null)
    if (!form.item_id) return setError('Pick the item to check.')
    try {
      setResult(await qualityApi.dispatchCheck({
        item_id: Number(form.item_id), quantity: Number(form.quantity), batch_number: form.batch_number.trim() || null,
        erp_project_id: form.erp_project_id ? Number(form.erp_project_id) : null,
      }))
    } catch (err) {
      setError(extractErrorMessages(err, 'The dispatch check failed.'))
    }
  }

  return (
    <Section title="Can this be dispatched?" style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
        Same check Store runs on a &ldquo;Dispatch to customer&rdquo; material issue: a decided final inspection for the batch, and the contract&apos;s third-party certificate where required.
      </p>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
          <Field label="Item *">
            <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} placeholder="Search item"
              options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
          </Field>
        </div>
        <div style={{ flex: '0 1 110px', minWidth: 100 }}><Field label="Quantity"><input type="number" min={0} step="any" style={inputStyle} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field></div>
        <div style={{ flex: '0 1 170px', minWidth: 150 }}><Field label="Batch / serial"><input style={inputStyle} value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} /></Field></div>
        <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
          <Field label="Machine / order">
            <SearchableSelect value={form.erp_project_id} onChange={(v) => setForm({ ...form, erp_project_id: v })} placeholder="Search order"
              options={contracts.map((c) => ({ value: String(c.id), label: c.label }))} />
          </Field>
        </div>
        <button type="button" style={primaryBtnStyle} onClick={check}>Check</button>
      </div>
      {result && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, border: `1px solid ${BORDER.light}`, background: result.allowed ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)', color: result.allowed ? '#15803d' : '#b91c1c' }}>
          {result.allowed ? 'Cleared for dispatch.' : result.problems.map((p, i) => <div key={i}>{p}</div>)}
        </div>
      )}
    </Section>
  )
}

export default function InspectionCallsPage() {
  // In the Role editor's preview only the calls list is drawn (sample rows), without nav, tabs or actions.
  const { vis, isAuthorized, isLoading } = useQualityScreen('quality:inspection_calls')
  const router = useRouter()
  const { can } = useCan()
  const [tab, setTab] = useState<Tab>('calls')
  const [agencies, setAgencies] = useState<{ value: string; label: string }[]>([])

  useEffect(() => {
    if (!isAuthorized || vis.preview) return
    qualityApi.getInspectionCallMeta().then((m) => setAgencies(m.agencies || [])).catch(() => setAgencies([]))
  }, [isAuthorized, vis.preview])

  if (isLoading || !isAuthorized) return null
  if (vis.preview) return (<div><PageHeader title="Customer / Third-party Inspection" /><CallsTab /></div>)
  return (
    <div>
      <QualityNav />
      <PageHeader title="Customer / Third-party Inspection">
        {can('quality', 'inspection_calls', 'create') && <button type="button" onClick={() => router.push('/dashboard/quality/inspection-calls/new')} style={primaryBtnStyle}>+ New Call</button>}
      </PageHeader>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            style={{ ...secondaryBtnStyle, ...(tab === k ? { color: '#FF6A2A', border: '1px solid rgba(255,106,42,0.5)' } : {}) }}>{l}</button>
        ))}
      </div>
      {tab === 'calls' && <CallsTab />}
      {tab === 'contracts' && <ContractsTab agencies={agencies} canApprove={can('quality', 'inspection_calls', 'approve')} />}
      {tab === 'dispatch' && <DispatchTab />}
    </div>
  )
}
