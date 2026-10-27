'use client'

import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { RndExperiment, RndProject, RndPrototype, RndPrototypeBomItem, RndPrototypeBomItemInput, RndPrototypeStatus, RndStoreItemLookup } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER, DANGER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle, dangerBtnStyle, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow, TableScroll, thStyle, tdStyle, numThStyle, numTdStyle, RowCount } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'
import RndNav from '@/components/rnd/RndNav'
import AnchoredPopover from '@/components/rnd/AnchoredPopover'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordHref, recordPath, useRecordId } from '@/lib/recordRef'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import RndDocumentsPanel from '@/components/rnd/RndDocumentsPanel'
import ReleaseToProductionPanel, { isReleased } from '@/components/rnd/ReleaseToProductionPanel'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const STATUS_LABELS: Record<string, string> = { design: 'Design', building: 'Building', testing: 'Testing', validated: 'Validated', rejected: 'Rejected' }
const STATUS_HEX: Record<string, string> = { design: '#78716c', building: '#2563EB', testing: '#7C3AED', validated: '#16A34A', rejected: '#DC2626' }
const EXP_RESULT_LABELS: Record<string, string> = { pass: 'Pass', fail: 'Fail', inconclusive: 'Inconclusive' }
const EXP_RESULT_HEX: Record<string, string> = { pass: '#16A34A', fail: '#DC2626', inconclusive: '#F59E0B' }
const EXP_STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }

const inputStyle = sheetInput
const labelStyle = sheetLabel
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

// null = hidden by the server (R&D › Prototypes › BOM costs).
const formatInr = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)

// ── BOM editor ────────────────────────────────────────────────────────────
type BomLine = {
  key: number
  store_item_id: number | null
  item_code: string
  item_name: string
  quantity: string
  uom: string
  unit_cost: string
  remarks: string
}

let bomKeySeq = 0
const blankLine = (): BomLine => ({ key: ++bomKeySeq, store_item_id: null, item_code: '', item_name: '', quantity: '1', uom: '', unit_cost: '', remarks: '' })

const isEmptyLine = (l: BomLine) =>
  !l.store_item_id && !l.item_name.trim() && !l.item_code.trim() && !l.uom.trim() && !l.unit_cost.trim() && !l.remarks.trim()

const lineCost = (l: BomLine) => {
  const q = Number(l.quantity)
  const c = Number(l.unit_cost)
  if (!l.quantity.trim() || !l.unit_cost.trim() || !Number.isFinite(q) || !Number.isFinite(c)) return 0
  return q * c
}

function buildBomPayload(lines: BomLine[]): { items: RndPrototypeBomItemInput[]; error?: string } {
  const items: RndPrototypeBomItemInput[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (isEmptyLine(l)) continue
    const n = i + 1
    const name = l.item_name.trim()
    if (!name) return { items: [], error: `BOM line ${n}: enter an item name, or pick a part from the Item Master. Remove the line if you don't need it.` }
    const qty = Number(l.quantity)
    if (!l.quantity.trim() || !Number.isFinite(qty) || qty <= 0) return { items: [], error: `BOM line ${n} (${name}): quantity must be a number greater than 0.` }
    let cost: number | null = null
    if (l.unit_cost.trim()) {
      cost = Number(l.unit_cost)
      if (!Number.isFinite(cost) || cost < 0) return { items: [], error: `BOM line ${n} (${name}): unit cost must be a number of 0 or more, or left blank.` }
    }
    items.push({
      store_item_id: l.store_item_id,
      item_code: l.item_code.trim() || null,
      item_name: name,
      quantity: qty,
      uom: l.uom.trim() || null,
      unit_cost: cost,
      remarks: l.remarks.trim() || null,
    })
  }
  return { items }
}

const bomHeadStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted }
const bomInputStyle: React.CSSProperties = { ...inputStyle, padding: '8px 10px', fontSize: 13 }
const BOM_COLS = {
  item: { flex: '1 1 240px', minWidth: 180, maxWidth: 360 },
  code: { flex: '0 1 120px', minWidth: 90 },
  qty: { flex: '0 1 80px', minWidth: 64 },
  uom: { flex: '0 1 80px', minWidth: 60 },
  cost: { flex: '0 1 110px', minWidth: 90 },
  line: { flex: '0 1 110px', minWidth: 90 },
  remarks: { flex: '1 1 160px', minWidth: 120, maxWidth: 280 },
  remove: { flex: '0 0 28px' },
} satisfies Record<string, React.CSSProperties>

