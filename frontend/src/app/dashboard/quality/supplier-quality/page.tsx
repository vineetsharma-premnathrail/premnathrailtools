'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPath } from '@/lib/recordRef'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { qualityApi } from '@/lib/api'
import { QualityApprovedVendor, QualitySupplierScorecard, QualityVendorAudit, QualityVendorSummary } from '@/types'
import { TEXT } from '@/lib/theme'
import QualityNav from '@/components/quality/QualityNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'
import { useCan } from '@/lib/permissions'
import {
  Pill, PageHeader, ErrorBanner, ActionSheet, sheetGap, tableWrapStyle, thStyle, tdStyle, filterInputStyle, fmtDate,
  AVL_STATUS_LABELS, AVL_STATUS_HEX, SAMPLING_LABELS,
} from '@/components/quality/QualityBits'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'

type Tab = 'vendors' | 'avl' | 'ratings' | 'audits'
const TABS: [Tab, string][] = [['vendors', 'Vendors'], ['avl', 'Approved vendor list'], ['ratings', 'Monthly rating'], ['audits', 'Vendor audits']]
const BAND_HEX: Record<string, string> = { approved: '#16A34A', on_watch: '#F59E0B', blocked: '#DC2626' }
const score = (v?: number | null) => (v === null || v === undefined ? '—' : v.toFixed(1))

interface Meta { limits: { watch_below: number; block_below: number; weights: Record<string, number> }; ncr_points: Record<string, number>; previous_period: string }

