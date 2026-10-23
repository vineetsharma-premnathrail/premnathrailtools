'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { physicalCountsApi, storeApi } from '@/lib/api'
import { StorePhysicalCount } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

const STATUS_LABELS: Record<string, string> = { counting: 'Counting (stock frozen)', submitted: 'Awaiting approval', posted: 'Posted', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { counting: '#d97706', submitted: '#2563eb', posted: '#16a34a', cancelled: '#94a3b8' }

// Physical stock count list + start a new count. A count freezes the counted
// items at that store until it is submitted or cancelled.
export default function PhysicalCountListPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const { canFeature } = useCan()
  // Store › Adjustments › Physical / cycle count (this page) › Create = start a count.
  const seeCounts = canFeature('store', 'adjustments', 'cycle_count', 'view')
  const canCreate = canFeature('store', 'adjustments', 'cycle_count', 'create')
  const router = useRouter()
  const [counts, setCounts] = useState<StorePhysicalCount[]>([])
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([])
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([])
  const [locationId, setLocationId] = useState('')
  const [category, setCategory] = useState('')
  const [blind, setBlind] = useState(true)
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [showStart, setShowStart] = useState(false)

  const openStart = () => { setError(''); setLocationId(''); setCategory(''); setBlind(true); setRemarks(''); setShowStart(true) }

  useEffect(() => {
    if (!isAuthorized || !seeCounts) return
    physicalCountsApi.list().then(setCounts).catch((err) => setError(extractErrorMessages(err, 'Could not load physical counts.')))
    storeApi.listLocations().then(setLocations).catch(() => setLocations([]))
    storeApi.listCategories().then(setCategories).catch(() => setCategories([]))
  }, [isAuthorized, seeCounts])

  const start = async () => {
    if (!locationId) { setError('Pick the store to count.'); return }
    setBusy(true)
    try {
      const c: StorePhysicalCount = await physicalCountsApi.create({
        location_id: Number(locationId), category: category || undefined, blind, remarks: remarks.trim() || undefined,
      })
      router.push(recordPath('/dashboard/store/cycle-count', c))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not start the count.'))
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (!seeCounts) return (
    <div>
      <StoreNav />
      <p style={{ fontSize: 13, color: TEXT.muted }}>
        You don&apos;t have View on Store › Adjustments › Physical / cycle count. Ask your admin to add it to your role in Organization › Roles &amp; Permissions.
      </p>
    </div>
  )

  return (
    <div>
      <StoreNav />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Store & Inventory</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Physical Count</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0, maxWidth: 720 }}>
            Count what is on the shelf against the books. Counted items are frozen at that store while counting; differences go to a Store Manager for approval before stock changes.
          </p>
        </div>
        {canCreate && (
          <button data-tour="store-count-new" type="button" onClick={openStart} style={primaryBtnStyle}>
            <span style={{ fontSize: 17, lineHeight: 1, marginRight: 6 }}>+</span> Start Count
          </button>
        )}
      </div>
      <MessageDialog open={!!error && !showStart} variant="error" title="Physical Count" message={error} onClose={() => setError('')} />

      {showStart && (
        <FormSheet width={580} icon="list" title="Start a Count" subtitle="Book stock is snapshotted and the counted items are frozen at that store until the count is submitted or cancelled."
          onClose={() => setShowStart(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setShowStart(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" disabled={busy} onClick={start} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Starting…' : 'Start count'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {(Array.isArray(error) ? error.length > 0 : !!error) && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {(Array.isArray(error) ? error : [error]).map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
            <SheetSection icon="building" title="Scope">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>Store <Req /></label>
                  <select style={sheetInput} value={locationId} onChange={(e) => setLocationId(e.target.value)} autoFocus>
                    <option value="">Select store…</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>Category</label>
                  <select style={sheetInput} value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">All stocked items</option>
                    {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: SHEET.BODY, marginTop: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> Blind count (counters don&apos;t see book stock)
              </label>
              <p style={sheetHint}>Blind is recommended — counters count what is really there instead of confirming the system figure.</p>
            </SheetSection>
            <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
              <input style={sheetInput} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Year-end count 2026-27" />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <div data-tour="store-count-list" style={{ ...sectionStyle, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr>
            {['Count No.', 'Store', 'Date', 'Scope', 'Lines', 'Status', 'Adjustment'].map((h) => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {counts.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 14, fontSize: 13, color: TEXT.muted }}>No physical counts yet.</td></tr>
            ) : counts.map((c) => (
              <tr key={c.id} onClick={() => router.push(recordPath('/dashboard/store/cycle-count', c))} style={{ cursor: 'pointer' }}>
                <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 700 }}>{c.count_number}</td>
                <td style={{ padding: '8px 10px', fontSize: 13 }}>{c.location_name}</td>
                <td style={{ padding: '8px 10px', fontSize: 13 }}>{formatDate(c.count_date)}</td>
                <td style={{ padding: '8px 10px', fontSize: 13 }}>{c.scope || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 13 }}>{c.lines_counted}/{c.lines_total} counted</td>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[c.status]}1a`, color: STATUS_HEX[c.status], whiteSpace: 'nowrap' }}>{STATUS_LABELS[c.status] || c.status}</span>
                </td>
                <td style={{ padding: '8px 10px', fontSize: 13 }}>{c.adjustment_number || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
