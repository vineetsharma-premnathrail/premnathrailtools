'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceLookups, MaintenanceSpare } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { recordPath } from '@/lib/recordRef'
import { smallSecondaryBtnStyle, primaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'

const STOCK_HEX: Record<string, string> = { below: '#DC2626', reorder: '#F59E0B', ok: '#16A34A', none: '#78716c' }
const STOCK_LABELS: Record<string, string> = { below: 'Below min', reorder: 'At reorder', ok: 'OK', none: 'No min set' }

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const subHeadStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }

const fmtQty = (q: number | null | undefined) => (q == null ? '—' : `${Math.round(q * 1000) / 1000}`)

function stockState(s: MaintenanceSpare): string {
  if (s.below_min) return 'below'
  if (s.at_reorder) return 'reorder'
  if (s.minimum_stock == null && s.reorder_level == null) return 'none'
  return 'ok'
}

/** Quantity to suggest on the PR: the Store's reorder quantity, else the shortfall to reorder level / minimum. */
function prQty(s: MaintenanceSpare): number {
  return Math.max(1, Math.ceil(s.suggested_order_qty || 1))
}

// PR lines are Item Master items — pass the id; the PR form shows the rest.
function prLine(s: MaintenanceSpare) {
  return { store_item_id: s.store_item_id, make: s.make || '', quantity: prQty(s) }
}

