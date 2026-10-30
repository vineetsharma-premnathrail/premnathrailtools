'use client'

// Optional "CRM source" of a new project: the CRM inquiry or tender at "Order Received" that this
// project comes from. Traceability only — it does not change or lock the CRM record.
// Value is "inquiry:12" / "tender:5" / "" (none). Reuses the CRM list APIs, so the list is limited
// to what the user may see in CRM; without CRM access the field explains that and stays optional.
import { useEffect, useMemo, useState } from 'react'
import { crmApi } from '@/lib/api'
import SearchableSelect, { SearchableOption } from '@/components/erp/SearchableSelect'
import { sheetHint } from '@/components/shared/FormSheet'

type Row = { id: number; universal_id: string; org_id: number; status: string; current_stage: string; product?: string; tender_name?: string; tender_number?: string }

const INQUIRY_WON = (r: Row) => r.current_stage === 'Order Received' || r.status === 'Closed - Ordered'
const TENDER_WON = (r: Row) => r.status === 'LOA / Order Received' || r.status === 'Closed – Ordered'

export function parseCrmSource(value: string): { source_kind: 'inquiry' | 'tender'; source_id: number } | null {
  const [kind, id] = value.split(':')
  if ((kind === 'inquiry' || kind === 'tender') && Number(id) > 0) return { source_kind: kind, source_id: Number(id) }
  return null
}

export default function CrmSourcePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [inquiries, setInquiries] = useState<Row[]>([])
  const [tenders, setTenders] = useState<Row[]>([])
  const [orgs, setOrgs] = useState<Record<number, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [noAccess, setNoAccess] = useState(false)

  useEffect(() => {
    let ignore = false
    Promise.allSettled([
      crmApi.listInquiries({ limit: 200 }),
      crmApi.listTenders({ limit: 200 }),
      crmApi.listOrganizations({ picker: true }),
    ]).then(([i, t, o]) => {
      if (ignore) return
      if (i.status === 'fulfilled') setInquiries((i.value as Row[]).filter(INQUIRY_WON))
      if (t.status === 'fulfilled') setTenders((t.value as Row[]).filter(TENDER_WON))
      if (o.status === 'fulfilled') setOrgs(Object.fromEntries((o.value as { id: number; name: string }[]).map((x) => [x.id, x.name])))
      setNoAccess(i.status === 'rejected' && t.status === 'rejected')
      setLoaded(true)
    })
    return () => { ignore = true }
  }, [])

  const options = useMemo<SearchableOption[]>(() => {
    const label = (r: Row, extra?: string) => [r.universal_id, orgs[r.org_id], extra].filter(Boolean).join(' — ')
    const inq = inquiries.map((r) => ({ value: `inquiry:${r.id}`, label: label(r, r.product), group: 'Inquiries' }))
    const tnd = tenders.map((r) => ({ value: `tender:${r.id}`, label: label(r, r.tender_name || r.tender_number), group: 'Tenders' }))
    const sorted = [...inq, ...tnd].sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
    return sorted.length ? [{ value: '', label: 'None — not from a CRM inquiry or tender' }, ...sorted] : sorted
  }, [inquiries, tenders, orgs])

  const hint = !loaded ? 'Loading CRM records…'
    : noAccess ? 'The CRM list could not be loaded — you may not have CRM access. Leave this blank, or ask an admin for CRM › Inquiries & Tenders › View.'
    : options.length === 0 ? 'No inquiry or tender is at "Order Received" yet. Leave this blank if the order did not come through CRM.'
    : 'Shows inquiries and tenders at Order Received. Only for traceability — the CRM record is not changed.'

  return (
    <>
      <SearchableSelect value={value} onChange={onChange} options={options} placeholder="None — not from a CRM inquiry or tender" disabled={!loaded || options.length === 0} />
      <p style={sheetHint}>{hint}</p>
    </>
  )
}
