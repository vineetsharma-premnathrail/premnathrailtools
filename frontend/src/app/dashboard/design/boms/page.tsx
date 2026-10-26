'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignBom, DesignLookupOption, DesignNewItemRequest, DesignWhereUsed } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { secondaryBtnStyle, primaryBtnStyle, chipBtnStyle, RowCount, pillStyle } from '@/components/shared/ui'
import { BOM_STATUS_LABELS, toOptions } from '@/components/design/designMeta'
import { useDesignMe } from '@/components/design/useDesignMe'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'
import OrderProjectPicker, { OrderProjectChip, OrderProjectValue } from '@/components/sales/OrderProjectPicker'

const STATUS_HEX: Record<string, string> = {
  draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', released: '#16A34A', revising: '#0f766e', obsolete: '#DC2626', superseded: '#a8a29e',
}
const OPEN_REV_LABELS: Record<string, string> = { draft: 'draft', in_review: 'in check', in_approval: 'awaiting release' }

const STATUS_TABS = [
  { key: 'draft,in_review,in_approval,released,revising', label: 'Active' },
  { key: 'released,revising', label: 'Released' },
  { key: 'in_review,in_approval', label: 'In Workflow' },
  { key: 'draft', label: 'Draft' },
  { key: 'obsolete', label: 'Obsolete' },
  { key: '', label: 'All' },
]

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '8px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const linkStyle: React.CSSProperties = { color: '#FF6A2A', fontWeight: 600, cursor: 'pointer' }

function pill(status: string) {
  const hex = STATUS_HEX[status] || '#78716c'
  return (
    <span style={pillStyle(hex)}>
      {BOM_STATUS_LABELS[status] || status}
    </span>
  )
}

