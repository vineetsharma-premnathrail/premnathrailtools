'use client'

// Popup that prints one of the owner's ISO store registers (Excel, owner's own
// layout): F/STR/05 Material Issue Register, F/STR/02 Gate Inward Register,
// F/STR/03 Gate Outward Register (date range + store) and F/STR/06 Inventory
// Register (month + store + optional rack).
import { useEffect, useMemo, useState } from 'react'
import { FormSheet, SheetSection, SheetIcon, SheetError, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'
import DateField from '@/components/erp/DateField'
import { storeApi } from '@/lib/api'
import { storePrintApi } from '@/lib/storePrintApi'
import { downloadBlob } from '@/lib/reports/download'
import { extractErrorMessages } from '@/lib/validation'

export type RegisterKind = 'issue' | 'inward' | 'outward' | 'inventory'

const INFO: Record<RegisterKind, { title: string; format: string; subtitle: string }> = {
  issue: { title: 'Print Material Issue Register', format: 'F-STR-05_Material_Issue_Register',
    subtitle: 'Format F/STR/05 — every issued item line in the period, in date and issue number order.' },
  inward: { title: 'Print Gate Inward Register', format: 'F-STR-02_Gate_Inward_Register',
    subtitle: 'Format F/STR/02 — one row per item received on a GRN or a Before-PO receipt in the period.' },
  outward: { title: 'Print Gate Outward Register', format: 'F-STR-03_Gate_Outward_Register',
    subtitle: 'Format F/STR/03 — material that left the gate: issues on a delivery challan (job work, samples, site, service, scrap sold), returns to vendor and transfers to another plant.' },
  inventory: { title: 'Print Inventory Register', format: 'F-STR-06_Inventory_Register',
    subtitle: 'Format F/STR/06 — rack-wise bin card for one month: opening stock, IN and OUT per day, total and balance. One sheet per rack.' },
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

interface StoreOpt { id: number; name: string; code?: string | null }

export default function PrintRegisterSheet({ kind, onClose, defaultLocationId }: {
  kind: RegisterKind; onClose: () => void; defaultLocationId?: number | null
}) {
  const today = new Date()
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(iso(today))
  const [month, setMonth] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
  const [stores, setStores] = useState<StoreOpt[]>([])
  const [locationId, setLocationId] = useState<string>(defaultLocationId ? String(defaultLocationId) : '')
  const [racks, setRacks] = useState<string[]>([])
  const [rack, setRack] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  const info = INFO[kind]
  const isInventory = kind === 'inventory'

  useEffect(() => {
    storeApi.listLocations().then((l: StoreOpt[]) => {
      const sorted = [...l].sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name, undefined, { numeric: true }))
      setStores(sorted)
      // The inventory register is for one store: pre-pick it when there is only one.
      if (isInventory && !defaultLocationId && sorted.length === 1) setLocationId(String(sorted[0].id))
    }).catch((e) => setError(extractErrorMessages(e, 'Could not load your stores — reload the page; if it persists, ask an admin for Store access.')))
  }, [isInventory, defaultLocationId])

  useEffect(() => {
    if (!isInventory || !locationId) return
    storePrintApi.registerRacks(Number(locationId)).then(setRacks).catch(() => setRacks([]))
  }, [isInventory, locationId])

  const pickStore = (v: string) => { setLocationId(v); setRack(''); setRacks([]) }

  // Last 24 months, newest first.
  const months = useMemo(() => Array.from({ length: 24 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  const download = async () => {
    const problems: string[] = []
    if (isInventory) {
      if (!locationId) problems.push('Pick the store whose racks you want to print.')
    } else {
      if (!from || !to) problems.push('Pick both the From and To dates.')
      else if (to < from) problems.push('The To date is before the From date — pick a To date on or after the From date.')
    }
    if (problems.length) { setError(problems); return }
    setBusy(true)
    setError(null)
    try {
      const loc = locationId ? Number(locationId) : null
      const blob = isInventory
        ? await storePrintApi.inventoryRegister({ location_id: Number(locationId), month, rack: rack || null })
        : await (kind === 'issue' ? storePrintApi.issueRegister : kind === 'inward' ? storePrintApi.inwardRegister : storePrintApi.outwardRegister)(
          { date_from: from, date_to: to, location_id: loc })
      const store = stores.find((s) => String(s.id) === locationId)
      const tail = isInventory ? [store?.code || store?.name, month, rack && `rack-${rack}`] : [from, to]
      downloadBlob(blob, `${[info.format, ...tail].filter(Boolean).join('_').replace(/[^A-Za-z0-9_-]+/g, '-')}.xlsx`)
      onClose()
    } catch (e) {
      setError(extractErrorMessages(e, 'The register could not be prepared. Check the filters and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet width={600} icon="doc" title={info.title} subtitle={info.subtitle} onClose={onClose} busy={busy} onSubmit={download}
      tour={`print-register-${kind}`}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="submit" disabled={busy} data-tour="print-register-download" style={sheetBtn('primary', SHEET.BLUE, busy)}>
          <SheetIcon name="doc" size={16} />{busy ? 'Preparing…' : 'Download Excel'}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <SheetSection icon="calendar" title={isInventory ? 'Month' : 'Period'}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {isInventory ? (
              <div style={{ flex: '0 1 220px', minWidth: 180 }}>
                <label style={sheetLabel}>Month <Req /></label>
                <Select style={sheetInput} value={month} onChange={(e) => setMonth(e.target.value)}>
                  {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </Select>
              </div>
            ) : (
              <>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={sheetLabel}>From <Req /></label>
                  <DateField value={from} onChange={setFrom} style={sheetInput} />
                </div>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={sheetLabel}>To <Req /></label>
                  <DateField value={to} onChange={setTo} style={sheetInput} />
                </div>
              </>
            )}
          </div>
          {!isInventory && <p style={sheetHint}>At most one year per print.</p>}
        </SheetSection>
        <SheetSection icon="location" title="Store">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <label style={sheetLabel}>Store {isInventory ? <Req /> : <Optional />}</label>
              <Select style={sheetInput} value={locationId} onChange={(e) => pickStore(e.target.value)}>
                <option value="">{isInventory ? '— pick a store —' : 'All stores I can see'}</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.code ? `${s.code} — ${s.name}` : s.name}</option>)}
              </Select>
            </div>
            {isInventory && (
              <div style={{ flex: '0 1 180px', minWidth: 150 }}>
                <label style={sheetLabel}>Rack <Optional /></label>
                <Select style={sheetInput} value={rack} onChange={(e) => setRack(e.target.value)} disabled={!locationId}>
                  <option value="">{locationId ? 'All racks' : 'Pick a store first'}</option>
                  {racks.map((r) => <option key={r} value={r}>Rack {r}</option>)}
                </Select>
              </div>
            )}
          </div>
          {isInventory && (
            <p style={sheetHint}>
              A bin is printed on the rack it sits in (Store › Bins); a bin without a rack goes on the rack named by the leading
              number of its code (bin 1A → Rack 01). Stock in no bin is printed on a sheet called NO BIN.
            </p>
          )}
        </SheetSection>
      </div>
    </FormSheet>
  )
}