function BomEditor({ lines, onChange, onError }: { lines: BomLine[]; onChange: (lines: BomLine[]) => void; onError: (e: string | string[]) => void }) {
  const [activeKey, setActiveKey] = useState<number | null>(null)
  // Results are keyed by the query they answer, so a stale response never
  // shows under newer text and "searching" is simply "no answer for q yet".
  const [lookup, setLookup] = useState<{ q: string; items: RndStoreItemLookup[] }>({ q: '', items: [] })
  const activeQuery = activeKey === null ? '' : (lines.find((l) => l.key === activeKey)?.item_name ?? '').trim()
  const results = lookup.q === activeQuery ? lookup.items : []
  const searching = !!activeQuery && lookup.q !== activeQuery

  // Item Master lookup is capped server-side, so re-query as the user types.
  useEffect(() => {
    if (!activeQuery) return
    let cancelled = false
    const t = setTimeout(() => {
      rndApi.lookupStoreItems(activeQuery)
        .then((data) => { if (!cancelled) setLookup({ q: activeQuery, items: Array.isArray(data) ? data : [] }) })
        .catch((err) => {
          if (cancelled) return
          setLookup({ q: activeQuery, items: [] })
          onError(extractErrorMessages(err, 'Failed to search the Item Master.'))
        })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [activeQuery, onError])

  const update = (key: number, patch: Partial<BomLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const pick = (key: number, it: RndStoreItemLookup) => {
    const line = lines.find((l) => l.key === key)
    update(key, { store_item_id: it.id, item_code: it.item_code || '', item_name: it.item_name, uom: it.uom || line?.uom || '' })
    setActiveKey(null)
  }

  const remove = (key: number) => {
    const next = lines.filter((l) => l.key !== key)
    onChange(next.length ? next : [blankLine()])
  }

  const total = lines.reduce((sum, l) => sum + lineCost(l), 0)

  return (
    <div>
      {/* The line grid scrolls sideways on narrow screens instead of widening the page. */}
      <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 820 }}>
      <div style={{ display: 'flex', gap: 8, padding: '0 0 6px', borderBottom: `1px solid ${BORDER.light}`, marginBottom: 8 }}>
        <div style={{ ...BOM_COLS.item, ...bomHeadStyle }}>Item *</div>
        <div style={{ ...BOM_COLS.code, ...bomHeadStyle }}>Item Code</div>
        <div style={{ ...BOM_COLS.qty, ...bomHeadStyle }}>Qty *</div>
        <div style={{ ...BOM_COLS.uom, ...bomHeadStyle }}>UOM</div>
        <div style={{ ...BOM_COLS.cost, ...bomHeadStyle }}>Unit Cost (₹)</div>
        <div style={{ ...BOM_COLS.line, ...bomHeadStyle, textAlign: 'right' }}>Line Cost</div>
        <div style={{ ...BOM_COLS.remarks, ...bomHeadStyle }}>Remarks</div>
        <div style={BOM_COLS.remove} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lines.map((l) => {
          const open = activeKey === l.key && l.item_name.trim().length > 0
          return (
            <div key={l.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ ...BOM_COLS.item, position: 'relative' }}>
                <input
                  style={{ ...bomInputStyle, borderColor: l.store_item_id ? 'rgba(22,163,74,0.45)' : BORDER.normal }}
                  value={l.item_name}
                  placeholder="Search Item Master or type a part name…"
                  title={l.store_item_id ? 'Linked to the Item Master' : 'Free-text part (not in the Item Master)'}
                  onChange={(e) => {
                    update(l.key, { item_name: e.target.value, store_item_id: null, ...(l.store_item_id ? { item_code: '' } : {}) })
                    setActiveKey(l.key)
                  }}
                  onBlur={() => setTimeout(() => setActiveKey((k) => (k === l.key ? null : k)), 150)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setActiveKey(null) }}
                />
                {open && (
                  <AnchoredPopover>
                    {results.length === 0 ? (
                      <div style={{ padding: '6px 10px', fontSize: 12, color: TEXT.muted }}>
                        {searching ? 'Searching…' : 'No Item Master match. The part will be saved as free text.'}
                      </div>
                    ) : (
                      results.slice(0, 8).map((it) => (
                        <div
                          key={it.id}
                          onMouseDown={(e) => { e.preventDefault(); pick(l.key, it) }}
                          style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: TEXT.secondary, borderTop: '1px solid rgba(0,0,0,0.04)' }}
                        >
                          <span style={{ fontWeight: 600 }}>{it.item_code}</span> · {it.item_name}{it.uom ? ` (${it.uom})` : ''}
                        </div>
                      ))
                    )}
                  </AnchoredPopover>
                )}
              </div>
              <div style={BOM_COLS.code}>
                <input style={bomInputStyle} value={l.item_code} onChange={(e) => update(l.key, { item_code: e.target.value })} />
              </div>
              <div style={BOM_COLS.qty}>
                <input style={bomInputStyle} type="number" min={0} step="any" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
              </div>
              <div style={BOM_COLS.uom}>
                <input style={bomInputStyle} value={l.uom} onChange={(e) => update(l.key, { uom: e.target.value })} />
              </div>
              <div style={BOM_COLS.cost}>
                <input style={bomInputStyle} type="number" min={0} step="any" value={l.unit_cost} onChange={(e) => update(l.key, { unit_cost: e.target.value })} />
              </div>
              <div style={{ ...BOM_COLS.line, textAlign: 'right', fontSize: 13, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>
                {formatInr(lineCost(l))}
              </div>
              <div style={BOM_COLS.remarks}>
                <input style={bomInputStyle} value={l.remarks} onChange={(e) => update(l.key, { remarks: e.target.value })} />
              </div>
              <div style={BOM_COLS.remove}>
                <button
                  type="button"
                  onClick={() => remove(l.key)}
                  title="Remove line"
                  style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: '#b91c1c', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}
                >
                  ×
                </button>
              </div>
            </div>
          )
        })}
      </div>
      </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => onChange([...lines, blankLine()])}
          style={sheetBtn('secondary')}
        >
          <SheetIcon name="plus" size={15} color={SHEET.BLUE} />Add line
        </button>
        <div style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading }}>
          BOM Total: {formatInr(total)}
        </div>
      </div>
    </div>
  )
}

