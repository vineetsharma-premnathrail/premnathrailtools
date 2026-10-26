'use client'

// eBOM -> mBOM transfer UI. Production never keys components of a product
// that has a released Design BOM — it pulls them from the released revision
// (DesignSourcesPanel on the BOM list) and sees what changed when Design
// releases a newer revision (DesignDiffSection on the BOM detail page).

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { productionApi } from '@/lib/api'
import { ProductionBom, ProductionBomDesignDiff, ProductionDesignSource } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, primaryBtnStyle, RowCount, Pill } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'

const STATE_LABELS: Record<string, string> = {
  none: 'No production BOM', outdated: 'Design changed', draft: 'Draft taken', current: 'Up to date',
}
const STATE_HEX: Record<string, string> = { none: '#DC2626', outdated: '#F59E0B', draft: '#2563EB', current: '#16A34A' }
const CHANGE_LABELS: Record<string, string> = {
  design_only: 'Missing here', qty_changed: 'Qty differs', production_only: 'Production only', same: 'Same',
}
const CHANGE_HEX: Record<string, string> = { design_only: '#DC2626', qty_changed: '#F59E0B', production_only: '#2563EB', same: '#16A34A' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 6px' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', whiteSpace: 'nowrap', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const primaryBtn: React.CSSProperties = primaryBtnStyle
const errorBox = (error: string | string[]) => (
  <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
    {Array.isArray(error) ? error.join(' ') : error}
  </div>
)
const pill = (label: string, hex: string) => <Pill label={label} hex={hex} />

/** Released Design BOMs and where Production stands on each — the to-do
 *  list of eBOMs still to be taken into production. */
export function DesignSourcesPanel({ canTransfer }: { canTransfer: boolean }) {
  const router = useRouter()
  const [rows, setRows] = useState<ProductionDesignSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<ProductionDesignSource | null>(null)

  useEffect(() => {
    const params: Record<string, unknown> = {}
    if (search.trim()) params.search = search.trim()
    productionApi.listDesignSources(params)
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load released Design BOMs.')))
      .finally(() => setLoading(false))
  }, [search])

  const transfer = async (src: ProductionDesignSource) => {
    setConfirm(null)
    setError('')
    setBusyId(src.design_bom_revision_id)
    try {
      const bom = await productionApi.transferFromDesign(src.design_bom_revision_id)
      router.push(recordPath('/dashboard/production/bom', bom))
    } catch (err) {
      setError(extractErrorMessages(err, `Failed to transfer ${src.design_bom_number} ${src.revision_label} to Production.`))
    } finally {
      setBusyId(null)
    }
  }

  const pending = rows.filter((r) => r.mbom_state === 'none' || r.mbom_state === 'outdated')
  const visible = showAll ? rows : pending

  return (
    <div data-tour="production-bom-design-sources" style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <p style={sectionTitle}>Released Design BOMs ({pending.length} to take into production)</p>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0, maxWidth: 640 }}>
            Components come from Design&apos;s released BOM — Production adds scrap %, shop consumables and the routing, then activates.
            A product with a released Design BOM can&apos;t be keyed in by hand.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...inputStyle, flex: '0 1 220px', minWidth: 180 }} placeholder="Search Design BOM / product…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="button" style={secondaryBtnStyle} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show to-do only' : `Show all (${rows.length})`}</button>
        </div>
      </div>

      {error && errorBox(error)}

      <div style={{ overflow: 'auto', maxHeight: 320 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <thead><tr>{['Design BOM', 'Product', 'Released', 'Lines', 'Production BOM', 'State', ''].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={visible.length} />}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>
                {rows.length === 0 ? 'No released Design BOMs yet.' : 'Every released Design BOM is already in production.'}
              </td></tr>
            ) : visible.map((r) => (
              <tr key={r.design_bom_revision_id}>
                <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{r.design_bom_number} {r.revision_label}<div style={{ fontSize: 12, fontWeight: 400, color: TEXT.muted }}>{r.title}</div></td>
                <td style={tdStyle}>{r.product_code} — {r.product_name}</td>
                <td style={tdStyle}>{r.released_at ? formatDateTime(r.released_at) : '—'}</td>
                <td style={tdStyle}>{r.line_count}</td>
                <td style={tdStyle}>
                  {r.mbom_id ? (
                    <span onClick={() => router.push(recordPath('/dashboard/production/bom', r, 'mbom_id'))} style={{ color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }}>
                      {r.mbom_number} v{r.mbom_version}{r.mbom_revision_label ? ` (from ${r.mbom_revision_label})` : ' (keyed by hand)'}
                    </span>
                  ) : '—'}
                </td>
                <td style={tdStyle}>{pill(STATE_LABELS[r.mbom_state], STATE_HEX[r.mbom_state])}</td>
                <td style={tdStyle}>
                  {canTransfer && r.mbom_state !== 'current' && (
                    <button type="button" style={primaryBtn} disabled={busyId !== null}
                      onClick={() => (r.mbom_state === 'none' ? transfer(r) : setConfirm(r))}>
                      {busyId === r.design_bom_revision_id ? 'Transferring…' : r.mbom_state === 'none' ? 'Transfer to Production' : r.mbom_state === 'draft' ? 'Refresh draft' : 'Take new revision'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? `Take ${confirm.design_bom_number} ${confirm.revision_label} into production?` : ''}
        message={
          confirm?.mbom_status === 'draft'
            ? `The open draft ${confirm?.mbom_number} gets Design's current components. Its routing, scrap % and the lines Production added itself are kept.`
            : `A new draft version is started with Design's components and the routing of ${confirm?.mbom_number ?? 'the active version'}. The active version stays in use until the draft is activated.`
        }
        confirmLabel="Transfer"
        onConfirm={() => confirm && transfer(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

/** The mBOM's link to its Design BOM and the component differences against
 *  Design's latest released revision, with a one-click refresh. */
export function DesignDiffSection({ bom, canTransfer, onChanged }: { bom: ProductionBom; canTransfer: boolean; onChanged: (b: ProductionBom) => void }) {
  const router = useRouter()
  const [diff, setDiff] = useState<ProductionBomDesignDiff | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [showSame, setShowSame] = useState(false)

  const load = useCallback(() => {
    productionApi.getBomDesignDiff(bom.id)
      .then(setDiff)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to compare with the Design BOM.')))
  }, [bom.id])

  useEffect(() => { load() }, [load, bom.design_bom_revision_id, bom.items.length])

  const refresh = async () => {
    if (!bom.latest_design_revision_id) return
    setConfirm(false)
    setError('')
    setBusy(true)
    try {
      const updated: ProductionBom = await productionApi.transferFromDesign(bom.latest_design_revision_id)
      if (updated.id === bom.id) onChanged(updated)
      else router.push(recordPath('/dashboard/production/bom', updated))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to refresh from the Design BOM.'))
    } finally {
      setBusy(false)
    }
  }

  const rows = (diff?.rows || []).filter((r) => showSame || r.change !== 'same')
  const live = bom.status === 'draft' || bom.status === 'active'

  return (
    <div data-tour="production-bom-design-link" style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <p style={sectionTitle}>Design BOM link</p>
          <p style={{ fontSize: 13, color: TEXT.body, margin: 0 }}>
            Taken from <strong>{bom.design_bom_number} {bom.design_revision_label}</strong>
            {bom.transferred_at && <> on {formatDateTime(bom.transferred_at)}{bom.transferred_by_name ? ` by ${bom.transferred_by_name}` : ''}</>}
            {bom.latest_design_revision_label && <> · Design&apos;s current release: <strong>{bom.latest_design_revision_label}</strong></>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {bom.design_outdated ? pill('Design changed', '#F59E0B') : pill('Up to date', '#16A34A')}
          {canTransfer && live && bom.design_outdated && (
            <button type="button" style={primaryBtn} disabled={busy} onClick={() => setConfirm(true)}>
              {busy ? 'Refreshing…' : bom.status === 'draft' ? 'Refresh from Design' : `Take ${bom.latest_design_revision_label} into a new version`}
            </button>
          )}
        </div>
      </div>

      {error && errorBox(error)}

      {diff && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
              {diff.differences === 0
                ? `Components match ${diff.design_bom_number} ${diff.compared_revision_label}.`
                : `${diff.differences} difference(s) against ${diff.design_bom_number} ${diff.compared_revision_label}. "Production only" lines are ones Production added itself (e.g. shop consumables) and are kept on refresh.`}
            </p>
            <label style={{ fontSize: 12.5, color: TEXT.secondary, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} /> Show matching lines
            </label>
          </div>
          {rows.length > 0 && (
            <div style={{ overflow: 'auto', maxHeight: 320 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead><tr>{['Item', 'Design qty / unit', 'Production qty / unit', 'Make / Buy', 'Difference'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.item_id}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{r.item_code} — {r.item_name}</td>
                      <td style={tdStyle}>{r.design_qty ?? '—'} {r.design_qty != null ? r.uom || '' : ''}</td>
                      <td style={tdStyle}>{r.production_qty ?? '—'} {r.production_qty != null ? r.uom || '' : ''}</td>
                      <td style={tdStyle}>{r.design_make_buy ? r.design_make_buy[0].toUpperCase() + r.design_make_buy.slice(1) : '—'}</td>
                      <td style={tdStyle}>{pill(CHANGE_LABELS[r.change], CHANGE_HEX[r.change])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirm}
        title={bom.status === 'draft' ? 'Refresh this draft from Design?' : `Take ${bom.latest_design_revision_label} into a new version?`}
        message={
          bom.status === 'draft'
            ? "Design's current components replace this draft's Design lines. The routing, scrap % and lines Production added itself are kept."
            : "A new draft version is started with Design's current components and this version's routing. This version stays active until the draft is activated."
        }
        confirmLabel="Refresh"
        onConfirm={refresh}
        onCancel={() => setConfirm(false)}
      />
    </div>
  )
}
