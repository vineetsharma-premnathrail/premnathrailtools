'use client'

// "Store Issues", "Purchases" and "Tasks" history tabs shared by the project page
// (Project Management › project) and the machine page (Projects › Past Projects ›
// machine). Built like the machine page's Maintenance History tab: load, Loading…,
// the real error, a plain-words empty state, then a glass table.

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { apiClient } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import { Pill, RowCount } from '@/components/shared/ui'
import { FormSheet, SheetSection, SHEET, sheetBtn } from '@/components/shared/FormSheet'

// ---- Row types (the backend contract) --------------------------------------

export interface StoreIssueLine { item_code: string; item_name: string; quantity: number; uom: string }
export interface StoreIssueRow {
  id: number; issue_number: string; issue_date: string | null; issue_type: string; issue_type_label: string
  status: string; issued_to: string | null; store_name: string | null; line_count: number; lines: StoreIssueLine[]
}
export interface PurchaseGrnRow { id: number; grn_number: string; grn_date: string | null; status: string; status_label: string }
export interface PurchasePoRow {
  id: number; po_number: string; vendor_name: string; po_date: string | null; status: string; status_label: string
  total_amount: number | null; grns: PurchaseGrnRow[]
}
export interface PurchaseRow {
  id: number; pr_number: string; pr_date: string | null; purpose_label: string | null; status: string; status_label: string
  requested_by_name: string; line_count: number; pos: PurchasePoRow[]
}
/** One task of the project: kind 'pm' = a task inside a milestone, kind 'rnd' = an R&D task given on the project. */
export interface TaskHistoryRow {
  id: number; kind?: 'pm' | 'rnd'; title: string; milestone_name: string | null; department_name: string | null; assignee_name: string | null
  created_by_name?: string | null; due_date: string | null; start_date?: string | null; status: string; status_label: string; completed_at: string | null
  priority?: 'standard' | 'urgent' | null; progress_percent?: number | null; description?: string | null
  checklist?: { text: string; done: boolean }[] | null
}

// ---- Endpoints (the ONLY place the URLs live) --------------------------------

export type HistoryScope = 'project' | 'machine'
// Project Management project: /projects/{id}/...   Machine (Past Projects): /erp/projects/{id}/...
const BASE: Record<HistoryScope, string> = { project: '/projects', machine: '/erp/projects' }
const PATH = { storeIssues: 'store-issues', purchases: 'purchases', tasks: 'task-history' } as const

async function fetchRows<T>(scope: HistoryScope, id: number, path: string): Promise<T[]> {
  const { data } = await apiClient.get(`${BASE[scope]}/${id}/${path}`)
  return Array.isArray(data) ? data : []
}

export const projectHistoryApi = {
  storeIssues: (scope: HistoryScope, id: number) => fetchRows<StoreIssueRow>(scope, id, PATH.storeIssues),
  purchases: (scope: HistoryScope, id: number) => fetchRows<PurchaseRow>(scope, id, PATH.purchases),
  tasks: (scope: HistoryScope, id: number) => fetchRows<TaskHistoryRow>(scope, id, PATH.tasks),
}

// ---- Shared pieces -----------------------------------------------------------

const GLASS_CARD: React.CSSProperties = {
  borderRadius: 16, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
  border: '1px solid rgba(255,255,255,.24)',
  boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'hidden',
}
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e',
  position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = { padding: '10px 14px', fontSize: 13, verticalAlign: 'top' }
const TD_SMALL: React.CSSProperties = { ...TD, fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }
const LINK: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#FF7A45', textDecoration: 'none' }
const MUTED_TEXT: React.CSSProperties = { fontSize: 13, color: '#78716c' }

const GREEN = '#047857', RED = '#b91c1c', AMBER = '#B45309', BLUE = '#2563EB', GREY = '#78716c'
/** Pill colour from a status key: finished = green, stopped = red, working = amber, waiting = blue, else grey. */
function statusHex(status: string): string {
  const s = (status || '').toLowerCase()
  if (/(cancel|reject|void|lost)/.test(s)) return RED
  if (/(partial|progress)/.test(s)) return AMBER
  if (/(complete|done|issued|received|closed|approved|achieved|posted|delivered)/.test(s)) return GREEN
  if (/(open|released|ordered|active)/.test(s)) return AMBER
  if (/(pending|submitted|review|approval|sent)/.test(s)) return BLUE
  return GREY
}
const labelOf = (label: string | null | undefined, key: string) => label || key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const inr = (v: number | null | undefined) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)

