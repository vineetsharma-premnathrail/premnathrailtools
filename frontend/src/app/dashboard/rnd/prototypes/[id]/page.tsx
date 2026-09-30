'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { RndExperiment, RndProject, RndPrototype, RndPrototypeBomItem, RndPrototypeBomItemInput, RndPrototypeStatus, RndStoreItemLookup } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import RndNav from '@/components/rnd/RndNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import RndDocumentsPanel from '@/components/rnd/RndDocumentsPanel'
import ReleaseToProductionPanel, { isReleased } from '@/components/rnd/ReleaseToProductionPanel'
import { extractErrorMessages } from '@/lib/validation'

const STATUS_LABELS: Record<string, string> = { design: 'Design', building: 'Building', testing: 'Testing', validated: 'Validated', rejected: 'Rejected' }
const STATUS_HEX: Record<string, string> = { design: '#78716c', building: '#2563EB', testing: '#7C3AED', validated: '#16A34A', rejected: '#DC2626' }
const EXP_RESULT_LABELS: Record<string, string> = { pass: 'Pass', fail: 'Fail', inconclusive: 'Inconclusive' }
const EXP_RESULT_HEX: Record<string, string> = { pass: '#16A34A', fail: '#DC2626', inconclusive: '#F59E0B' }
const EXP_STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled' }

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

const formatInr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

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
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, overflow: 'hidden', background: '#fff', boxShadow: '0 8px 20px rgba(0,0,0,0.08)' }}>
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
                  </div>
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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => onChange([...lines, blankLine()])}
          style={{ padding: '8px 14px', borderRadius: 10, border: `1px dashed ${BORDER.normal}`, background: 'transparent', color: '#FF6A2A', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          + Add line
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
  const router = useRouter()
  const params = useParams()
  const prototypeId = Number(params.id)

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
  if (loading) return null

  if (!proto) {
    return (
      <div style={{ width: '100%' }}>
        <RndNav />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
              R&amp;D Module
            </p>
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

  return (
    <div style={{ width: '100%' }}>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            R&amp;D Module
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{proto.prototype_number}</h1>
            <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.secondary }}>{proto.version}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[proto.status]}1a`, color: STATUS_HEX[proto.status], whiteSpace: 'nowrap' }}>
              {STATUS_LABELS[proto.status] || proto.status}
            </span>
          </div>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '6px 0 0' }}>
            Project:{' '}
            <Link href={`/dashboard/rnd/projects/${proto.project_id}`} style={{ color: '#FF6A2A', fontWeight: 600, textDecoration: 'none' }}>
              {proto.project_number || `#${proto.project_id}`}{proto.project_title ? ` — ${proto.project_title}` : ''}
            </Link>
          </p>
        </div>
        <button onClick={() => router.push('/dashboard/rnd/prototypes')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Prototype Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '1 1 300px', minWidth: 240, maxWidth: 460 }}>
            <label style={labelStyle}>Project *</label>
            <SearchableSelect
              value={projectId}
              onChange={setProjectId}
              options={projects.map((p) => ({ value: String(p.id), label: `${p.project_number} — ${p.title}` }))}
              placeholder="Search R&D project…"
            />
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 200, maxWidth: 380 }}>
            <label style={labelStyle}>Name *</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 110px', minWidth: 90 }}>
            <label style={labelStyle}>Version *</label>
            <input style={inputStyle} value={version} onChange={(e) => setVersion(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as RndPrototypeStatus)}>
              <option value="design">Design</option>
              <option value="building">Building</option>
              <option value="testing">Testing</option>
              <option value="validated">Validated</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Build Date</label>
            <DateField value={buildDate} onChange={setBuildDate} />
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Description</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Findings</label>
          <textarea style={{ ...inputStyle, minHeight: 80 }} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="What did building and testing this prototype show?" />
        </div>
        {proto.created_at && (
          <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '14px 0 0' }}>
            Created on {proto.created_at.slice(0, 10)}
          </p>
        )}
      </div>

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Prototype BOM</h2>
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 14px' }}>
          Pick parts from the Item Master, or type a free-text name for parts that aren&apos;t in it yet. Empty lines are ignored.
        </p>
        {isReleased(proto) ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#0891B2', margin: '0 0 4px' }}>
              Frozen — released to Production as {proto.production_bom_number}.
            </p>
            {proto.bom_items.map((l) => (
              <div key={l.id} style={{ display: 'flex', gap: 10, padding: '8px 12px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.5)', fontSize: 12.5, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: TEXT.heading, flex: '0 0 110px' }}>{l.item_code || '—'}</span>
                <span style={{ color: TEXT.body, flex: '1 1 200px' }}>{l.item_name}</span>
                <span style={{ color: TEXT.secondary, flex: '0 0 90px' }}>{l.quantity} {l.uom || ''}</span>
                <span style={{ color: TEXT.secondary, flex: '0 0 110px', textAlign: 'right' }}>{formatInr(l.line_cost)}</span>
              </div>
            ))}
            <p style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, margin: '4px 0 0', textAlign: 'right' }}>BOM Total: {formatInr(proto.bom_cost)}</p>
          </div>
        ) : (
          <BomEditor lines={bomLines} onChange={setBomLines} onError={setError} />
        )}
      </div>

      <ReleaseToProductionPanel proto={proto} onReleased={hydrate} />

      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Experiments run on this prototype</h2>
          <Link
            href={`/dashboard/rnd/experiments/new?project_id=${proto.project_id}`}
            style={{ fontSize: 13, fontWeight: 600, color: '#FF6A2A', textDecoration: 'none' }}
          >
            + New Experiment
          </Link>
        </div>
        {experiments.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No experiments have been run on this prototype yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {experiments.map((x) => {
              const hex = x.result ? EXP_RESULT_HEX[x.result] : '#78716c'
              const label = x.result ? (EXP_RESULT_LABELS[x.result] || x.result) : (EXP_STATUS_LABELS[x.status] || x.status)
              return (
                <Link
                  key={x.id}
                  href={`/dashboard/rnd/experiments/${x.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '10px 14px', borderRadius: 10, border: `1px solid ${BORDER.light}`,
                    background: 'rgba(255,255,255,.5)', textDecoration: 'none',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{x.experiment_number}</span>
                  <span style={{ fontSize: 12.5, color: TEXT.muted, flex: '1 1 auto', minWidth: 0 }}>{x.title}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
                    {label}
                  </span>
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

      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
          type="button"
          style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${DANGER.border}`, background: DANGER.light, color: DANGER.text, fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? 'Deleting…' : 'Delete Prototype'}
        </button>
        <button onClick={handleSave} disabled={saving} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

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
