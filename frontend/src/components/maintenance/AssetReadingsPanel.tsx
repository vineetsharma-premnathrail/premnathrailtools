'use client'

import { useEffect, useState } from 'react'
import { maintenanceCountersApi, MeasurementDoc, MeasuringPointList } from '@/lib/eamApi'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import { TEXT, BORDER } from '@/lib/theme'
import { smallSecondaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import PortalFormDialog from '@/components/maintenance/PortalFormDialog'
import { SHEET, SheetSection, Optional, Req, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'

const STATE_LABELS: Record<string, string> = { ok: 'Within limits', below_limit: 'Below limit', above_limit: 'Above limit' }
const STATE_HEX: Record<string, string> = { ok: '#16A34A', below_limit: '#DC2626', above_limit: '#DC2626' }
const SOURCE_LABELS: Record<string, string> = { manual: 'Manual', scan: 'QR scan', wo_completion: 'WO completion' }

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', position: 'sticky', top: 0, zIndex: 1 }
const tdStyle: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const smallBtn: React.CSSProperties = smallSecondaryBtnStyle
const fmt = (v: number | null | undefined) => (v == null ? '—' : String(Number(v.toFixed(2))))

/** IK01-IK17: the asset's main counter, extra measuring points with limits
 * and the reading history. A counter never goes backwards (admins can book
 * a meter reset with a reason); a reading outside a point's limits raises an
 * abnormality request; a main-counter reading can raise a counter-based PM job. */
export default function AssetReadingsPanel({ assetId, onChanged }: { assetId: number; onChanged?: () => void }) {
  const { can, canFeature, user } = useCan()
  // Assets › Meter readings feature on top of the tab rights (core/features/maintenance.py).
  const canRead = canFeature('maintenance', 'assets', 'readings', 'create') && (can('maintenance', 'assets', 'edit') || can('maintenance', 'work_orders', 'edit'))
  const canPoints = canFeature('maintenance', 'assets', 'readings', 'edit')
  const [points, setPoints] = useState<MeasuringPointList | null>(null)
  const [docs, setDocs] = useState<MeasurementDoc[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [readOpen, setReadOpen] = useState(false)
  const [rd, setRd] = useState({ measuring_point_id: '', reading: '', remarks: '', override_reason: '' })
  const [pointOpen, setPointOpen] = useState(false)
  const [pt, setPt] = useState({ name: '', unit: '', is_counter: false, lower_limit: '', upper_limit: '', target_value: '' })
  const [dialogError, setDialogError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    Promise.all([maintenanceCountersApi.listPoints(assetId), maintenanceCountersApi.listReadings(assetId, { limit: 2000 })])
      .then(([p, d]) => { setPoints(p); setDocs(d); setError('') })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the readings — reload the page.')))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [assetId])

  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  const submitReading = async () => {
    setBusy(true)
    try {
      const doc = await maintenanceCountersApi.postReading(assetId, {
        reading: num(rd.reading), measuring_point_id: rd.measuring_point_id ? Number(rd.measuring_point_id) : null,
        remarks: rd.remarks || null, override_reason: rd.override_reason || null,
      })
      const bits = [`Reading ${fmt(doc.reading)} saved.`]
      if (doc.request_number) bits.push(`Outside its limits — request ${doc.request_number} raised.`)
      if (doc.generated_work_orders?.length) bits.push(`PM job ${doc.generated_work_orders.map((w) => w.wo_number).join(', ')} raised.`)
      setNotice(bits.join(' '))
      setReadOpen(false)
      load()
      onChanged?.()
    } catch (err) {
      setDialogError(extractErrorMessages(err, 'Could not save the reading.'))
    } finally { setBusy(false) }
  }

  const submitPoint = async () => {
    setBusy(true)
    try {
      await maintenanceCountersApi.createPoint(assetId, {
        name: pt.name, unit: pt.unit, is_counter: pt.is_counter, lower_limit: num(pt.lower_limit), upper_limit: num(pt.upper_limit), target_value: num(pt.target_value),
      })
      setPointOpen(false)
      load()
    } catch (err) {
      setDialogError(extractErrorMessages(err, 'Could not add the measuring point.'))
    } finally { setBusy(false) }
  }

  const main = points?.main_counter
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <p style={{ fontSize: 13, color: TEXT.body, margin: 0 }}>
          Main counter: <b>{main?.meter_unit ? `${fmt(main.current_reading)} ${main.meter_unit}` : 'none (set the meter unit on the asset)'}</b>
          {main?.updated_at && <span style={{ color: TEXT.muted }}> · {formatDateTime(main.updated_at)}</span>}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {canRead && <button type="button" style={smallBtn} onClick={() => { setRd({ measuring_point_id: '', reading: '', remarks: '', override_reason: '' }); setDialogError(''); setReadOpen(true) }}>+ Enter reading</button>}
          {canPoints && <button type="button" style={smallBtn} onClick={() => { setPt({ name: '', unit: '', is_counter: false, lower_limit: '', upper_limit: '', target_value: '' }); setDialogError(''); setPointOpen(true) }}>+ Measuring point</button>}
        </div>
      </div>
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {notice && <p style={{ fontSize: 12.5, color: '#16A34A', margin: '0 0 10px' }}>{notice}</p>}

      {points && points.points.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          {points.points.map((p) => (
            <div key={p.id} style={{ border: `1px solid ${BORDER.light}`, borderRadius: 12, padding: '10px 12px', minWidth: 180 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary }}>{p.name}{p.is_counter ? ' (counter)' : ''}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: TEXT.body }}>{fmt(p.current_reading)} {p.unit}</div>
              <div style={{ fontSize: 11.5, color: TEXT.muted }}>Limits {fmt(p.lower_limit)} – {fmt(p.upper_limit)}</div>
              {p.limit_state && (
                <Pill label={STATE_LABELS[p.limit_state]} hex={STATE_HEX[p.limit_state]} />
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ overflow: 'auto', maxHeight: 420 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead><tr>{['Read at', 'Point', 'Reading', 'Change', 'Source', 'By', 'Note'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={docs.length} />}</th>)}</tr></thead>
          <tbody>
            {docs.length === 0 && <tr><td colSpan={7} style={{ ...tdStyle, color: TEXT.muted }}>No readings yet.</td></tr>}
            {docs.map((d) => (
              <tr key={d.id}>
                <td style={tdStyle}>{formatDateTime(d.read_at)}</td>
                <td style={tdStyle}>{d.point_name}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: d.limit_breach ? '#DC2626' : TEXT.body }}>{fmt(d.reading)} {d.unit || main?.meter_unit || ''}</td>
                <td style={tdStyle}>{d.difference == null ? '—' : (d.difference > 0 ? `+${fmt(d.difference)}` : fmt(d.difference))}</td>
                <td style={tdStyle}>{SOURCE_LABELS[d.source] || d.source}</td>
                <td style={tdStyle}>{d.read_by_name || '—'}</td>
                <td style={{ ...tdStyle, fontSize: 12 }}>
                  {d.limit_breach && <span style={{ color: '#DC2626' }}>{d.limit_breach === 'high' ? 'Above' : 'Below'} limit. </span>}
                  {d.override_reason && <span>Counter reset: {d.override_reason}. </span>}
                  {d.remarks}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PortalFormDialog open={readOpen} icon="gear" title="Enter reading"
        subtitle="A reading outside the limits raises an abnormality request; a main-counter reading can raise a PM job."
        error={dialogError} busy={busy} confirmLabel="Save reading"
        onCancel={() => setReadOpen(false)} onConfirm={submitReading}>
        <SheetSection icon="gear" title="Reading">
          <label style={sheetLabel}>Measuring point</label>
          <Select style={sheetInput} value={rd.measuring_point_id} onChange={(e) => setRd({ ...rd, measuring_point_id: e.target.value })}>
            {main?.meter_unit && <option value="">Main counter ({main.meter_unit})</option>}
            {(points?.points || []).filter((p) => p.is_active).map((p) => <option key={p.id} value={String(p.id)}>{p.name} ({p.unit})</option>)}
          </Select>
          <div style={{ maxWidth: 200, marginTop: 14 }}>
            <label style={sheetLabel}>Reading <Req /></label>
            <input style={sheetInput} type="number" value={rd.reading} onChange={(e) => setRd({ ...rd, reading: e.target.value })} />
          </div>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks <Optional /></label>
          <input style={sheetInput} value={rd.remarks} onChange={(e) => setRd({ ...rd, remarks: e.target.value })} />
        </SheetSection>
        {user?.role === 'admin' && (
          <SheetSection icon="undo" title="Counter reset" extra={<Optional />}>
            <label style={sheetLabel}>Counter reset reason (admin — only when the reading is lower than the last)</label>
            <input style={sheetInput} value={rd.override_reason} onChange={(e) => setRd({ ...rd, override_reason: e.target.value })} placeholder="e.g. Hour meter replaced" />
          </SheetSection>
        )}
      </PortalFormDialog>

      <PortalFormDialog open={pointOpen} icon="plus" title="Add measuring point"
        subtitle="An extra point to read on this asset, with optional limits."
        error={dialogError} busy={busy} confirmLabel="Add point"
        onCancel={() => setPointOpen(false)} onConfirm={submitPoint}>
        <SheetSection icon="list" title="Point">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <label style={sheetLabel}>Name <Req /></label>
              <input style={sheetInput} value={pt.name} onChange={(e) => setPt({ ...pt, name: e.target.value })} placeholder="Hydraulic oil temperature" />
            </div>
            <div style={{ flex: '0 1 100px' }}>
              <label style={sheetLabel}>Unit <Req /></label>
              <input style={sheetInput} value={pt.unit} onChange={(e) => setPt({ ...pt, unit: e.target.value })} placeholder="°C" />
            </div>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: SHEET.BODY, marginTop: 14 }}>
            <input type="checkbox" checked={pt.is_counter} onChange={(e) => setPt({ ...pt, is_counter: e.target.checked })} />
            Counter (only goes up — running hours, km, strokes)
          </label>
        </SheetSection>
        <SheetSection icon="flag" title="Limits" extra={<Optional />}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {(['lower_limit', 'upper_limit', 'target_value'] as const).map((k) => (
              <div key={k} style={{ flex: '0 1 120px' }}>
                <label style={sheetLabel}>{k === 'lower_limit' ? 'Lower limit' : k === 'upper_limit' ? 'Upper limit' : 'Target'}</label>
                <input style={sheetInput} type="number" value={pt[k]} onChange={(e) => setPt({ ...pt, [k]: e.target.value })} />
              </div>
            ))}
          </div>
        </SheetSection>
      </PortalFormDialog>
    </div>
  )
}