export default function DesignBomsPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const searchParams = useSearchParams()
  const me = useDesignMe(isAuthorized)

  const initialStatus = searchParams.get('status')
  const [boms, setBoms] = useState<DesignBom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [opFilter, setOpFilter] = useState<OrderProjectValue | null>(null)
  const [statusTab, setStatusTab] = useState(initialStatus ?? STATUS_TABS[0].key)

  const [newItems, setNewItems] = useState<DesignNewItemRequest[]>([])
  const [newItemsOpen, setNewItemsOpen] = useState(false)

  // Where used
  const [wuKind, setWuKind] = useState<'item' | 'drawing'>('item')
  const [wuItems, setWuItems] = useState<DesignLookupOption[]>([])
  const [wuDocs, setWuDocs] = useState<DesignLookupOption[]>([])
  const [wuSearch, setWuSearch] = useState('')
  const [wuPick, setWuPick] = useState('')
  const [wuResult, setWuResult] = useState<DesignWhereUsed | null>(null)
  const [wuBusy, setWuBusy] = useState(false)
  const [wuError, setWuError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusTab) params.status = statusTab
    if (search.trim()) params.search = search.trim()
    if (opFilter) params.order_project_id = opFilter.projectId
    const handle = setTimeout(() => {
      setLoading(true)
      designApi.listBoms(params)
        .then((data) => { setBoms(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load BOMs.')))
        .finally(() => setLoading(false))
    }, search ? 250 : 0)
    return () => clearTimeout(handle)
  }, [isAuthorized, statusTab, search, opFilter])

  useEffect(() => {
    if (!isAuthorized) return
    designApi.listNewItemRequests().then(setNewItems).catch(() => { /* panel only — the register still works */ })
    Promise.all([designApi.lookupItems(), designApi.lookupDocuments()])
      .then(([i, d]) => { setWuItems(i); setWuDocs(d) })
      .catch(() => { /* where-used pickers only */ })
  }, [isAuthorized])

  const wuOptions = useMemo(() => toOptions(wuKind === 'item' ? wuItems : wuDocs), [wuKind, wuItems, wuDocs])

  if (isLoading || !isAuthorized) return null

  const canCreate = !!me && me.role !== 'viewer'

  const searchWuItems = async () => {
    const q = wuSearch.trim()
    if (!q) return
    setWuError('')
    try {
      const found = wuKind === 'item' ? await designApi.lookupItems(q) : await designApi.lookupDocuments(q)
      if (wuKind === 'item') setWuItems(found)
      else setWuDocs(found)
      if (!found.length) setWuError(`Nothing matches “${q}”.`)
    } catch (err) {
      setWuError(extractErrorMessages(err, 'Search failed.'))
    }
  }

  const runWhereUsed = async (value: string) => {
    setWuPick(value)
    setWuResult(null)
    setWuError('')
    if (!value) return
    setWuBusy(true)
    try {
      setWuResult(await designApi.whereUsed(wuKind === 'item' ? { store_item_id: Number(value) } : { document_id: Number(value) }))
    } catch (err) {
      setWuError(extractErrorMessages(err, 'The where-used search failed.'))
    } finally {
      setWuBusy(false)
    }
  }

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Bills of Materials</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>Engineering BOMs — one per product item, revision-controlled like drawings. Released BOMs are what Store and Purchase build from.</p>
        </div>
        {canCreate && (
          <button
            data-tour="design-boms-new-btn"
            onClick={() => router.push('/dashboard/design/boms/new')}
            style={primaryBtnStyle}
          >
            + New BOM
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {/* New item codes requested from Store */}
      {newItems.length > 0 && (
        <div style={sectionStyle}>
          <div data-tour="design-boms-new-items" onClick={() => setNewItemsOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <p style={{ ...sectionTitle, flex: 1 }}>New item codes requested · {newItems.length}</p>
            <span style={{ fontSize: 12, color: TEXT.muted }}>BOM lines waiting for Store to create the Item Master code</span>
            <span style={{ fontSize: 13, color: TEXT.secondary }}>{newItemsOpen ? '▾' : '▸'}</span>
          </div>
          {newItemsOpen && (
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr>{['BOM', 'New item', 'Specification', 'UOM', 'Requested by', 'Requested'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={newItems.length} />}</th>)}</tr>
                </thead>
                <tbody>
                  {newItems.map((n) => (
                    <tr key={n.line_id}>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        <span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/design/boms', n, 'bom_id'))}>{n.bom_number}</span> <span style={{ color: TEXT.muted }}>{n.revision_label}</span>
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{n.new_item_name}</td>
                      <td style={{ ...tdStyle, maxWidth: 320 }}>{n.new_item_spec || '—'}</td>
                      <td style={tdStyle}>{n.uom || '—'}</td>
                      <td style={tdStyle}>{n.requested_by_name || '—'}</td>
                      <td style={tdStyle}>{formatDate(n.requested_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div data-tour="design-boms-status-tabs" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {STATUS_TABS.map((t) => {
          const active = statusTab === t.key
          return (
            <button key={t.label} type="button" onClick={() => setStatusTab(t.key)} style={chipBtnStyle(active)}>
              {t.label}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input data-tour="design-boms-search" style={{ ...inputStyle, flex: '1 1 260px', minWidth: 200, maxWidth: 420 }} placeholder="Search by BOM number, title or product item…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div data-tour="design-boms-order-project" style={{ flex: '0 1 280px', minWidth: 220 }}>
          <OrderProjectPicker value={opFilter} requireElement={false} placeholder="All order projects" onChange={(v) => setOpFilter(v ? { projectId: v.projectId, elementId: null } : null)} />
        </div>
        <span style={{ fontSize: 12, color: TEXT.muted }}>{loading ? '' : `${boms.length} BOM${boms.length === 1 ? '' : 's'}`}</span>
      </div>

      <div data-tour="design-boms-table" style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 360px)', marginBottom: 16,
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
          <thead>
            <tr>
              {['BOM No.', 'Product item', 'Title', 'Project', 'Released Rev', 'Work in Progress', 'Lines', 'Owner', 'Status'].map((h, i) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}{i === 0 && <RowCount count={boms.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : boms.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                No BOMs match these filters.{statusTab !== '' ? ' Try the “All” tab.' : ' Use + New BOM to create one.'}
              </td></tr>
            ) : (
              boms.map((b) => (
                <tr key={b.id} onClick={() => router.push(recordPath('/dashboard/design/boms', b))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{b.bom_number}</td>
                  <td style={{ ...cellStyle, maxWidth: 280 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong>{b.product_item_code || '—'}</strong>{b.product_item_name ? ` — ${b.product_item_name}` : ''}
                    </div>
                  </td>
                  <td style={{ ...cellStyle, maxWidth: 280 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</div>
                    {b.doc_number && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{b.doc_number}</div>}
                  </td>
                  <td style={{ ...cellStyle, maxWidth: 220 }}>
                    {b.order_project_number && <div style={{ marginBottom: 4 }}><OrderProjectChip opNumber={b.order_project_number} elementNo={b.order_project_element_no} label={b.order_project_element_label} /></div>}
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.pm_project_label || b.erp_project_label || (b.order_project_number ? '' : '—')}</div>
                  </td>
                  <td style={cellStyle}>
                    {b.released_revision_label ? (
                      <><strong>{b.released_revision_label}</strong> <span style={{ color: TEXT.muted, fontSize: 12 }}>· {formatDate(b.released_at)}</span></>
                    ) : <span style={{ color: TEXT.muted }}>Not released</span>}
                  </td>
                  <td style={cellStyle}>
                    {b.open_revision_label ? (
                      <span>{b.open_revision_label} {OPEN_REV_LABELS[b.open_revision_status || ''] || ''}
                        {b.pending_with_name && <span style={{ color: TEXT.muted, fontSize: 12 }}> · with {b.pending_with_name}</span>}
                      </span>
                    ) : <span style={{ color: TEXT.muted }}>—</span>}
                  </td>
                  <td style={cellStyle}>{b.line_count}</td>
                  <td style={cellStyle}>{b.owner_name || '—'}</td>
                  <td style={cellStyle}>{pill(b.display_status)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Where used */}
      <div style={sectionStyle}>
        <p data-tour="design-boms-where-used" style={{ ...sectionTitle, marginBottom: 12 }}>Where used</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <Select data-tour="design-boms-wu-kind" style={{ ...inputStyle, flex: '0 1 150px' }} value={wuKind} onChange={(e) => { setWuKind(e.target.value as 'item' | 'drawing'); setWuPick(''); setWuResult(null); setWuError('') }}>
            <option value="item">Item</option>
            <option value="drawing">Drawing</option>
          </Select>
          <div data-tour="design-boms-wu-pick" style={{ flex: '1 1 300px', maxWidth: 440 }}>
            <SearchableSelect value={wuPick} onChange={runWhereUsed} options={wuOptions} placeholder={wuKind === 'item' ? 'Pick an Item Master item…' : 'Pick a drawing…'} />
          </div>
          <input data-tour="design-boms-wu-search" style={{ ...inputStyle, flex: '0 1 220px' }} value={wuSearch} placeholder={wuKind === 'item' ? 'Not listed? Search items…' : 'Not listed? Search drawings…'}
            onChange={(e) => setWuSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') searchWuItems() }} />
          <button type="button" style={secondaryBtnStyle} disabled={!wuSearch.trim()} onClick={searchWuItems}>Search</button>
        </div>
        {wuError && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '0 0 8px' }}>{Array.isArray(wuError) ? wuError.join(' ') : wuError}</p>}
        {wuBusy && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Searching…</p>}
        {wuResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 13, color: TEXT.body, margin: 0 }}><strong>{wuResult.subject}</strong></p>
            {wuResult.own_boms.length > 0 && (
              <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
                Has its own BOM (sub-assembly):{' '}
                {wuResult.own_boms.map((b, i) => (
                  <span key={b.id}>{i > 0 && ', '}<span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/design/boms', b))}>{b.bom_number}</span> — {b.title}</span>
                ))}
              </p>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr>{['Used in BOM', 'Revision', 'Product', 'Qty', 'Project / machine'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={wuResult.boms.length} />}</th>)}</tr>
                </thead>
                <tbody>
                  {wuResult.boms.length === 0 ? (
                    <tr><td colSpan={5} style={{ ...tdStyle, color: TEXT.muted, textAlign: 'center' }}>Not used in any BOM.</td></tr>
                  ) : wuResult.boms.map((r) => (
                    <tr key={`${r.bom_id}-${r.revision_id}`}>
                      <td style={tdStyle}><span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/design/boms', r, 'bom_id'))}>{r.bom_number}</span> — {r.bom_title}</td>
                      <td style={tdStyle}>{r.revision_label} <span style={{ color: TEXT.muted }}>({BOM_STATUS_LABELS[r.revision_status] || r.revision_status})</span></td>
                      <td style={tdStyle}>{r.product_item_label || '—'}</td>
                      <td style={tdStyle}>{r.quantity ?? '—'}</td>
                      <td style={tdStyle}>{r.pm_project_label || r.erp_project_label || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 280px' }}>
                <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Drawings</p>
                {wuResult.drawings.length === 0 ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>None</p> : wuResult.drawings.map((d) => (
                  <p key={d.id} style={{ fontSize: 12.5, margin: '0 0 2px' }}>
                    <span style={linkStyle} onClick={() => router.push(recordPath('/dashboard/design/documents', d))}>{d.doc_number}</span> — {d.title}
                  </p>
                ))}
              </div>
              <div style={{ flex: '1 1 280px' }}>
                <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Projects</p>
                {wuResult.projects.length === 0 ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>None</p> : wuResult.projects.map((p) => (
                  <p key={p} style={{ fontSize: 12.5, color: TEXT.body, margin: '0 0 2px' }}>{p}</p>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
