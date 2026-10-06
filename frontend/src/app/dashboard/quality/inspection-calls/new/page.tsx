'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityContract, QualityInspectionLot } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { Field, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { PageHeader, ErrorBanner } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'

interface ItemOpt { id: number; item_code: string; item_name: string; uom?: string }

export default function NewInspectionCallPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const [items, setItems] = useState<ItemOpt[]>([])
  const [contracts, setContracts] = useState<QualityContract[]>([])
  const [agencies, setAgencies] = useState<{ value: string; label: string }[]>([])
  const [lots, setLots] = useState<QualityInspectionLot[]>([])
  const [form, setForm] = useState({
    erp_project_id: '', order_reference: '', customer_name: '', item_id: '', quantity: '', batch_number: '', lot_id: '',
    agency: '', requested_date: new Date().toISOString().slice(0, 10), call_date: '', inspector_name: '', remarks: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.lookupItems('').then(setItems).catch((e) => setError(extractErrorMessages(e, 'Failed to load items.')))
    qualityApi.listContracts().then(setContracts).catch(() => setContracts([]))
    qualityApi.getInspectionCallMeta().then((m) => setAgencies(m.agencies || [])).catch(() => setAgencies([]))
  }, [isAuthorized])

  useEffect(() => {
    if (!form.item_id) { setLots([]); return }
    qualityApi.listLots({ status: 'decision_made' })
      .then((d: QualityInspectionLot[]) => setLots(d.filter((l) => String(l.item_id) === form.item_id && (l.accepted_qty || 0) > 0 && ['final', 'first_article'].includes(l.inspection_type))))
      .catch(() => setLots([]))
  }, [form.item_id])

  const contract = contracts.find((c) => String(c.id) === form.erp_project_id)
  const item = items.find((i) => String(i.id) === form.item_id)

  const submit = async () => {
    setError('')
    if (!form.erp_project_id && !form.order_reference.trim()) return setError('Pick the machine / order (ERP) or type the customer order reference.')
    if (!form.item_id) return setError('Pick the item offered for inspection.')
    if (!(Number(form.quantity) > 0)) return setError('Enter the quantity offered for inspection.')
    if (!form.agency && !contract?.inspection_agency) return setError('Pick the inspecting agency.')
    setBusy(true)
    try {
      const call = await qualityApi.createInspectionCall({
        erp_project_id: form.erp_project_id ? Number(form.erp_project_id) : null, order_reference: form.order_reference.trim() || null,
        customer_name: form.customer_name.trim() || null, item_id: Number(form.item_id), quantity: Number(form.quantity),
        batch_number: form.batch_number.trim() || null, lot_id: form.lot_id ? Number(form.lot_id) : null,
        agency: form.agency || null, requested_date: form.requested_date || null, call_date: form.call_date || null,
        inspector_name: form.inspector_name.trim() || null, remarks: form.remarks.trim() || null,
      })
      router.push(`/dashboard/quality/inspection-calls/${call.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise the inspection call.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />
      <PageHeader title="New Inspection Call">
        <button type="button" onClick={() => router.push('/dashboard/quality/inspection-calls')} style={secondaryBtnStyle}>← Back</button>
      </PageHeader>
      <ErrorBanner error={error} />
      <Section title="Order" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 300px', maxWidth: 460 }}>
            <Field label="Machine / order (ERP)">
              <SearchableSelect value={form.erp_project_id} placeholder="Search serial, PO, customer"
                onChange={(v) => {
                  const c = contracts.find((x) => String(x.id) === v)
                  setForm({ ...form, erp_project_id: v, agency: form.agency || c?.inspection_agency || '' })
                }}
                options={contracts.map((c) => ({ value: String(c.id), label: `${c.label}${c.third_party_inspection_required ? ' · inspection required' : ''}` }))} />
            </Field>
          </div>
          <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
            <Field label="Customer order ref."><input style={inputStyle} value={form.order_reference} placeholder={contract?.po_number || 'PO / contract no.'} onChange={(e) => setForm({ ...form, order_reference: e.target.value })} /></Field>
          </div>
          <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <Field label="Customer"><input style={inputStyle} value={form.customer_name} placeholder={contract?.client_company || ''} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></Field>
          </div>
        </div>
        {contract && (
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
            {contract.third_party_inspection_required
              ? `This contract needs ${contract.inspection_agency_label || contract.inspection_agency} inspection before dispatch.`
              : 'This contract has no third-party inspection requirement — the call is for the record.'}
          </p>
        )}
      </Section>
      <Section title="Material offered" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 300px', maxWidth: 460 }}>
            <Field label="Item *">
              <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v, lot_id: '' })} placeholder="Search item"
                options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
            </Field>
          </div>
          <div style={{ flex: '0 1 130px', minWidth: 110 }}>
            <Field label={`Quantity *${item?.uom ? ` (${item.uom})` : ''}`}><input type="number" min={0} step="any" style={inputStyle} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <Field label="Batch / serial"><input style={inputStyle} value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} /></Field>
          </div>
          <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <Field label="Our final inspection lot">
              <select style={inputStyle} value={form.lot_id} onChange={(e) => {
                const l = lots.find((x) => String(x.id) === e.target.value)
                setForm({ ...form, lot_id: e.target.value, batch_number: form.batch_number || l?.batch_number || '' })
              }}>
                <option value="">—</option>
                {lots.map((l) => <option key={l.id} value={l.id}>{l.lot_number} · {l.batch_number || ''} · {l.accepted_qty} accepted</option>)}
              </select>
            </Field>
          </div>
        </div>
      </Section>
      <Section title="Call" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '0 1 180px', minWidth: 160 }}>
            <Field label="Agency *">
              <select style={inputStyle} value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })}>
                <option value="">Select…</option>
                {agencies.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 150 }}><Field label="Call raised on"><DateField value={form.requested_date} onChange={(v) => setForm({ ...form, requested_date: v })} /></Field></div>
          <div style={{ flex: '0 1 160px', minWidth: 150 }}><Field label="Inspection date"><DateField value={form.call_date} onChange={(v) => setForm({ ...form, call_date: v })} /></Field></div>
          <div style={{ flex: '1 1 200px', maxWidth: 280 }}><Field label="Inspector"><input style={inputStyle} value={form.inspector_name} onChange={(e) => setForm({ ...form, inspector_name: e.target.value })} /></Field></div>
        </div>
        <Field label="Remarks"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field>
      </Section>
      <button type="button" disabled={busy} onClick={submit} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Raise Call'}</button>
    </div>
  )
}
