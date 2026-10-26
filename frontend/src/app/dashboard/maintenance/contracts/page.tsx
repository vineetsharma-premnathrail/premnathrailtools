'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceContractList, MaintenanceContractStatus, MaintenanceLookups } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { recordPath } from '@/lib/recordRef'
import { secondaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'

const STATUS_LABELS: Record<string, string> = { expired: 'Expired', expiring: 'Expiring', active: 'Active', none: 'Not covered' }
const STATUS_HEX: Record<string, string> = { expired: '#DC2626', expiring: '#F59E0B', active: '#16A34A', none: '#78716c' }
const KIND_LABELS: Record<string, string> = { warranty: 'Warranty', amc: 'AMC' }
const KIND_HEX: Record<string, string> = { warranty: '#2563EB', amc: '#7C3AED' }
const CRIT_HEX: Record<string, string> = { A: '#DC2626', B: '#F59E0B', C: '#78716c' }
const WINDOW_OPTIONS = [30, 60, 90, 180]

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(),
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}-${m}-${y}`
}

function daysLeftText(days: number | null | undefined): string {
  if (days == null) return 'No date'
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} ago`
  if (days === 0) return 'Today'
  return `${days} day${days === 1 ? '' : 's'}`
}

async function blobError(err: unknown, fallback: string): Promise<string> {
  if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
    try {
      const parsed = JSON.parse(await err.response.data.text())
      if (parsed?.detail) return String(parsed.detail)
    } catch { /* not JSON */ }
  }
  return extractErrorMessages(err, fallback).join(' ')
}