export default function SupplierQualityPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const { can } = useCan()
  const canCreate = can('quality', 'supplier_quality', 'create')
  const canEdit = can('quality', 'supplier_quality', 'edit')
  const [scheduling, setScheduling] = useState(false)
  const [sheetError, setSheetError] = useState<string | string[]>('')
  const [tab, setTab] = useState<Tab>('vendors')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [vendors, setVendors] = useState<QualityVendorSummary[]>([])
  const [avl, setAvl] = useState<QualityApprovedVendor[]>([])
  const [ratings, setRatings] = useState<QualitySupplierScorecard[]>([])
  const [audits, setAudits] = useState<QualityVendorAudit[]>([])
  const [users, setUsers] = useState<{ id: number; name: string }[]>([])
  // Role assign-to rule (core/features/quality.py) — the server enforces it on save too.
  const allowAuditor = useAssigneeFilter('quality:supplier_quality.audits')
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [avlStatus, setAvlStatus] = useState('')
  const [pendingOnly, setPendingOnly] = useState(false)
  const [period, setPeriod] = useState('')
  const [audit, setAudit] = useState({ vendor_name: '', planned_date: '', scope: '', auditor_id: '' })
  const [completing, setCompleting] = useState<number | null>(null)
  const [result, setResult] = useState({ audit_date: '', score: '', result: 'satisfactory', findings: '', remarks: '' })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!isAuthorized) return
    qualityApi.getSupplierMeta().then((m) => { setMeta(m); setPeriod((p) => p || m.previous_period) }).catch(() => setMeta(null))
    qualityApi.lookupUsers().then(setUsers).catch(() => setUsers([]))
  }, [isAuthorized])

  useEffect(() => {
    if (!isAuthorized) return
    const fail = (err: unknown) => setError(extractErrorMessages(err, 'Failed to load supplier quality data.'))
    if (tab === 'vendors') qualityApi.listVendorSummary().then(setVendors).catch(fail)
    if (tab === 'avl') {
      const params: Record<string, unknown> = {}
      if (avlStatus) params.status = avlStatus
      if (pendingOnly) params.pending_only = true
      if (search.trim()) params.search = search.trim()
      qualityApi.listAvl(params).then(setAvl).catch(fail)
    }
    if (tab === 'ratings') qualityApi.listRatings(period ? { period } : {}).then(setRatings).catch(fail)
    if (tab === 'audits') qualityApi.listVendorAudits().then(setAudits).catch(fail)
  }, [isAuthorized, tab, avlStatus, pendingOnly, search, period, reload])

  const act = async (fn: () => Promise<unknown>, fallback: string, after?: () => void, setErr: (e: string | string[]) => void = setError) => {
    setErr('')
    setBusy(true)
    try {
      await fn()
      after?.()
      setReload((r) => r + 1)
    } catch (err) {
      setErr(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <QualityNav />
      <PageHeader title="Supplier Quality">
        {canCreate && tab === 'audits' && <button type="button" onClick={() => { setSheetError(''); setScheduling(true) }} style={secondaryBtnStyle}>+ Schedule audit</button>}
        {canCreate && <button type="button" onClick={() => router.push('/dashboard/quality/supplier-quality/new')} style={primaryBtnStyle}>+ Add vendor for an item</button>}
      </PageHeader>
      <ErrorBanner error={error} />
      {meta && (
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 12px' }}>
          Monthly score = quality {meta.limits.weights.quality}% (accepted ÷ received) + delivery {meta.limits.weights.delivery}% (GRN on/before PO date)
          + NCR {meta.limits.weights.ncr}% (100 − {meta.ncr_points.minor}/{meta.ncr_points.major}/{meta.ncr_points.critical} per minor/major/critical NCR).
          Below {meta.limits.watch_below} → On watch (tightened sampling + vendor CAPA); below {meta.limits.block_below} → Blocked after a Partner approves.
        </p>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            style={{ ...secondaryBtnStyle, background: tab === k ? '#FF6A2A1a' : undefined, color: tab === k ? '#c2410c' : undefined }}>{l}</button>
        ))}
      </div>

      {tab === 'vendors' && (
        <div style={tableWrapStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr>{['Vendor', 'Items', 'Trial', 'Approved', 'On watch', 'Blocked', 'Waiting for Partner', 'Last score', 'Vendor CAPA'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {vendors.length === 0 ? (
                <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No vendors yet — vendors are added automatically when they first supply an inspection-controlled item.</td></tr>
              ) : vendors.map((v) => (
                <tr key={v.vendor_name} onClick={() => { setSearch(v.vendor_name); setTab('avl') }} style={{ cursor: 'pointer' }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{v.vendor_name}</td>
                  <td style={tdStyle}>{v.items}</td><td style={tdStyle}>{v.trial}</td><td style={tdStyle}>{v.approved}</td>
                  <td style={{ ...tdStyle, color: v.on_watch ? '#b45309' : undefined }}>{v.on_watch}</td>
                  <td style={{ ...tdStyle, color: v.blocked ? '#DC2626' : undefined }}>{v.blocked}</td>
                  <td style={tdStyle}>{v.pending || '—'}</td>
                  <td style={tdStyle}>{v.last_score != null ? `${score(v.last_score)} (${v.last_period})` : '—'}</td>
                  <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                    {v.open_capa ? <span onClick={() => router.push(recordPath('/dashboard/quality/capa', v.open_capa))} style={{ color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>{v.open_capa.capa_number}</span> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'avl' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...filterInputStyle, flex: '1 1 240px', maxWidth: 380 }} placeholder="Search vendor or item…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select style={{ ...filterInputStyle, flex: '0 1 170px' }} value={avlStatus} onChange={(e) => setAvlStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(AVL_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} /> Waiting for a Partner
            </label>
          </div>
          <div style={tableWrapStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead><tr>{['Vendor', 'Item', 'Status', 'Sampling', 'Accepted in a row', 'Last score', 'Valid until', 'Pending', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {avl.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Nothing on the list for this filter.</td></tr>
                ) : avl.map((a) => (
                  <tr key={a.id} onClick={() => router.push(recordPath('/dashboard/quality/supplier-quality', a))} style={{ cursor: 'pointer' }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{a.vendor_name}</td>
                    <td style={tdStyle}>{a.item_code ? `${a.item_code} — ` : ''}{a.item_name}</td>
                    <td style={tdStyle}><Pill text={AVL_STATUS_LABELS[a.status]} hex={AVL_STATUS_HEX[a.status]} /></td>
                    <td style={tdStyle}>{SAMPLING_LABELS[a.sampling_state]}{a.skip_lot_active ? ' · skip-lot' : ''}</td>
                    <td style={tdStyle}>{a.consecutive_accepted}</td>
                    <td style={tdStyle}>{a.last_score != null ? `${score(a.last_score)} (${a.last_rated_period})` : '—'}</td>
                    <td style={{ ...tdStyle, color: a.expired ? '#DC2626' : undefined }}>{fmtDate(a.valid_until)}{a.expired ? ' · re-evaluate' : ''}</td>
                    <td style={tdStyle}>{a.pending_action ? `${a.pending_action} (Partner)` : '—'}</td>
                    <td onClick={(e) => e.stopPropagation()} style={tdStyle}>
                      <span onClick={() => router.push(recordPath('/dashboard/quality/supplier-quality', a))} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'ratings' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="month" style={{ ...filterInputStyle, flex: '0 1 180px' }} value={period} onChange={(e) => setPeriod(e.target.value)} />
            {canEdit && (
              <button type="button" disabled={busy || !period} style={secondaryBtnStyle}
                onClick={() => act(() => qualityApi.runRatings(period), 'Failed to compute the ratings.')}>Compute / refresh {period}</button>
            )}
            <span style={{ fontSize: 12, color: TEXT.muted }}>The previous month is rated automatically on the 1st; a Quality head can re-run a month.</span>
          </div>
          <div style={tableWrapStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead><tr>{['Vendor', 'Period', 'Lots', 'Received', 'Accepted', 'Quality', 'NCRs (mi/ma/cr)', 'NCR score', 'On-time', 'Delivery', 'Score', 'Band'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {ratings.length === 0 ? (
                  <tr><td colSpan={12} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No rating for this month yet.</td></tr>
                ) : ratings.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{r.vendor_name}</td>
                    <td style={tdStyle}>{r.period}</td><td style={tdStyle}>{r.lots_count}</td>
                    <td style={tdStyle}>{r.received_qty}</td><td style={tdStyle}>{r.accepted_qty}</td>
                    <td style={tdStyle}>{score(r.quality_score)}</td>
                    <td style={tdStyle}>{r.ncr_minor}/{r.ncr_major}/{r.ncr_critical}</td>
                    <td style={tdStyle}>{score(r.ncr_score)}</td>
                    <td style={tdStyle}>{r.deliveries ? `${r.on_time_deliveries}/${r.deliveries}` : '—'}</td>
                    <td style={tdStyle}>{score(r.on_time_delivery_score)}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{score(r.overall_score)}</td>
                    <td style={tdStyle}>{r.rating_band ? <Pill text={AVL_STATUS_LABELS[r.rating_band] || r.rating_band} hex={BAND_HEX[r.rating_band]} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'audits' && (
        <>
          <div style={tableWrapStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead><tr>{['Audit', 'Vendor', 'Planned', 'Auditor', 'Status', 'Score', 'Result', 'Findings', 'CAPA', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {audits.length === 0 ? (
                  <tr><td colSpan={10} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No vendor audits yet.</td></tr>
                ) : audits.map((a) => (
                  <tr key={a.id}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{a.audit_number}</td>
                    <td style={tdStyle}>{a.vendor_name}</td>
                    <td style={tdStyle}>{fmtDate(a.planned_date)}</td>
                    <td style={tdStyle}>{a.auditor_name || '—'}</td>
                    <td style={tdStyle}>{a.status}{a.audit_date ? ` ${fmtDate(a.audit_date)}` : ''}</td>
                    <td style={tdStyle}>{a.score ?? '—'}</td>
                    <td style={tdStyle}>{a.result || '—'}</td>
                    <td style={tdStyle}>{(a.findings || []).map((f) => `[${f.type}] ${f.description}`).join('; ') || '—'}</td>
                    <td style={tdStyle}>{a.capa_id ? <span onClick={() => router.push(recordPath('/dashboard/quality/capa', a, 'capa_id'))} style={{ color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>{a.capa_number}</span> : '—'}</td>
                    <td style={tdStyle}>{canEdit && a.status === 'planned' && <span onClick={() => { setSheetError(''); setCompleting(a.id) }} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>Record result</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {scheduling && canCreate && (
        <ActionSheet icon="calendar" title="Schedule Vendor Audit" subtitle="Plan an audit of a supplier's process and quality system." onClose={() => setScheduling(false)}
          busy={busy} error={sheetError} submitLabel="Schedule" busyLabel="Scheduling…"
          onSubmit={() => act(() => qualityApi.scheduleVendorAudit({ vendor_name: audit.vendor_name, planned_date: audit.planned_date || null, scope: audit.scope || null, auditor_id: audit.auditor_id ? Number(audit.auditor_id) : null }),
            'Failed to schedule the audit.', () => { setAudit({ vendor_name: '', planned_date: '', scope: '', auditor_id: '' }); setScheduling(false) }, setSheetError)}>
          <label style={sheetLabel}>Vendor <Req /></label>
          <input style={sheetInput} autoFocus value={audit.vendor_name} onChange={(e) => setAudit({ ...audit, vendor_name: e.target.value })} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', ...sheetGap }}>
            <div style={{ flex: '1 1 160px' }}><label style={sheetLabel}>Planned date <Req /></label><DateField value={audit.planned_date} onChange={(v) => setAudit({ ...audit, planned_date: v })} /></div>
            <div style={{ flex: '1 1 200px' }}><label style={sheetLabel}>Auditor</label><SearchableSelect value={audit.auditor_id} onChange={(v) => setAudit({ ...audit, auditor_id: v })} placeholder="Select" options={users.filter((u) => allowAuditor(u.id)).map((u) => ({ value: String(u.id), label: u.name }))} /></div>
          </div>
          <label style={{ ...sheetLabel, ...sheetGap }}>Scope <Optional /></label>
          <input style={sheetInput} value={audit.scope} onChange={(e) => setAudit({ ...audit, scope: e.target.value })} />
        </ActionSheet>
      )}

      {completing !== null && canEdit && (
        <ActionSheet icon="check" iconColor="#16A34A" title="Record Audit Result" subtitle={audits.find((x) => x.id === completing)?.audit_number || 'Vendor audit'} onClose={() => setCompleting(null)}
          busy={busy} error={sheetError} submitLabel="Save result"
          onSubmit={() => act(() => qualityApi.completeVendorAudit(completing, {
            audit_date: result.audit_date || null, score: result.score === '' ? null : Number(result.score), result: result.result, remarks: result.remarks || null,
            findings: result.findings.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
              const m = l.match(/^(major|minor|observation)\s*:\s*(.*)$/i)
              return m ? { type: m[1].toLowerCase(), description: m[2] } : { type: 'observation', description: l }
            }),
          }), 'Failed to record the audit.', () => { setCompleting(null); setResult({ audit_date: '', score: '', result: 'satisfactory', findings: '', remarks: '' }) }, setSheetError)}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 150px' }}><label style={sheetLabel}>Audit date <Req /></label><DateField value={result.audit_date} onChange={(v) => setResult({ ...result, audit_date: v })} /></div>
            <div style={{ flex: '0 1 110px' }}><label style={sheetLabel}>Score (0–100)</label><input type="number" min={0} max={100} style={sheetInput} value={result.score} onChange={(e) => setResult({ ...result, score: e.target.value })} /></div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={sheetLabel}>Result</label>
              <Select style={sheetInput} value={result.result} onChange={(e) => setResult({ ...result, result: e.target.value })}>
                <option value="satisfactory">Satisfactory</option><option value="conditional">Conditional</option><option value="unsatisfactory">Unsatisfactory</option>
              </Select>
            </div>
          </div>
          <label style={{ ...sheetLabel, ...sheetGap }}>Findings <Optional /></label>
          <textarea style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={result.findings} onChange={(e) => setResult({ ...result, findings: e.target.value })} />
          <p style={sheetHint}>One per line, start with major: / minor: / observation: — major and minor findings raise a CAPA.</p>
          <label style={{ ...sheetLabel, ...sheetGap }}>Remarks <Optional /></label>
          <input style={sheetInput} value={result.remarks} onChange={(e) => setResult({ ...result, remarks: e.target.value })} />
        </ActionSheet>
      )}
    </div>
  )
}