/** The tab's load/Loading…/error/empty frame. `load` is called on mount (and again when `reloadKey` changes). */
function useRows<T>(load: () => Promise<T[]>, reloadKey: string | number | undefined, errorText: string) {
  const [done, setDone] = useState<{ key: string | number | undefined; rows: T[]; error: string } | null>(null)
  useEffect(() => {
    let live = true
    load()
      .then((rows) => { if (live) setDone({ key: reloadKey, rows, error: '' }) })
      .catch((err) => { if (live) setDone({ key: reloadKey, rows: [], error: extractErrorMessages(err, errorText).join(' ') }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])
  const loading = !done || done.key !== reloadKey
  return { rows: done?.rows ?? [], loading, error: loading ? '' : done?.error ?? '' }
}

function Frame({ tour, minWidth, children }: { tour: string; minWidth: number; children: React.ReactNode }) {
  return (
    <div data-tour={tour} style={GLASS_CARD}>
      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth }}>{children}</table>
      </div>
    </div>
  )
}

type TabProps<T> = { load: () => Promise<T[]>; reloadKey?: string | number }

// ---- Store Issues --------------------------------------------------------------

export function StoreIssuesHistory({ load, reloadKey }: TabProps<StoreIssueRow>) {
  const { can } = useCan()
  const { rows, loading, error } = useRows(load, reloadKey, 'Could not load the material issues — check your connection and reload the page. If it keeps failing, ask an admin to check that your role may see this tab.')
  const [open, setOpen] = useState<number | null>(null)

  if (loading) return <p style={MUTED_TEXT}>Loading…</p>
  if (error) return <p style={{ ...MUTED_TEXT, color: '#b91c1c' }}>{error}</p>
  if (rows.length === 0) return <p data-tour="proj-hist-store-issues" style={MUTED_TEXT}>No material issued to this project yet — issues are made in Store › Material Issue with this project selected.</p>

  const linkable = can('store', 'issues', 'view')
  return (
    <Frame tour="proj-hist-store-issues" minWidth={820}>
      <thead>
        <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
          {['Issue No.', 'Date', 'Type', 'Issued to', 'Lines', 'Status'].map((h, hi) => (
            <th key={h} style={TH}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const expanded = open === r.id
          return (
            <Fragment key={r.id}>
              <tr style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={TD}>
                  {linkable
                    ? <Link href={recordPath('/dashboard/store/issues', r)} style={LINK}>{r.issue_number}</Link>
                    : <span style={{ fontSize: 13, fontWeight: 600 }}>{r.issue_number}</span>}
                </td>
                <td style={TD_SMALL}>{formatDate(r.issue_date)}</td>
                <td style={TD}>{labelOf(r.issue_type_label, r.issue_type)}</td>
                <td style={TD}>{r.issued_to || '—'}{r.store_name ? <span style={{ display: 'block', fontSize: 11.5, color: '#a8a29e' }}>from {r.store_name}</span> : null}</td>
                <td style={TD}>
                  {r.line_count > 0 ? (
                    <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.id)}
                      title={expanded ? 'Hide the items' : 'Show the items'}
                      style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#6366f1', whiteSpace: 'nowrap' }}>
                      {expanded ? '▾' : '▸'} {r.line_count} {r.line_count === 1 ? 'item' : 'items'}
                    </button>
                  ) : <span style={{ color: '#a8a29e' }}>—</span>}
                </td>
                <td style={TD}><Pill label={labelOf(null, r.status)} hex={statusHex(r.status)} /></td>
              </tr>
              {expanded && (
                <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                  <td colSpan={6} style={{ padding: '4px 14px 12px 36px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', columnGap: 16, rowGap: 4, fontSize: 12.5 }}>
                      {r.lines.map((l, i) => (
                        <Fragment key={i}>
                          <span style={{ fontWeight: 600, color: '#44403c' }}>{l.item_code}</span>
                          <span style={{ color: '#44403c' }}>{l.item_name}</span>
                          <span style={{ color: '#78716c', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{l.quantity} {l.uom}</span>
                        </Fragment>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </Frame>
  )
}

// ---- Purchases (PR → PO → GRN) --------------------------------------------------

export function PurchasesHistory({ load, reloadKey }: TabProps<PurchaseRow>) {
  const { can } = useCan()
  const { rows, loading, error } = useRows(load, reloadKey, 'Could not load the purchases — check your connection and reload the page. If it keeps failing, ask an admin to check that your role may see this tab.')

  if (loading) return <p style={MUTED_TEXT}>Loading…</p>
  if (error) return <p style={{ ...MUTED_TEXT, color: '#b91c1c' }}>{error}</p>
  if (rows.length === 0) return <p data-tour="proj-hist-purchases" style={MUTED_TEXT}>No purchase requisition is charged to this project yet — raise one in Procurement › Purchase Requisitions and pick this project.</p>

  const linkPr = can('p2p', 'purchase_requisitions', 'view')
  const linkPo = can('p2p', 'purchase_orders', 'view')
  const linkGrn = can('store', 'grn', 'view')
  const linkOr = (ok: boolean, href: () => string, text: string) =>
    ok ? <Link href={href()} style={{ ...LINK, fontSize: 12.5 }}>{text}</Link> : <span style={{ fontSize: 12.5, fontWeight: 600 }}>{text}</span>

  return (
    <Frame tour="proj-hist-purchases" minWidth={760}>
      <thead>
        <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
          {['PR No.', 'Date', 'Purpose', 'Requested by', 'Lines', 'Status'].map((h, hi) => (
            <th key={h} style={TH}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((pr) => (
          <Fragment key={pr.id}>
            <tr style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
              <td style={TD}>
                {linkPr
                  ? <Link href={recordPath('/dashboard/p2p', pr)} style={LINK}>{pr.pr_number}</Link>
                  : <span style={{ fontSize: 13, fontWeight: 600 }}>{pr.pr_number}</span>}
              </td>
              <td style={TD_SMALL}>{formatDate(pr.pr_date)}</td>
              <td style={TD}>{pr.purpose_label || '—'}</td>
              <td style={TD}>{pr.requested_by_name || '—'}</td>
              <td style={TD_SMALL}>{pr.line_count}</td>
              <td style={TD}><Pill label={labelOf(pr.status_label, pr.status)} hex={statusHex(pr.status)} /></td>
            </tr>
            <tr>
              <td colSpan={6} style={{ padding: '0 14px 10px 36px' }}>
                {pr.pos.length === 0 ? (
                  <span style={{ fontSize: 12, color: '#a8a29e' }}>No purchase order yet.</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '2px solid rgba(0,0,0,0.08)', paddingLeft: 12 }}>
                    {pr.pos.map((po) => (
                      <div key={po.id}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px', fontSize: 12.5 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#a8a29e', textTransform: 'uppercase' }}>PO</span>
                          {linkOr(linkPo, () => recordPath('/dashboard/p2p/purchase-orders', po), po.po_number)}
                          <span>{po.vendor_name || '—'}</span>
                          <span style={{ color: '#78716c' }}>{formatDate(po.po_date)}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{inr(po.total_amount)}</span>
                          <Pill label={labelOf(po.status_label, po.status)} hex={statusHex(po.status)} />
                        </div>
                        {po.grns.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '4px 0 0 22px' }}>
                            {po.grns.map((g) => (
                              <div key={g.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px', fontSize: 12.5 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#a8a29e', textTransform: 'uppercase' }}>GRN</span>
                                {linkOr(linkGrn, () => recordPath('/dashboard/store/grn', g), g.grn_number)}
                                <span style={{ color: '#78716c' }}>{formatDate(g.grn_date)}</span>
                                <Pill label={labelOf(g.status_label, g.status)} hex={statusHex(g.status)} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          </Fragment>
        ))}
      </tbody>
    </Frame>
  )
}

// ---- Tasks ------------------------------------------------------------------------

function isOverdue(due: string | null, status: string, completedAt: string | null): boolean {
  if (!due || completedAt || /(complete|done|cancel)/i.test(status)) return false
  const d = new Date(due)
  if (isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}

const KIND_LABEL = { pm: 'PM task', rnd: 'R&D task' } as const
const KIND_HEX = { pm: '#475569', rnd: GREEN } as const
const kindOf = (t: TaskHistoryRow): 'pm' | 'rnd' => (t.kind === 'rnd' ? 'rnd' : 'pm')
const progressText = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`)

/** Every task of the project in one table (PM tasks + R&D tasks). A row opens a read-only view: no edit, no delete. */
export function TaskHistory({ load, reloadKey }: TabProps<TaskHistoryRow>) {
  const { rows, loading, error } = useRows(load, reloadKey, 'Could not load the tasks — check your connection and reload the page. If it keeps failing, ask an admin to check that your role may see this tab.')
  const [openKey, setOpenKey] = useState<string | null>(null)

  if (loading) return <p style={MUTED_TEXT}>Loading…</p>
  if (error) return <p style={{ ...MUTED_TEXT, color: '#b91c1c' }}>{error}</p>
  if (rows.length === 0) return <p data-tour="proj-hist-tasks" style={MUTED_TEXT}>No tasks on this project yet — PM tasks are created inside a milestone; R&amp;D tasks come from R&amp;D › R&amp;D Tasks.</p>

  const keyOf = (t: TaskHistoryRow) => `${kindOf(t)}-${t.id}`
  const opened = openKey ? rows.find((t) => keyOf(t) === openKey) || null : null

  return (
    <>
      <Frame tour="proj-hist-tasks" minWidth={900}>
        <thead>
          <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
            {['Task', 'Type', 'Milestone', 'Assignee', 'Due date', 'Status', 'Progress', 'Completed'].map((h, hi) => (
              <th key={h} style={TH}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const late = isOverdue(t.due_date, t.status, t.completed_at)
            const kind = kindOf(t)
            return (
              <tr key={keyOf(t)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ ...TD, minWidth: 180 }}>
                  <button type="button" onClick={() => setOpenKey(keyOf(t))} title="View this task"
                    style={{ ...LINK, border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>{t.title}</button>
                </td>
                <td style={TD}><Pill label={KIND_LABEL[kind]} hex={KIND_HEX[kind]} /></td>
                <td style={TD}>{kind === 'rnd' ? '—' : t.milestone_name || '—'}</td>
                <td style={TD}>{t.assignee_name || '—'}</td>
                <td style={{ ...TD_SMALL, color: late ? RED : '#78716c' }}>{formatDate(t.due_date)}{late ? ' · overdue' : ''}</td>
                <td style={TD}><Pill label={labelOf(t.status_label, t.status)} hex={statusHex(t.status)} /></td>
                <td style={TD_SMALL}>{progressText(t.progress_percent)}</td>
                <td style={TD_SMALL}>{formatDate(t.completed_at)}</td>
              </tr>
            )
          })}
        </tbody>
      </Frame>
      {opened && <TaskViewSheet task={opened} onClose={() => setOpenKey(null)} />}
    </>
  )
}

function ViewRow({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === ''
  return (
    <div style={{ display: 'flex', gap: 16, padding: '7px 0', alignItems: 'baseline', flexWrap: 'wrap' }}>
      <div style={{ flex: '0 0 130px', fontSize: 13, color: SHEET.MUTED }}>{label}</div>
      <div style={{ flex: '1 1 220px', minWidth: 0, fontSize: 13.5, lineHeight: '20px', color: empty ? SHEET.MUTED : SHEET.INK, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{empty ? '—' : children}</div>
    </div>
  )
}

/** Read-only popup of one task (portal via FormSheet). Close only — nothing here edits or deletes. */
function TaskViewSheet({ task: t, onClose }: { task: TaskHistoryRow; onClose: () => void }) {
  const kind = kindOf(t)
  const checklist = Array.isArray(t.checklist) ? t.checklist : []
  const doneCount = checklist.filter((c) => c.done).length
  const pct = progressText(t.progress_percent)
  return (
    <FormSheet tour="proj-hist-task-view" icon="list" title={t.title} subtitle={`${KIND_LABEL[kind]} · ${(kind === 'pm' && t.milestone_name) || 'This project'}`} onClose={onClose} busy={false} width={640}
      footer={<button type="button" onClick={onClose} style={sheetBtn('secondary', SHEET.INK)}>Close</button>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetSection icon="list" title="Details">
          <ViewRow label="Description">{t.description}</ViewRow>
        </SheetSection>
        <SheetSection icon="user" title="Assignment">
          <ViewRow label="Assignee">{t.assignee_name}</ViewRow>
          <ViewRow label="Created by">{t.created_by_name}</ViewRow>
          <ViewRow label="Milestone">{kind === 'rnd' ? null : t.milestone_name}</ViewRow>
          <ViewRow label="Department">{t.department_name}</ViewRow>
        </SheetSection>
        <SheetSection icon="calendar" title="Schedule">
          <ViewRow label="Start date">{t.start_date ? formatDate(t.start_date) : null}</ViewRow>
          <ViewRow label="Due date">{t.due_date ? formatDate(t.due_date) : null}</ViewRow>
          <ViewRow label="Completed">{t.completed_at ? formatDate(t.completed_at) : null}</ViewRow>
          <ViewRow label="Status"><Pill label={labelOf(t.status_label, t.status)} hex={statusHex(t.status)} /></ViewRow>
          <ViewRow label="Priority">{t.priority ? <Pill label={t.priority === 'urgent' ? 'Urgent' : 'Standard'} hex={t.priority === 'urgent' ? RED : GREY} /> : null}</ViewRow>
        </SheetSection>
        <SheetSection icon="check" title="Progress">
          <ViewRow label="Progress">{pct === '—' ? null : pct}</ViewRow>
          <ViewRow label="Checklist">
            {checklist.length > 0 ? (
              <div>
                <div style={{ fontSize: 12, color: SHEET.MUTED, marginBottom: 4 }}>{doneCount} of {checklist.length} done</div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {checklist.map((c, i) => (
                    <li key={i} style={{ display: 'flex', gap: 8, color: c.done ? SHEET.MUTED : SHEET.INK }}>
                      <span aria-hidden="true" style={{ color: c.done ? GREEN : SHEET.MUTED }}>{c.done ? '✓' : '○'}</span>
                      <span style={{ textDecoration: c.done ? 'line-through' : 'none' }}>{c.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </ViewRow>
        </SheetSection>
      </div>
    </FormSheet>
  )
}