export default function MaintenanceContractsPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const { can } = useCan()
  const router = useRouter()

  const [data, setData] = useState<MaintenanceContractList | null>(null)
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [kind, setKind] = useState<'all' | 'warranty' | 'amc'>('all')
  const [windowDays, setWindowDays] = useState(60)
  const [status, setStatus] = useState<MaintenanceContractStatus | ''>('')

  useEffect(() => {
    if (!isAuthorized) return
    maintenanceApi.getLookups().then(setLookups).catch(() => { /* plant filter is optional */ })
  }, [isAuthorized])

  const params = (): Record<string, unknown> => {
    const p: Record<string, unknown> = { kind, window_days: windowDays }
    if (branchFilter) p.branch_id = Number(branchFilter)
    if (status) p.status = status
    if (search.trim()) p.search = search.trim()
    return p
  }

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(() => {
      setLoading(true)
      maintenanceApi.listContracts(params())
        .then((d) => { setData(d); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load AMC & warranty list.').join(' ')))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, branchFilter, kind, windowDays, status, search])

  const exportExcel = async () => {
    setExporting(true)
    try {
      const blob = await maintenanceApi.exportContracts(params())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `maintenance_amc_warranty_${(data?.as_of || new Date().toISOString()).slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(await blobError(err, 'Export failed.'))
    } finally {
      setExporting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  const s = data?.summary
  const items = data?.items || []
  const tiles: { key: MaintenanceContractStatus; label: string; caption: string }[] = [
    { key: 'expired', label: 'Expired', caption: 'Cover has lapsed — repairs are now chargeable.' },
    { key: 'expiring', label: `Expiring ≤ ${windowDays} days`, caption: 'Renew or claim before the date.' },
    { key: 'active', label: 'Active', caption: `Covered beyond the next ${windowDays} days.` },
    { key: 'none', label: 'Not covered', caption: 'No expiry date recorded on the asset.' },
  ]
  const headers = ['Asset', 'Plant', 'Crit.', 'Cover', 'Vendor', 'Expiry Date', 'Days Left', 'Status', '']
  const filtered = !!(search || branchFilter || status || kind !== 'all')

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 820 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>AMC &amp; Warranty</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '6px 0 0', lineHeight: 1.5 }}>
            <b>Warranty</b> is the maker&apos;s / supplier&apos;s promise to repair defects free for a fixed period after purchase — it comes with the machine.{' '}
            <b>AMC</b> (Annual Maintenance Contract) is a service contract you pay a vendor for, covering periodic servicing and breakdown support.
            Once either lapses, every repair is billed. Dates and vendors are edited on the asset; planners get a reminder 30, 15, 7 and 1 day before expiry and the day after.
          </p>
        </div>
        {can('maintenance', 'assets', 'export') && <button data-tour="maint-amc-export-btn" onClick={exportExcel} disabled={exporting || !items.length} style={{ ...secondaryBtnStyle, opacity: exporting || !items.length ? 0.6 : 1 }}>
          {exporting ? 'Exporting…' : 'Export Excel'}
        </button>}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div data-tour="maint-amc-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 18 }}>
        {tiles.map((t) => {
          const active = status === t.key
          const hex = STATUS_HEX[t.key]
          return (
            <div
              key={t.key}
              onClick={() => setStatus(active ? '' : t.key)}
              title={active ? 'Click again to show all' : `Show only ${STATUS_LABELS[t.key].toLowerCase()}`}
              style={{ ...cardStyle, padding: 16, cursor: 'pointer', borderLeft: `4px solid ${hex}`, outline: active ? `2px solid ${hex}` : 'none' }}
            >
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{t.label}</p>
              <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: hex }}>{s ? s[t.key] : '—'}</p>
              <p style={{ fontSize: 11.5, lineHeight: 1.4, color: TEXT.muted, margin: '6px 0 0' }}>{t.caption}</p>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input data-tour="maint-amc-search" style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200, maxWidth: 380 }} placeholder="Search by asset code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {lookups && lookups.branches.length > 1 && (
          <Select data-tour="maint-amc-plant-filter" style={{ ...inputStyle, flex: '0 1 170px' }} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All plants</option>
            {lookups.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
        <Select data-tour="maint-amc-kind-filter" style={{ ...inputStyle, flex: '0 1 160px' }} value={kind} onChange={(e) => setKind(e.target.value as 'all' | 'warranty' | 'amc')}>
          <option value="all">Warranty + AMC</option>
          <option value="warranty">Warranty only</option>
          <option value="amc">AMC only</option>
        </Select>
        <Select data-tour="maint-amc-status-filter" style={{ ...inputStyle, flex: '0 1 150px' }} value={status} onChange={(e) => setStatus(e.target.value as MaintenanceContractStatus | '')}>
          <option value="">Any status</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <label data-tour="maint-amc-window" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.secondary }}>
          Expiring within
          <Select style={{ ...inputStyle, width: 120 }} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
            {WINDOW_OPTIONS.map((d) => <option key={d} value={d}>{d} days</option>)}
          </Select>
        </label>
      </div>

      <div data-tour="maint-amc-table" style={{ ...cardStyle, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', whiteSpace: 'nowrap', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}{i === 0 && <RowCount count={items.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr><td colSpan={headers.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={headers.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                {filtered
                  ? 'No assets match these filters.'
                  : 'No assets in the register yet. Add assets under Maintenance › Assets and record their warranty / AMC expiry there.'}
              </td></tr>
            ) : (
              items.map((r) => {
                const hex = STATUS_HEX[r.status]
                const go = () => router.push(recordPath('/dashboard/maintenance/assets', r, 'asset_id'))
                return (
                  <tr key={`${r.asset_id}-${r.kind}`} onClick={go} style={{ cursor: 'pointer' }}>
                    <td style={cellStyle}>
                      <div style={{ fontWeight: 600, color: TEXT.heading }}>{r.asset_code}</div>
                      <div style={{ fontSize: 12.5, color: TEXT.secondary }}>{r.asset_name}</div>
                    </td>
                    <td style={cellStyle}>{r.branch_name || '—'}</td>
                    <td style={cellStyle}>
                      <Pill label={r.criticality} hex={CRIT_HEX[r.criticality] || '#78716c'} />
                    </td>
                    <td style={cellStyle}>
                      <Pill label={KIND_LABELS[r.kind]} hex={KIND_HEX[r.kind]} />
                    </td>
                    <td style={cellStyle}>{r.vendor_name || <span style={{ color: TEXT.muted }}>—</span>}</td>
                    <td style={cellStyle}>{fmtDate(r.expiry_date)}</td>
                    <td style={cellStyle}>
                      <Pill label={daysLeftText(r.days_left)} hex={hex} />
                    </td>
                    <td style={cellStyle}>
                      <Pill label={STATUS_LABELS[r.status] || r.status} hex={hex} />
                    </td>
                    <td style={cellStyle} onClick={(e) => e.stopPropagation()}>
                      <span onClick={go} style={{ color: '#ea580c', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>View</span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {data && (
        <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '10px 2px 0' }}>
          As of {fmtDate(data.as_of)} · decommissioned assets are not listed · warranty vendor = the supplier the asset was bought from.
        </p>
      )}
    </div>
  )
}
