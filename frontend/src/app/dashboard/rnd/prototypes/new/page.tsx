'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { RndProject, RndPrototype, RndPrototypeBomItemInput, RndStoreItemLookup } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import RndNav from '@/components/rnd/RndNav'
import AnchoredPopover from '@/components/rnd/AnchoredPopover'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath } from '@/lib/recordRef'
import { useUrlProjectId } from '@/components/rnd/projectLink'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle = sheetInput
const labelStyle = sheetLabel

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
          data-tour="rnd-pnf-add-line-btn"
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

// ── Page ──────────────────────────────────────────────────────────────────
export default function NewRndPrototypePage() {
  return (
    <Suspense fallback={null}>
      <NewRndPrototypePageInner />
    </Suspense>
  )
}

function NewRndPrototypePageInner() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [projects, setProjects] = useState<RndProject[]>([])

  const [projectId, setProjectId] = useState('')
  // ?project_id=<signed ref> — resolved into the project select's numeric id.
  const projectRef = searchParams.get('project_id')
  const projectLink = useUrlProjectId(projectRef, setProjectId)
  const [name, setName] = useState('')
  const [version, setVersion] = useState('v1')
  const [buildDate, setBuildDate] = useState('')
  const [description, setDescription] = useState('')
  const [bomLines, setBomLines] = useState<BomLine[]>(() => [blankLine()])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    rndApi.listProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load R&D projects.')))
  }, [isAuthorized])

  // Back keeps the list's project filter by passing the same signed ref along.
  const backHref = projectRef ? `/dashboard/rnd/prototypes?project_id=${encodeURIComponent(projectRef)}` : '/dashboard/rnd/prototypes'

  const handleSubmit = async () => {
    setError('')
    if (!projectId) { setError('Project is required. Pick the R&D project this prototype belongs to.'); return }
    if (!name.trim()) { setError('Prototype name is required.'); return }
    if (!version.trim()) { setError('Version is required, e.g. "v1".'); return }
    const bom = buildBomPayload(bomLines)
    if (bom.error) { setError(bom.error); return }

    setSubmitting(true)
    try {
      const proto: RndPrototype = await rndApi.createPrototype({
        project_id: Number(projectId),
        name: name.trim(),
        version: version.trim(),
        build_date: buildDate || undefined,
        description: description.trim() || undefined,
        bom_items: bom.items,
      })
      router.push(recordPath('/dashboard/rnd/prototypes', proto))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create prototype.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (projectLink.error) return (<div><RndNav /><InvalidRecordLink message={projectLink.error} listHref="/dashboard/rnd/prototypes" listLabel="Back to prototypes" /></div>)

  const draftTotal = bomLines.reduce((sum, l) => sum + lineCost(l), 0)

  return (
    <div style={{ width: '100%' }}>
      <FormPage
        tour="rnd-pnf-form"
        nav={<RndNav />}
        icon="box"
        title="New Prototype"
        subtitle="A physical build of an R&D project — its details and parts list (BOM)."
        onBack={() => router.push(backHref)} backTour="rnd-pnf-back-btn"
        footer={<>
          <button data-tour="rnd-pnf-cancel-btn" onClick={() => router.push(backHref)} disabled={submitting} type="button" style={sheetBtn('secondary', SHEET.INK, submitting)}>
            Cancel
          </button>
          <button data-tour="rnd-pnf-submit-btn" onClick={handleSubmit} disabled={submitting} type="button" style={sheetBtn('primary', SHEET.BLUE, submitting)}>
            <SheetIcon name="check" size={16} />{submitting ? 'Saving…' : 'Save Prototype'}
          </button>
        </>}
      >
        {error && (
          <div style={{ padding: '16px 24px 0' }}>
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
              {Array.isArray(error) ? error.join(' ') : error}
            </div>
          </div>
        )}

        <SheetColumns
          left={
            <SheetSection icon="list" title="Prototype Details">
              <div data-tour="rnd-pnf-project">
                <label style={labelStyle}>Project <Req /></label>
                <SearchableSelect
                  value={projectId}
                  onChange={setProjectId}
                  options={projects.map((p) => ({ value: String(p.id), label: `${p.project_number} — ${p.title}` }))}
                  placeholder="Search R&D project…"
                />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
                <div data-tour="rnd-pnf-name" style={{ flex: '1 1 220px', minWidth: 180, maxWidth: 360 }}>
                  <label style={labelStyle}>Name <Req /></label>
                  <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                </div>
                <div data-tour="rnd-pnf-version" style={{ flex: '0 1 110px', minWidth: 90 }}>
                  <label style={labelStyle}>Version <Req /></label>
                  <input style={inputStyle} value={version} onChange={(e) => setVersion(e.target.value)} />
                </div>
                <div data-tour="rnd-pnf-build-date" style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={labelStyle}>Build Date</label>
                  <DateField value={buildDate} onChange={setBuildDate} />
                </div>
              </div>
            </SheetSection>
          }
          right={<>
            <SheetSection icon="chat" title="Description" extra={<Optional />}>
              <div data-tour="rnd-pnf-description">
                <textarea style={{ ...inputStyle, minHeight: 96, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this build is for and how it differs from the last version" />
              </div>
            </SheetSection>
            <SheetSection icon="rupee" title="Summary">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: SHEET.BODY }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>BOM lines</span><b>{bomLines.filter((l) => !isEmptyLine(l)).length}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>BOM total</span><b>{formatInr(draftTotal)}</b></div>
              </div>
            </SheetSection>
          </>}
        />

        <div data-tour="rnd-pnf-bom" style={{ padding: '20px 24px 4px', borderTop: `1px solid ${SHEET.LINE}` }}>
          <SheetSection icon="box" title="Prototype BOM">
            <p style={{ ...sheetHint, margin: '-6px 0 14px' }}>
              Pick parts from the Item Master, or type a free-text name for parts that aren&apos;t in it yet. Empty lines are ignored.
            </p>
            <BomEditor lines={bomLines} onChange={setBomLines} onError={setError} />
          </SheetSection>
        </div>
      </FormPage>
    </div>
  )
}