export default function MaintenanceSparesPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('maintenance')
  const router = useRouter()

  const [spares, setSpares] = useState<MaintenanceSpare[]>([])
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [belowMinOnly, setBelowMinOnly] = useState(false)
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [selected, setSelected] = useState<number[]>([])

  const canRaisePr = !!user?.apps?.includes('p2p')

  useEffect(() => {
    if (!isAuthorized) return
    maintenanceApi.getLookups().then(setLookups).catch(() => { /* plant filter is optional */ })
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (branchFilter) params.branch_id = Number(branchFilter)
    if (search.trim()) params.search = search.trim()
    if (belowMinOnly) params.below_min_only = true
    if (criticalOnly) params.critical_only = true
    const t = setTimeout(() => {
      setLoading(true)
      maintenanceApi.listSpares(params)
        .then((data) => {
          const rows = Array.isArray(data) ? data : []
          setSpares(rows)
          setSelected((prev) => prev.filter((id) => rows.some((r) => r.store_item_id === id)))
          setError('')
        })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load spares.')))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [isAuthorized, branchFilter, search, belowMinOnly, criticalOnly])

  const branchName = useMemo(() => {
    const m: Record<number, string> = {}
    for (const b of lookups?.branches || []) m[b.id] = b.name
    return m
  }, [lookups])

  const belowCount = spares.filter((s) => s.below_min).length
  const criticalBelow = spares.filter((s) => s.below_min && s.is_critical).length

  const raisePr = (s: MaintenanceSpare) => {
    const line = prLine(s)
    const params = new URLSearchParams({
      store_item_id: String(line.store_item_id), make: line.make, quantity: String(line.quantity),
      remarks: `Maintenance spares — ${s.item_code} ${s.item_name} below minimum (on hand ${fmtQty(s.on_hand_total)}, min ${fmtQty(s.minimum_stock ?? s.reorder_level)}).`,
    })
    router.push(`/dashboard/p2p/new?${params.toString()}`)
  }

  const raisePrForSelected = () => {
    const rows = spares.filter((s) => selected.includes(s.store_item_id))
    if (!rows.length) return
    try {
      sessionStorage.setItem('p2p_new_prefill', JSON.stringify({
        items: rows.map(prLine),
        remarks: `Maintenance spares — ${rows.length} item(s) below minimum: ${rows.map((s) => s.item_code).join(', ')}.`,
      }))
    } catch {
      setError('Your browser blocked session storage, so the PR form can\'t be pre-filled with several items. Raise the PR one item at a time instead.')
      return
    }
    router.push('/dashboard/p2p/new?prefill=session')
  }

  const toggleSelect = (id: number) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  const belowRows = spares.filter((s) => s.below_min)
  const allBelowSelected = belowRows.length > 0 && belowRows.every((s) => selected.includes(s.store_item_id))

  if (isLoading || !isAuthorized) return null

  const headers = ['', 'Item', 'Used On', 'On Hand', 'Min / Reorder', 'Stock', 'Used (90d)', '']

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Spares</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '6px 0 0' }}>
            Spare parts are Store items — stock, minimum and reorder level come from the Store. Add spares to an asset from its Spares tab.
          </p>
        </div>
        {canRaisePr && (
          <button
            data-tour="maint-spares-pr-selected-btn"
            onClick={raisePrForSelected}
            disabled={!selected.length}
            title={selected.length ? '' : 'Tick the spares to order first'}
            style={{ ...primaryBtnStyle, cursor: selected.length ? 'pointer' : 'not-allowed', opacity: selected.length ? 1 : 0.5 }}
          >
            Raise PR for selected{selected.length ? ` (${selected.length})` : ''}
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {!loading && belowCount > 0 && (
        <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#92400e', fontSize: 13 }}>
          {belowCount} spare{belowCount === 1 ? ' is' : 's are'} below minimum stock{criticalBelow ? `, ${criticalBelow} of them critical` : ''}.
          {canRaisePr ? ' Raise a PR to reorder.' : ' Ask someone with P2P access to raise a purchase request.'}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input data-tour="maint-spares-search" style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200, maxWidth: 420 }} placeholder="Search by item code, name or part number…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {lookups && lookups.branches.length > 1 && (
          <Select data-tour="maint-spares-plant-filter" style={{ ...inputStyle, flex: '0 1 170px' }} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All plants</option>
            {lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        <label data-tour="maint-spares-below-min" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
          <input type="checkbox" checked={belowMinOnly} onChange={(e) => setBelowMinOnly(e.target.checked)} /> Below minimum only
        </label>
        <label data-tour="maint-spares-critical" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
          <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} /> Critical only
        </label>
      </div>

      <div data-tour="maint-spares-table" style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', whiteSpace: 'nowrap', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, width: i === 0 ? 36 : undefined }}>
                  {i === 0 && canRaisePr ? (
                    <input
                      type="checkbox" title="Select every below-minimum spare" checked={allBelowSelected} disabled={!belowRows.length}
                      onChange={() => setSelected(allBelowSelected ? [] : belowRows.map((s) => s.store_item_id))}
                    />
                  ) : h}{i === 1 && <RowCount count={spares.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && spares.length === 0 ? (
              <tr><td colSpan={headers.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : spares.length === 0 ? (
              <tr><td colSpan={headers.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {search || branchFilter || belowMinOnly || criticalOnly
                  ? 'No spares match these filters.'
                  : 'No spares yet. Create spare parts in Store › Items (type Spare Part) or add Store items to an asset\'s bill of spares.'}
              </td></tr>
            ) : (
              spares.map((s) => {
                const state = stockState(s)
                const open = expanded === s.store_item_id
                return (
                  <Fragment key={s.store_item_id}>
                    <tr onClick={() => setExpanded(open ? null : s.store_item_id)} style={{ cursor: 'pointer', background: open ? 'rgba(255,106,42,0.04)' : undefined }}>
                      <td style={cellStyle} onClick={(e) => e.stopPropagation()}>
                        {canRaisePr && (
                          <input type="checkbox" checked={selected.includes(s.store_item_id)} onChange={() => toggleSelect(s.store_item_id)} />
                        )}
                      </td>
                      <td style={cellStyle}>
                        <div style={{ fontWeight: 600, color: TEXT.heading }}>
                          <span style={{ color: TEXT.muted, marginRight: 6 }}>{open ? '▾' : '▸'}</span>
                          {s.item_code}
                          {s.is_critical && (
                            <span style={{ marginLeft: 8 }}><Pill label="Critical" hex="#DC2626" /></span>
                          )}
                        </div>
                        <div style={{ fontSize: 12.5, color: TEXT.secondary }}>
                          {s.item_name}{s.part_number ? ` · ${s.part_number}` : ''}{s.item_type && s.item_type !== 'spare_part' ? ` · ${s.item_type}` : ''}
                        </div>
                      </td>
                      <td style={cellStyle}>{s.assets.length ? `${s.assets.length} asset${s.assets.length === 1 ? '' : 's'}` : '—'}</td>
                      <td style={{ ...cellStyle, fontWeight: 600 }}>{fmtQty(s.on_hand_total)} <span style={{ fontWeight: 400, color: TEXT.muted }}>{s.uom || ''}</span></td>
                      <td style={cellStyle}>{fmtQty(s.minimum_stock)} / {fmtQty(s.reorder_level)}</td>
                      <td style={cellStyle}>
                        <Pill label={STOCK_LABELS[state]} hex={STOCK_HEX[state]} />
                      </td>
                      <td style={cellStyle}>{s.consumed_90d ? fmtQty(s.consumed_90d) : '—'}</td>
                      <td style={cellStyle} onClick={(e) => e.stopPropagation()}>
                        {s.below_min && canRaisePr && (
                          <button onClick={() => raisePr(s)} style={{ ...smallSecondaryBtnStyle, whiteSpace: 'nowrap' }}>
                            Raise PR ({fmtQty(prQty(s))})
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={headers.length} style={{ ...cellStyle, background: 'rgba(255,255,255,0.45)', padding: '14px 18px 16px 50px' }}>
                          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                            <div style={{ flex: '0 1 340px' }}>
                              <p style={subHeadStyle}>Stock by location{branchFilter ? ` (${branchName[Number(branchFilter)] || 'plant'})` : ''}</p>
                              {s.locations.length === 0 ? (
                                <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No stock in any store{branchFilter ? ' of this plant' : ''}.</p>
                              ) : (
                                <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }}>
                                  <tbody>
                                    {s.locations.map((l) => (
                                      <tr key={l.location_id}>
                                        <td style={{ padding: '3px 12px 3px 0', color: TEXT.body }}>
                                          {l.location_name}
                                          {!branchFilter && l.branch_id && branchName[l.branch_id] ? <span style={{ color: TEXT.muted }}> · {branchName[l.branch_id]}</span> : null}
                                        </td>
                                        <td style={{ padding: '3px 12px 3px 0', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtQty(l.on_hand)} {s.uom || ''}</td>
                                        <td style={{ padding: '3px 0', color: TEXT.muted, whiteSpace: 'nowrap' }}>{l.reserved ? `${fmtQty(l.reserved)} reserved` : ''}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                            <div style={{ flex: '1 1 340px' }}>
                              <p style={subHeadStyle}>Used on</p>
                              {s.assets.length === 0 ? (
                                <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Not on any asset&apos;s bill of spares yet.</p>
                              ) : (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {s.assets.map((a) => (
                                    <span
                                      key={a.asset_id}
                                      onClick={() => router.push(recordPath('/dashboard/maintenance/assets', a, 'asset_id'))}
                                      title={`${fmtQty(a.qty_per_replacement)} ${s.uom || ''} per replacement`}
                                      style={{
                                        fontSize: 12, padding: '4px 10px', borderRadius: 9999, cursor: 'pointer',
                                        background: a.is_critical ? '#DC26261a' : 'rgba(120,113,108,0.1)', color: a.is_critical ? '#b91c1c' : TEXT.body,
                                      }}
                                    >
                                      <b>{a.asset_code}</b> {a.asset_name} · {fmtQty(a.qty_per_replacement)}{a.is_critical ? ' · critical' : ''}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {s.reorder_quantity ? (
                                <p style={{ fontSize: 12, color: TEXT.muted, margin: '10px 0 0' }}>Store reorder quantity: {fmtQty(s.reorder_quantity)} {s.uom || ''}</p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
