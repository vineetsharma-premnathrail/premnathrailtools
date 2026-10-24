'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityDefectCode, QualityMasterValue } from '@/types'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, Req } from '@/components/shared/FormSheet'
import { ErrorBanner, sheetGap } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'

interface ItemOpt { id: number; item_code: string; item_name: string; uom?: string }

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }
function F({ label, flex = '1 1 200px', children }: { label: React.ReactNode; flex?: string; children: React.ReactNode }) {
  return <div style={{ flex, minWidth: 0 }}><label style={sheetLabel}>{label}</label>{children}</div>
}

export default function NewNcrPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const [items, setItems] = useState<ItemOpt[]>([])
  const [locations, setLocations] = useState<{ id: number; code: string; name: string }[]>([])
  const [sources, setSources] = useState<QualityMasterValue[]>([])
  const [codes, setCodes] = useState<QualityDefectCode[]>([])
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    source: 'internal', severity: 'minor', item_id: '', item_name: '', quantity: '', block_stock: false, location_id: '',
    batch_number: '', vendor_name: '', defect_code_id: '', source_reference: '', description: '', ncr_date: today,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.lookupItems('').then(setItems).catch(() => setItems([]))
    qualityApi.lookupLocations().then(setLocations).catch(() => setLocations([]))
    qualityApi.listMasterValues({ list_key: 'ncr_sources' }).then(setSources).catch(() => setSources([]))
    qualityApi.listMaster('defect-codes').then(setCodes).catch(() => setCodes([]))
  }, [isAuthorized])

  const item = items.find((i) => String(i.id) === form.item_id)

  const submit = async () => {
    setError('')
    if (!form.item_id && !form.item_name.trim()) return setError('Pick the item from the Item Master, or type the name of a non-stock item.')
    if (!form.description.trim()) return setError('Describe the non-conformance.')
    setBusy(true)
    try {
      const ncr = await qualityApi.createNcr({
        source: form.source, severity: form.severity, item_id: form.item_id ? Number(form.item_id) : null,
        item_name: form.item_id ? null : form.item_name.trim(), quantity: form.quantity ? Number(form.quantity) : null,
        block_stock: form.block_stock, location_id: form.block_stock && form.location_id ? Number(form.location_id) : null,
        batch_number: form.batch_number.trim() || null, vendor_name: form.vendor_name.trim() || null,
        defect_code_id: form.defect_code_id ? Number(form.defect_code_id) : null, source_reference: form.source_reference.trim() || null,
        description: form.description.trim(), ncr_date: form.ncr_date,
      })
      router.push(recordPath('/dashboard/quality/ncr', ncr))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise the NCR.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  const back = () => router.push('/dashboard/quality/ncr')

  return (
    <FormPage nav={<QualityNav />} icon="alert" iconColor="#DC2626" title="Raise NCR"
      subtitle="Rejections at an inspection lot raise their NCR automatically — use this for non-conformances found elsewhere (in stock, on the shop floor, in an audit, from a customer)." onBack={back} backTour="qa-ncr-new-back"
      footer={<>
        <button type="button" onClick={back} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={sheetBtn('primary', '#DC2626', busy)}><SheetIcon name="alert" size={16} />{busy ? 'Raising…' : 'Raise NCR'}</button>
      </>}>
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <SheetSection icon="alert" title="Non-conformance" color="#DC2626">
            <div style={row}>
              <F label="Source">
                <Select style={sheetInput} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </F>
              <F label="Severity" flex="0 1 150px">
                <Select style={sheetInput} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                  <option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option>
                </Select>
              </F>
              <F label="NCR date" flex="0 1 170px"><DateField value={form.ncr_date} onChange={(v) => setForm({ ...form, ncr_date: v })} /></F>
            </div>
            <div style={row}>
              <F label="Item (Item Master)">
                <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} placeholder="Search item"
                  options={[{ value: '', label: '— Not a stock item —' }, ...items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))]} />
              </F>
              {!form.item_id && (
                <F label="Item name (non-stock)"><input style={sheetInput} value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} /></F>
              )}
            </div>
            <div style={row}>
              <F label={`Quantity${item?.uom ? ` (${item.uom})` : ''}`} flex="0 1 150px">
                <input type="number" min={0} step="any" style={sheetInput} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </F>
              <F label="Batch / serial"><input style={sheetInput} value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} /></F>
              <F label="Vendor"><input style={sheetInput} value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} /></F>
            </div>
            <div style={row}>
              <F label="Defect code">
                <Select style={sheetInput} value={form.defect_code_id} onChange={(e) => setForm({ ...form, defect_code_id: e.target.value })}>
                  <option value="">—</option>
                  {codes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name} ({c.category})</option>)}
                </Select>
              </F>
              <F label="Reference document">
                <input style={sheetInput} value={form.source_reference} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} placeholder="Complaint / audit / job no." />
              </F>
            </div>
            <label style={sheetLabel}>Description <Req /></label>
            <textarea style={{ ...sheetInput, minHeight: 100, resize: 'vertical' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is wrong, where it was found, how much is affected" />
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="building" title="Stock">
            {form.item_id ? (
              <>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
                  <input type="checkbox" style={{ marginTop: 2 }} checked={form.block_stock} onChange={(e) => setForm({ ...form, block_stock: e.target.checked })} />
                  Block this quantity — move it from Free to Blocked stock
                </label>
                {form.block_stock && (
                  <>
                    <label style={{ ...sheetLabel, ...sheetGap }}>Store <Req /></label>
                    <Select style={sheetInput} value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
                      <option value="">Select store…</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
                    </Select>
                  </>
                )}
              </>
            ) : (
              <p style={{ ...sheetHint, marginTop: 0 }}>Pick an Item Master item to block its stock while the NCR is open.</p>
            )}
          </SheetSection>
        </>}
      />
    </FormPage>
  )
}
