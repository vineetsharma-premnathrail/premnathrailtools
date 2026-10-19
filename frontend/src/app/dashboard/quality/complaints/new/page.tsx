'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityComplaintMeta, QualityDefectCode } from '@/types'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, FileDropZone, Req, Optional } from '@/components/shared/FormSheet'
import { ErrorBanner } from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'

interface ItemOpt { id: number; item_code: string; item_name: string }

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }
function F({ label, flex = '1 1 200px', children }: { label: React.ReactNode; flex?: string; children: React.ReactNode }) {
  return <div style={{ flex, minWidth: 0 }}><label style={sheetLabel}>{label}</label>{children}</div>
}

export default function NewComplaintPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const [meta, setMeta] = useState<QualityComplaintMeta | null>(null)
  const [items, setItems] = useState<ItemOpt[]>([])
  const [codes, setCodes] = useState<QualityDefectCode[]>([])
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    source: 'email', source_reference: '', erp_project_id: '', customer_name: '', contact_person: '', item_id: '', item_name: '',
    serial_number: '', batch_number: '', quantity_affected: '', category: '', defect_code_id: '', severity: 'minor',
    description: '', complaint_date: today,
  })
  const [photos, setPhotos] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.getComplaintMeta().then(setMeta).catch(() => setMeta(null))
    qualityApi.lookupItems('').then(setItems).catch(() => setItems([]))
    qualityApi.listMaster('defect-codes').then(setCodes).catch(() => setCodes([]))
  }, [isAuthorized])

  const pickProject = (v: string) => {
    const p = meta?.projects.find((x) => String(x.id) === v)
    setForm({ ...form, erp_project_id: v, customer_name: form.customer_name || p?.client_company || '' })
  }

  const submit = async () => {
    setError('')
    if (!form.customer_name.trim() && !form.erp_project_id) return setError('Enter the customer (or pick the machine / order it came from).')
    if (!form.description.trim()) return setError('Describe the complaint as the customer reported it.')
    setBusy(true)
    try {
      const c = await qualityApi.createComplaint({
        source: form.source, source_reference: form.source_reference || null,
        erp_project_id: form.erp_project_id ? Number(form.erp_project_id) : null, customer_name: form.customer_name || null,
        contact_person: form.contact_person || null, item_id: form.item_id ? Number(form.item_id) : null,
        item_name: form.item_id ? null : form.item_name || null, serial_number: form.serial_number || null, batch_number: form.batch_number || null,
        quantity_affected: form.quantity_affected ? Number(form.quantity_affected) : null, category: form.category || null,
        defect_code_id: form.defect_code_id ? Number(form.defect_code_id) : null, severity: form.severity,
        description: form.description, complaint_date: form.complaint_date,
      })
      if (photos.length) {
        try { await qualityApi.uploadComplaintPhotos(c.id, photos) } catch { /* photo upload failure shouldn't block logging the complaint */ }
      }
      router.push(recordPath('/dashboard/quality/complaints', c))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to log the complaint.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  const back = () => router.push('/dashboard/quality/complaints')

  return (
    <FormPage nav={<QualityNav />} icon="chat" title="Log Customer Complaint" subtitle="Quality · Customer complaints — record it as the customer reported it." onBack={back} backTour="qa-complaint-new-back"
      footer={<>
        <button type="button" onClick={back} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Log complaint'}</button>
      </>}>
      <SheetColumns
        left={<>
          <ErrorBanner error={error} />
          <SheetSection icon="building" title="Where it came from">
            <div style={row}>
              <F label="Source">
                <select style={sheetInput} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  {Object.entries(meta?.sources || { email: 'Email / letter' }).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </F>
              <F label={form.source === 'service_ticket' ? 'Service ticket no.' : 'Reference (email date, letter no.)'}>
                <input style={sheetInput} value={form.source_reference} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} />
              </F>
              <F label="Complaint date" flex="0 1 170px"><DateField value={form.complaint_date} onChange={(v) => setForm({ ...form, complaint_date: v })} /></F>
            </div>
            <div style={row}>
              <F label="Machine / order (ERP)" flex="1 1 100%">
                <SearchableSelect value={form.erp_project_id} onChange={pickProject} placeholder="Select machine / order (optional)"
                  options={(meta?.projects || []).map((p) => ({ value: String(p.id), label: p.label }))} />
              </F>
            </div>
            <div style={row}>
              <F label={<>Customer <Req /></>}><input style={sheetInput} value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></F>
              <F label="Contact person"><input style={sheetInput} value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></F>
            </div>
          </SheetSection>
          <SheetSection icon="alert" title="What failed">
            <div style={row}>
              <F label="Item (Item Master)">
                <SearchableSelect value={form.item_id} onChange={(v) => setForm({ ...form, item_id: v })} placeholder="Select item"
                  options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
              </F>
              {!form.item_id && (
                <F label="…or item name"><input style={sheetInput} value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} /></F>
              )}
            </div>
            <div style={row}>
              <F label="Serial no."><input style={sheetInput} value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} /></F>
              <F label="Batch / heat no."><input style={sheetInput} value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} /></F>
              <F label="Qty affected" flex="0 1 120px"><input type="number" min={0} style={sheetInput} value={form.quantity_affected} onChange={(e) => setForm({ ...form, quantity_affected: e.target.value })} /></F>
            </div>
            <div style={row}>
              <F label="Category">
                <select style={sheetInput} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="">—</option>
                  {(meta?.categories || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </F>
              <F label="Defect code">
                <select style={sheetInput} value={form.defect_code_id} onChange={(e) => setForm({ ...form, defect_code_id: e.target.value })}>
                  <option value="">—</option>
                  {codes.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                </select>
              </F>
              <F label="Severity" flex="0 1 140px">
                <select style={sheetInput} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                  <option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option>
                </select>
              </F>
            </div>
            <label style={sheetLabel}>Description (as the customer reported it) <Req /></label>
            <textarea style={{ ...sheetInput, minHeight: 100, resize: 'vertical' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="clip" title="Photos" extra={<Optional />}>
            <FileDropZone files={photos} onChange={(f) => setPhotos(f.filter((x) => x.type.startsWith('image/')))} />
            <p style={sheetHint}>Images only — uploaded after the complaint is logged.</p>
          </SheetSection>
        </>}
      />
    </FormPage>
  )
}