const toBomLine = (b: RndPrototypeBomItem): BomLine => ({
  key: ++bomKeySeq,
  store_item_id: b.store_item_id ?? null,
  item_code: b.item_code || '',
  item_name: b.item_name || '',
  quantity: b.quantity != null ? String(b.quantity) : '',
  uom: b.uom || '',
  unit_cost: b.unit_cost != null ? String(b.unit_cost) : '',
  remarks: b.remarks || '',
})

// ── Page ──────────────────────────────────────────────────────────────────
export default function RndPrototypeDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const { can, canDelete, canFeature } = useCan()
  const router = useRouter()
  const params = useParams()
  const { id: resolvedId, error: linkError } = useRecordId(params.id as string)
  const prototypeId = resolvedId ?? 0

  const [proto, setProto] = useState<RndPrototype | null>(null)
  const [projects, setProjects] = useState<RndProject[]>([])
  const [experiments, setExperiments] = useState<RndExperiment[]>([])
  const [loading, setLoading] = useState(true)

  const [projectId, setProjectId] = useState('')
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<RndPrototypeStatus>('design')
  const [buildDate, setBuildDate] = useState('')
  const [description, setDescription] = useState('')
  const [findings, setFindings] = useState('')
  const [bomLines, setBomLines] = useState<BomLine[]>(() => [blankLine()])

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  // Read-only view by default; Edit opens the full form (same as R&D › Project).
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)

  const hydrate = (p: RndPrototype) => {
    setProto(p)
    setProjectId(String(p.project_id))
    setName(p.name)
    setVersion(p.version)
    setStatus(p.status)
    setBuildDate(p.build_date || '')
    setDescription(p.description || '')
    setFindings(p.findings || '')
    setBomLines(p.bom_items?.length ? p.bom_items.map(toBomLine) : [blankLine()])
  }

  useEffect(() => {
    if (!isAuthorized || !prototypeId) return
    ;(async () => {
      try {
        const [p, projs, exps] = await Promise.all([
          rndApi.getPrototype(prototypeId),
          rndApi.listProjects(),
          rndApi.listExperiments({ prototype_id: prototypeId }),
        ])
        hydrate(p)
        setProjects(Array.isArray(projs) ? projs : [])
        setExperiments(Array.isArray(exps) ? exps : [])
      } catch (err) {
        setError(extractErrorMessages(err, 'Failed to load prototype.'))
      } finally {
        setLoading(false)
      }
    })()
  }, [isAuthorized, prototypeId])

  const handleSave = async () => {
    setError('')
    if (!projectId) { setError('Project is required. Pick the R&D project this prototype belongs to.'); return }
    if (!name.trim()) { setError('Prototype name is required.'); return }
    if (!version.trim()) { setError('Version is required, e.g. "v1".'); return }
    // A released prototype's BOM is frozen server-side — don't resend it.
    const frozen = proto ? isReleased(proto) : false
    const bom = frozen ? { items: [] } : buildBomPayload(bomLines)
    if (bom.error) { setError(bom.error); return }

    setSaving(true)
    try {
      // bom_items replaces the whole BOM server-side, so every kept line is sent.
      const updated: RndPrototype = await rndApi.updatePrototype(prototypeId, {
        project_id: Number(projectId),
        name: name.trim(),
        version: version.trim(),
        status,
        build_date: buildDate || null,
        description: description.trim() || null,
        findings: findings.trim() || null,
        ...(frozen ? {} : { bom_items: bom.items }),
      })
      hydrate(updated)
      setEditing(false)
      setSaved(true)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to save prototype.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    setError('')
    setDeleting(true)
    try {
      await rndApi.deletePrototype(prototypeId)
      router.push('/dashboard/rnd/prototypes')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete prototype.'))
      setDeleting(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div style={{ width: '100%' }}><RndNav /><InvalidRecordLink message={linkError} listHref="/dashboard/rnd/prototypes" listLabel="Back to prototypes" /></div>)
  if (loading) return null

  if (!proto) {
    return (
      <div style={{ width: '100%' }}>
        <RndNav />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Prototype</h1>
          </div>
          <button onClick={() => router.push('/dashboard/rnd/prototypes')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(error) ? error.join(' ') : error}
          </div>
        )}
      </div>
    )
  }

  const canEdit = can('rnd', 'prototypes', 'edit')
  // Editors enter the costs, so they always see them (same rule as the server's hide_costs).
  const seeCosts = canEdit || canFeature('rnd', 'prototypes', 'costs', 'view')
  const canAddExperiment = can('rnd', 'experiments', 'create')
  const frozen = isReleased(proto)
  const draftTotal = bomLines.reduce((sum, l) => sum + lineCost(l), 0)
  const canDeleteProto = canDelete('rnd', 'prototypes', (proto as { created_by_id?: number | null }).created_by_id ?? null)
  const startEdit = () => { setError(''); setSaved(false); hydrate(proto); setEditing(true) }
  const discardEdit = () => { setError(''); hydrate(proto); setEditing(false) }

  if (!editing || !canEdit) {
    const projectLabel = `${proto.project_number || `#${proto.project_id}`}${proto.project_title ? ` — ${proto.project_title}` : ''}`
    const statusHex = STATUS_HEX[proto.status] || '#78716c'
    return (
      <div style={{ width: '100%' }}>
        <RndNav />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{proto.prototype_number}</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {canEdit && <button data-tour="rnd-ptd-edit-btn" type="button" onClick={startEdit} style={secondaryBtnStyle}>Edit</button>}
            {canDeleteProto && (
              <button data-tour="rnd-ptd-delete-btn" type="button" onClick={() => setConfirmOpen(true)} disabled={deleting} style={{ ...dangerBtnStyle, opacity: deleting ? 0.6 : 1 }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
            <button data-tour="rnd-ptd-back-btn" type="button" onClick={() => router.push('/dashboard/rnd/prototypes')} style={secondaryBtnStyle}>← Back</button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(error) ? error.join(' ') : error}
          </div>
        )}
        {saved && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
            Changes saved.
          </div>
        )}

        {/* Summary on top (what the prototype is), then every detail as one label–value list. */}
        <DetailCard tour="rnd-ptd-overview">
          <DetailSummary
            title={`${proto.name} · ${proto.version}`}
            text={proto.description || undefined}
            meta={<span data-tour="rnd-ptd-badges" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Pill label={STATUS_LABELS[proto.status] || proto.status} hex={statusHex} />
              <span>·</span>
              <span>Built {proto.build_date ? formatDate(proto.build_date) : '— not yet'}</span>
              <span>·</span>
              <span>Project <Link href={recordPath('/dashboard/rnd/projects', proto, 'project_id')} style={{ color: '#2563EB', fontWeight: 600, textDecoration: 'none' }}>{proto.project_number || `#${proto.project_id}`}</Link></span>
            </span>}
          />

          <div data-tour="rnd-ptd-details">
            <DetailGroup>
              <DetailRow label="R&D Project">
                <Link href={recordPath('/dashboard/rnd/projects', proto, 'project_id')} style={{ color: '#2563EB', fontWeight: 600, textDecoration: 'none' }}>{projectLabel}</Link>
              </DetailRow>
              <DetailRow label="Version">{proto.version}</DetailRow>
              <div data-tour="rnd-ptd-status">
                <DetailRow label="Status"><Pill label={STATUS_LABELS[proto.status] || proto.status} hex={statusHex} /></DetailRow>
              </div>
              <DetailRow label="Build Date">{proto.build_date ? formatDate(proto.build_date) : null}</DetailRow>
              {/* The Release to Production panel below shows this when the user can see it. */}
              {proto.production_bom_number && !canFeature('rnd', 'prototypes', 'release_production', 'view') && (
                <DetailRow label="Released to Production">
                  {proto.production_bom_number}{proto.released_at ? ` on ${formatDate(proto.released_at)}` : ''}{proto.released_by_name ? ` by ${proto.released_by_name}` : ''}
                </DetailRow>
              )}
            </DetailGroup>
          </div>

          <div data-tour="rnd-ptd-findings">
            <DetailGroup>
              <DetailRow label="Findings">{proto.findings}</DetailRow>
            </DetailGroup>
          </div>

          <div data-tour="rnd-ptd-bom">
            <DetailGroup title="Prototype BOM" last>
              {frozen && (
                <p style={{ fontSize: 12.5, fontWeight: 600, color: '#0891B2', margin: '4px 0 8px' }}>
                  Frozen — released to Production as {proto.production_bom_number}. Create a new prototype version for design changes.
                </p>
              )}
              {proto.bom_items.length === 0 ? (
                <p style={{ fontSize: 13, color: SHEET.MUTED, margin: '6px 0' }}>
                  No parts listed yet{canEdit ? ' — use Edit to add the parts this prototype needs.' : '.'}
                </p>
              ) : (
                <TableScroll maxHeight="none" style={{ marginTop: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Item Code <RowCount count={proto.bom_items.length} /></th>
                        <th style={thStyle}>Item</th>
                        <th style={numThStyle}>Qty</th>
                        <th style={thStyle}>UOM</th>
                        {seeCosts && <th style={numThStyle}>Unit Cost</th>}
                        {seeCosts && <th style={numThStyle}>Line Cost</th>}
                        <th style={thStyle}>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proto.bom_items.map((l) => (
                        <tr key={l.id}>
                          <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600, color: TEXT.heading }}>{l.item_code || '—'}</td>
                          <td style={tdStyle}>{l.item_name}</td>
                          <td style={numTdStyle}>{l.quantity.toLocaleString('en-IN')}</td>
                          <td style={tdStyle}>{l.uom || '—'}</td>
                          {seeCosts && <td style={numTdStyle}>{formatInr(l.unit_cost)}</td>}
                          {seeCosts && <td style={numTdStyle}>{formatInr(l.line_cost)}</td>}
                          <td style={{ ...tdStyle, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.remarks || undefined}>{l.remarks || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
              {seeCosts && proto.bom_items.length > 0 && (
                <p style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: '10px 0 0', textAlign: 'right' }}>BOM Total: {formatInr(proto.bom_cost)}</p>
              )}
            </DetailGroup>
          </div>

          {proto.created_at && <p style={{ fontSize: 12, color: SHEET.MUTED, margin: '10px 0 0' }}>Created {formatDate(proto.created_at)}</p>}
        </DetailCard>

        {canFeature('rnd', 'prototypes', 'release_production', 'view') && (
          <div style={{ marginBottom: 20 }}>
            <ReleaseToProductionPanel proto={proto} onReleased={hydrate} />
          </div>
        )}

        <div data-tour="rnd-ptd-experiments" style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Experiments run on this prototype ({experiments.length})</h2>
            {canAddExperiment && (
              <Link
                data-tour="rnd-ptd-new-exp-link"
                href={recordHref('/dashboard/rnd/experiments/new', proto, 'project_id', undefined, 'project_id')}
                style={{ fontSize: 13, fontWeight: 600, color: '#FF6A2A', textDecoration: 'none' }}
              >
                + New Experiment
              </Link>
            )}
          </div>
          {experiments.length === 0 ? (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No experiments have been run on this prototype yet{canAddExperiment ? ' — use + New Experiment to record a test.' : '.'}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {experiments.map((x) => {
                const hex = x.result ? EXP_RESULT_HEX[x.result] : '#78716c'
                const label = x.result ? (EXP_RESULT_LABELS[x.result] || x.result) : (EXP_STATUS_LABELS[x.status] || x.status)
                return (
                  <Link
                    key={x.id}
                    href={recordPath('/dashboard/rnd/experiments', x)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      padding: '10px 14px', borderRadius: 10, border: `1px solid ${BORDER.light}`,
                      background: 'rgba(255,255,255,.5)', textDecoration: 'none',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, flex: '0 0 auto', whiteSpace: 'nowrap' }}>{x.experiment_number}</span>
                    <span style={{ fontSize: 12.5, color: TEXT.muted, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={x.title}>{x.title}</span>
                    {x.experiment_date && <span style={{ fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap' }}>{formatDate(x.experiment_date)}</span>}
                    <Pill label={label} hex={hex} />
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        <RndDocumentsPanel
          projectId={proto.project_id}
          prototypeId={proto.id}
          title="Prototype Documents"
          currentUserId={user?.id}
          isAdmin={user?.role === 'admin'}
        />

        <ConfirmDialog
          open={confirmOpen}
          title="Delete this prototype?"
          message={`This deletes "${proto.prototype_number}" and its BOM from the R&D record.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      </div>
    )
  }

  // Edit: the full prototype form (details, findings, BOM) — Save returns to the view above.
  return (
    <div style={{ width: '100%' }}>
      <FormPage
        tour="rnd-ptd-form"
        nav={<RndNav />}
        icon="box"
        title={`Edit ${proto.prototype_number} · ${proto.version}`}
        subtitle={proto.name}
        onBack={discardEdit} backTour="rnd-ptd-back-btn"
        footer={<>
          {canDeleteProto && (
            <button
              data-tour="rnd-ptd-delete-btn"
              onClick={() => setConfirmOpen(true)}
              disabled={deleting}
              type="button"
              style={{ ...sheetBtn('secondary', DANGER.text, deleting), color: DANGER.text, borderColor: DANGER.border, background: DANGER.light, marginRight: 'auto' }}
            >
              <SheetIcon name="trash" size={15} />{deleting ? 'Deleting…' : 'Delete Prototype'}
            </button>
          )}
          <button type="button" onClick={discardEdit} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Discard</button>
          {canEdit && (
            <button data-tour="rnd-ptd-save-btn" onClick={handleSave} disabled={saving} type="button" style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save Changes'}
            </button>
          )}
        </>}
      >
        <div style={{ padding: '16px 24px 0' }}>
          <div data-tour="rnd-ptd-badges" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Pill label={STATUS_LABELS[proto.status] || proto.status} hex={STATUS_HEX[proto.status] || '#78716c'} />
            <span style={{ fontSize: 13, color: SHEET.MUTED }}>
              Project:{' '}
              <Link href={recordPath('/dashboard/rnd/projects', proto, 'project_id')} style={{ color: '#FF6A2A', fontWeight: 600, textDecoration: 'none' }}>
                {proto.project_number || `#${proto.project_id}`}{proto.project_title ? ` — ${proto.project_title}` : ''}
              </Link>
            </span>
          </div>
          {error && (
            <div style={{ padding: '10px 14px', marginTop: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {Array.isArray(error) ? error.join(' ') : error}
            </div>
          )}
        </div>

        <SheetColumns
          left={
            <div data-tour="rnd-ptd-details">
              <SheetSection icon="list" title="Prototype Details">
                <label style={labelStyle}>Project <Req /></label>
                <SearchableSelect
                  value={projectId}
                  onChange={setProjectId}
                  options={projects.map((p) => ({ value: String(p.id), label: `${p.project_number} — ${p.title}` }))}
                  placeholder="Search R&D project…"
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                  <div style={{ flex: '1 1 220px', minWidth: 180, maxWidth: 360 }}>
                    <label style={labelStyle}>Name <Req /></label>
                    <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div style={{ flex: '0 1 110px', minWidth: 90 }}>
                    <label style={labelStyle}>Version <Req /></label>
                    <input style={inputStyle} value={version} onChange={(e) => setVersion(e.target.value)} />
                  </div>
                </div>
              </SheetSection>
              <SheetSection icon="calendar" title="Status & Build">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div data-tour="rnd-ptd-status" style={{ flex: '0 1 170px', minWidth: 140 }}>
                    <label style={labelStyle}>Status</label>
                    <Select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as RndPrototypeStatus)}>
                      <option value="design">Design</option>
                      <option value="building">Building</option>
                      <option value="testing">Testing</option>
                      <option value="validated">Validated</option>
                      <option value="rejected">Rejected</option>
                    </Select>
                  </div>
                  <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                    <label style={labelStyle}>Build Date</label>
                    <DateField value={buildDate} onChange={setBuildDate} />
                  </div>
                </div>
                <p style={sheetHint}>Set Validated only after the experiments prove it — that unlocks Release to Production.</p>
                <label style={{ ...labelStyle, marginTop: 14 }}>Description</label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
              </SheetSection>
            </div>
          }
          right={<>
            <SheetSection icon="chat" title="Findings">
              <div data-tour="rnd-ptd-findings">
                <textarea style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="What did building and testing this prototype show?" />
              </div>
            </SheetSection>
            <SheetSection icon="rupee" title="Summary">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: SHEET.BODY }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>BOM lines</span><b>{frozen ? proto.bom_items.length : bomLines.filter((l) => !isEmptyLine(l)).length}</b></div>
                {seeCosts && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>BOM total</span><b>{formatInr(frozen ? proto.bom_cost : draftTotal)}</b></div>}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Experiments</span><b>{experiments.length}</b></div>
                {proto.created_at && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Created on</span><b>{formatDate(proto.created_at)}</b></div>}
              </div>
            </SheetSection>
          </>}
        />

        <div data-tour="rnd-ptd-bom" style={{ padding: '20px 24px 4px', borderTop: `1px solid ${SHEET.LINE}` }}>
          <SheetSection icon="box" title="Prototype BOM">
            <p style={{ ...sheetHint, margin: '-6px 0 14px' }}>
              Pick parts from the Item Master, or type a free-text name for parts that aren&apos;t in it yet. Empty lines are ignored.
            </p>
            {frozen ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#0891B2', margin: '0 0 4px' }}>
                  Frozen — released to Production as {proto.production_bom_number}.
                </p>
                {proto.bom_items.map((l) => (
                  <div key={l.id} style={{ display: 'flex', gap: 10, padding: '8px 12px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: SHEET.SOFT, fontSize: 12.5, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: TEXT.heading, flex: '0 0 110px' }}>{l.item_code || '—'}</span>
                    <span style={{ color: TEXT.body, flex: '1 1 200px' }}>{l.item_name}</span>
                    <span style={{ color: TEXT.secondary, flex: '0 0 90px' }}>{l.quantity} {l.uom || ''}</span>
                    {seeCosts && <span style={{ color: TEXT.secondary, flex: '0 0 110px', textAlign: 'right' }}>{formatInr(l.line_cost)}</span>}
                  </div>
                ))}
                {seeCosts && <p style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, margin: '4px 0 0', textAlign: 'right' }}>BOM Total: {formatInr(proto.bom_cost)}</p>}
              </div>
            ) : (
              <BomEditor lines={bomLines} onChange={setBomLines} onError={setError} />
            )}
          </SheetSection>
        </div>
      </FormPage>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this prototype?"
        message={`This deletes "${proto.prototype_number}" and its BOM from the R&D record.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
