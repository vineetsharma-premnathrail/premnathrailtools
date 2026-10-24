'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { erpApi } from '@/lib/api'
import { ServiceMaterial } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import { FormSheet, SHEET, SheetIcon, SheetSection, Optional, Req, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

// Spare consumption on a service request (added via the SR's Material Request):
// issue it from Store to site (Material Issue type Service, on a challan),
// and return unused quantity. Every movement posts through the Store ledger
// on the server (erp/spares.py).

const errorBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }

export function IssueSpareDialog({ srId, material, onClose, onDone }: { srId: number; material: ServiceMaterial; onClose: () => void; onDone: () => void }) {
  const [locations, setLocations] = useState<{ id: number; label: string }[]>([])
  const [locationId, setLocationId] = useState(material.location_id ? String(material.location_id) : '')
  const outstanding = Math.max(0, (material.quantity || 0) - (material.qty_issued || 0))
  const [qty, setQty] = useState(String(outstanding || 1))
  const [challan, setChallan] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    erpApi.listSrIssueLocations(srId).then(setLocations).catch((e) => setError(extractErrorMessages(e, 'Could not load the stores.').join(' ')))
  }, [srId])
  const submit = async () => {
    setError('')
    const q = Number(qty)
    if (!locationId) { setError('Pick the store the spare leaves from.'); return }
    if (!(q > 0)) { setError('Quantity must be more than 0.'); return }
    if (!challan.trim()) { setError('Enter the delivery challan no. — spares going to site always travel on a challan.'); return }
    setBusy(true)
    try {
      await erpApi.issueMaterialFromStore(srId, material.id, { location_id: Number(locationId), quantity: q, challan_number: challan.trim(), vehicle_number: vehicle.trim() || undefined })
      onDone()
    } catch (e) {
      setError(extractErrorMessages(e, 'Could not issue the spare.').join(' '))
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormSheet width={580} icon="truck" title="Issue from Store" subtitle={`${material.material_name} — leaves Store as a Service issue on a delivery challan.`}
      onClose={onClose} busy={busy}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="truck" size={16} />{busy ? 'Issuing…' : 'Issue'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && <div style={errorBox}>{error}</div>}
        <SheetSection icon="box" title="Spare">
          <label style={sheetLabel}>Store <Req /></label>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!!material.location_id} style={sheetInput}>
            <option value="">— Select store —</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </Select>
          <div style={{ maxWidth: 140, marginTop: 14 }}>
            <label style={sheetLabel}>Qty ({material.unit}) <Req /></label>
            <input type="number" min={0} step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} style={sheetInput} />
          </div>
        </SheetSection>
        <SheetSection icon="truck" title="Dispatch">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
              <label style={sheetLabel}>Delivery challan no. <Req /></label>
              <input value={challan} onChange={(e) => setChallan(e.target.value)} style={sheetInput} />
            </div>
            <div style={{ flex: '1 1 180px', maxWidth: 240 }}>
              <label style={sheetLabel}>Vehicle / courier no. <Optional /></label>
              <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} style={sheetInput} />
            </div>
          </div>
          <p style={sheetHint}>Spares going to site always travel on a challan.</p>
        </SheetSection>
      </div>
    </FormSheet>
  )
}

export function ReturnSpareDialog({ srId, material, onClose, onDone }: { srId: number; material: ServiceMaterial; onClose: () => void; onDone: () => void }) {
  const out = material.net_issued ?? Math.max(0, (material.qty_issued || 0) - (material.qty_returned || 0))
  const [qty, setQty] = useState(String(out))
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setError('')
    const q = Number(qty)
    if (!(q > 0)) { setError('Quantity must be more than 0.'); return }
    if (q > out + 1e-9) { setError(`Only ${out} ${material.unit} is still out on this SR.`); return }
    setBusy(true)
    try {
      await erpApi.returnMaterialToStore(srId, material.id, { quantity: q, remarks: remarks.trim() || undefined })
      onDone()
    } catch (e) {
      setError(extractErrorMessages(e, 'Could not return the spare.').join(' '))
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormSheet width={580} icon="undo" title="Return unused" subtitle={`${material.material_name} — ${out} ${material.unit} is out on this SR. It goes back into the store it was issued from.`}
      onClose={onClose} busy={busy}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="undo" size={16} />{busy ? 'Returning…' : 'Return to Store'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && <div style={errorBox}>{error}</div>}
        <SheetSection icon="box" title="Quantity">
          <div style={{ maxWidth: 140 }}>
            <label style={sheetLabel}>Qty ({material.unit}) <Req /></label>
            <input type="number" min={0} step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} style={sheetInput} />
          </div>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks <Optional /></label>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} style={sheetInput} />
        </SheetSection>
      </div>
    </FormSheet>
  )
}
