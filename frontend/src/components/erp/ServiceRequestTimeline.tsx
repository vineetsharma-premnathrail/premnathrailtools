'use client'

/**
 * Service Request › Audit Trail tab.
 *
 * Audit rows (GET /erp/service-requests/{id}/audit) grouped into readable
 * stages — same person, same kind of activity, within a few minutes = one card
 * (expand a card for each entry with its exact time). System events (emails)
 * are kept out of the service story and shown only under their own chip.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, CaretDown, CaretUp, ClipboardText, Envelope, FilePlus, FileText, Image as ImageIcon,
  Package, Receipt, ArrowsClockwise, Warning, Wrench, VideoCamera,
} from '@phosphor-icons/react'
import { erpApi } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { AuditEntry } from '@/types'
import { Pill, chipBtnStyle, smallSecondaryBtnStyle } from '@/components/shared/ui'

type Category = 'activity' | 'status' | 'technical' | 'attachments' | 'materials' | 'billing' | 'system'

const CATEGORY: Record<Category, { label: string; hex: string; Icon: typeof Wrench }> = {
  activity: { label: 'Service activity', hex: '#2563eb', Icon: Wrench },
  status: { label: 'Status history', hex: '#7c3aed', Icon: ArrowsClockwise },
  technical: { label: 'Technical updates', hex: '#0d9488', Icon: ClipboardText },
  attachments: { label: 'Attachments', hex: '#d97706', Icon: FileText },
  materials: { label: 'Materials', hex: '#0891b2', Icon: Package },
  billing: { label: 'Billing', hex: '#16a34a', Icon: Receipt },
  system: { label: 'System events', hex: '#64748b', Icon: Envelope },
}
const CATEGORY_ORDER: Category[] = ['activity', 'status', 'technical', 'attachments', 'materials', 'billing', 'system']

// Fields edited on the SR (backend _TRACKED_FIELDS labels) that describe the fault / fix.
const TECHNICAL_FIELDS = new Set([
  'Issue Title', 'Description', 'Category', 'Sub-Category', 'Failure Mode', 'Root Cause', 'Resolution', 'Service Notes',
])

const STATUS_LABELS: Record<string, string> = {
  open: 'Reported', acknowledged: 'Acknowledged', assigned: 'Assigned', scheduled: 'Scheduled',
  in_progress: 'In Progress', pending_parts: 'Pending Parts', on_hold: 'On Hold',
  work_completed: 'Work Completed', review: 'Review', closed: 'Closed', cancelled: 'Cancelled',
}
const statusLabel = (v?: string | null) => (v ? STATUS_LABELS[v.toLowerCase()] || v : '—')

/** Display text for a stored old/new value: blanks become —, True/False become Yes/No. */
function shownValue(field: string | undefined, v?: string | null): string {
  if (v == null || v === '' || v === 'None' || v === '—') return '—'
  if (field === 'Status') return statusLabel(v)
  if (v === 'True') return 'Yes'
  if (v === 'False') return 'No'
  return v
}

/** "reported_by_phone" → "Reported by phone" (rows saved before the backend labelled every field). */
const fieldLabel = (f: string) => { const s = f.replace(/_/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1) }

function categoryOf(e: AuditEntry): Category {
  const a = e.action
  if (a === 'email_sent' || a === 'email_failed') return 'system'
  if (a.startsWith('attachment_') || a.startsWith('material_photo_')) return 'attachments'
  if (a.startsWith('material_') || a === 'pr_raised') return 'materials'
  if (a === 'invoice_drafted') return 'billing'
  if (a === 'field_updated') {
    if (e.field_name === 'Status') return 'status'
    if (e.field_name && TECHNICAL_FIELDS.has(e.field_name)) return 'technical'
  }
  return 'activity'
}

// Rows by the same person, same kind, this close together are one activity.
const GROUP_GAP_MS = 5 * 60 * 1000

type Group = { key: string; category: Category; by: string; entries: AuditEntry[]; start: Date | null; end: Date | null }

const toDate = (s?: string) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d }
const hhmm = (d: Date | null, seconds = false) =>
  d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) }) : ''
const longDate = (d: Date | null) => (d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '')

function groupEntries(entries: AuditEntry[]): Group[] {
  const groups: Group[] = []
  for (const e of entries) {
    const cat = categoryOf(e)
    const at = toDate(e.performed_at)
    const last = groups[groups.length - 1]
    // "Request created" always opens its own card; status changes stay together.
    const joinable = last && e.action !== 'created' && last.category === cat && last.by === e.performed_by
      && (!at || !last.end || at.getTime() - last.end.getTime() <= GROUP_GAP_MS)
    if (joinable) {
      last.entries.push(e)
      if (at) last.end = at
    } else {
      groups.push({ key: `g${e.id}`, category: cat, by: e.performed_by, entries: [e], start: at, end: at })
    }
  }
  return groups
}

function groupTitle(g: Group): string {
  const actions = new Set(g.entries.map((e) => e.action))
  switch (g.category) {
    case 'activity':
      if (actions.has('created')) return 'Request created'
      if (actions.has('deleted')) return 'Moved to recycle bin'
      if (actions.has('restored')) return 'Restored'
      if (actions.has('machine_commissioned')) return 'Machine commissioned'
      if (actions.has('warranty_checked')) return 'Warranty checked'
      if (g.entries.some((e) => e.field_name === 'Assigned To')) return 'Engineer assigned'
      if (g.entries.some((e) => e.field_name?.startsWith('Expected'))) return 'Service scheduled'
      return 'Details updated'
    case 'status': {
      const last = g.entries[g.entries.length - 1]?.new_value?.toLowerCase()
      if (last === 'closed') return 'Service closed'
      if (last === 'cancelled') return 'Request cancelled'
      if (last === 'work_completed' || last === 'review') return 'Service completed'
      return 'Status changed'
    }
    case 'technical':
      return g.entries.some((e) => e.field_name === 'Root Cause' || e.field_name === 'Resolution')
        ? 'Diagnosis & resolution recorded' : 'Issue details updated'
    case 'attachments':
      return [...actions].every((a) => a.endsWith('_deleted')) ? 'Attachments removed' : 'Attachments uploaded'
    case 'materials':
      if (actions.has('pr_raised')) return 'Purchase requisition raised'
      if (actions.has('material_issued')) return 'Spares issued from store'
      return 'Materials updated'
    case 'billing':
      return 'Invoice drafted'
    case 'system':
      return actions.has('email_failed') ? 'Notification failed' : 'Notification sent'
  }
}

/** File names out of "… uploaded 3 file(s): a.jpg, b.mp4" summaries. */
function uploadedFiles(g: Group): string[] {
  const out: string[] = []
  for (const e of g.entries) {
    if (e.action !== 'attachment_uploaded') continue
    const m = /file\(s\):\s*(.+)$/.exec(e.summary || '')
    if (m) out.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean))
  }
  return out
}
const VIDEO = /\.(mp4|mov|avi|mkv|webm|3gp|m4v)$/i
const PHOTO = /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (d) return `${d}d ${h}h ${m}m`
  if (h) return `${h}h ${m}m ${sec}s`
  return `${m}m ${sec}s`
}

const glass: React.CSSProperties = {
  borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
  border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)',
}
const muted: React.CSSProperties = { fontSize: 11.5, color: '#78716c' }
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: 0.4 }

type Props = {
  srId: number
  requestNumber: string
  status: string
  createdAt?: string
  closedAt?: string
}

export default function ServiceRequestTimeline({ srId, requestNumber, status, createdAt, closedAt }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Category | null>(null)
  const [now] = useState(() => Date.now()) // "Open for …" is measured from when the tab opened

  useEffect(() => {
    erpApi.getAuditTrail(srId)
      .then((rows: AuditEntry[]) => setEntries(rows
        // Older saves logged "blank → blank" when a form sent "" for an empty
        // field; nothing changed there, so it is not history.
        .filter((e) => !(e.action === 'field_updated' && shownValue(e.field_name, e.old_value) === shownValue(e.field_name, e.new_value)))
        .map((e) => (e.field_name?.includes('_') ? { ...e, field_name: fieldLabel(e.field_name) } : e))))
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the audit trail — check your connection and reload the page.').join(' ')))
      .finally(() => setLoading(false))
  }, [srId])

  const counts = useMemo(() => {
    const c = {} as Record<Category, number>
    for (const e of entries) { const k = categoryOf(e); c[k] = (c[k] || 0) + 1 }
    return c
  }, [entries])
  const failedMails = useMemo(() => entries.filter((e) => e.action === 'email_failed').length, [entries])

  // No chip = the service story, without system events.
  const visible = useMemo(
    () => entries.filter((e) => (filter ? categoryOf(e) === filter : categoryOf(e) !== 'system')),
    [entries, filter],
  )
  const groups = useMemo(() => groupEntries(visible), [visible])

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (entries.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No history yet — every change to this request will show here.</p>

  const created = toDate(createdAt) || toDate(entries[0]?.performed_at)
  const isClosed = status === 'closed'
  const closed = isClosed ? toDate(closedAt) : null
  const durationText = created
    ? (closed ? `Total duration ${fmtDuration(closed.getTime() - created.getTime())}` : `Open for ${fmtDuration(now - created.getTime())}`)
    : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header: what this is, status, total time */}
      <div style={{ ...glass, padding: '14px 18px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1f1108' }}>Service request timeline</span>
            <Pill label={statusLabel(status)} hex={isClosed ? '#16a34a' : status === 'cancelled' ? '#dc2626' : '#2563eb'} />
          </div>
          <div style={{ ...muted, marginTop: 2 }}>
            {requestNumber}{created ? ` · raised ${longDate(created)}` : ''}{durationText ? ` · ${durationText}` : ''}
          </div>
        </div>
      </div>

      {/* Category chips — counts filter the list (click again to clear) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <button type="button" style={chipBtnStyle(filter === null)} onClick={() => setFilter(null)}>
          Service story · {entries.length - (counts.system || 0)}
        </button>
        {CATEGORY_ORDER.filter((c) => counts[c]).map((c) => (
          <button key={c} type="button" style={chipBtnStyle(filter === c)} onClick={() => setFilter(filter === c ? null : c)}>
            {CATEGORY[c].label} · {counts[c]}
          </button>
        ))}
      </div>

      {failedMails > 0 && filter !== 'system' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 12.5 }}>
          <Warning size={16} weight="bold" />
          <span style={{ flex: 1 }}>
            {failedMails} notification email{failedMails > 1 ? 's' : ''} could not be sent. The service work is not affected — open System events to see the reason and who was not informed.
          </span>
          <button type="button" style={smallSecondaryBtnStyle} onClick={() => setFilter('system')}>View</button>
        </div>
      )}

      <TimelineView groups={groups} />
    </div>
  )
}

function TimelineView({ groups }: { groups: Group[] }) {
  if (groups.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>Nothing in this category.</p>
  const dayOf = (g?: Group) => (g?.start ? formatDate(g.start) : '')
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {groups.map((g, i) => {
        const day = dayOf(g)
        const showDay = day && day !== dayOf(groups[i - 1])
        return (
          <div key={g.key}>
            {showDay && (
              <div style={{ ...label, margin: i === 0 ? '0 0 8px 0' : '10px 0 8px 0' }}>{longDate(g.start)}</div>
            )}
            <TimelineItem g={g} step={i + 1} last={i === groups.length - 1} />
          </div>
        )
      })}
    </div>
  )
}

function TimelineItem({ g, step, last }: { g: Group; step: number; last: boolean }) {
  const [open, setOpen] = useState(false)
  const meta = CATEGORY[g.category]
  const failed = g.entries.some((e) => e.action === 'email_failed')
  const hex = failed ? '#dc2626' : meta.hex
  const Icon = failed ? Warning : meta.Icon
  const sameMinute = g.start && g.end && hhmm(g.start) === hhmm(g.end)
  const when = g.start
    ? (g.end && !sameMinute ? `${hhmm(g.start)}–${hhmm(g.end)}` : hhmm(g.start, true))
    : ''

  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {/* Rail: numbered icon + connecting line */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none', width: 32 }}>
        <div title={`Step ${step}`} style={{ width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${hex}1a`, color: hex, border: `1px solid ${hex}40` }}>
          <Icon size={17} weight="bold" />
        </div>
        {!last && <div style={{ flex: 1, width: 2, minHeight: 12, background: 'rgba(120,113,108,0.25)', margin: '4px 0' }} />}
      </div>

      <div style={{ ...glass, flex: 1, minWidth: 0, padding: '12px 16px', marginBottom: last ? 0 : 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#1f1108' }}>{step}. {groupTitle(g)}</span>
          <span style={muted}>{when} · {g.by}</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <GroupBody g={g} open={open} />
        </div>
        {g.entries.length > 1 && (
          <button type="button" style={{ ...smallSecondaryBtnStyle, marginTop: 10 }} onClick={() => setOpen(!open)}>
            {open ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
            {open ? 'Hide entries' : `Show ${g.entries.length} entries`}
          </button>
        )}
      </div>
    </div>
  )
}

/** Summary of a group; `open` adds each raw entry underneath with its exact time. */
function GroupBody({ g, open }: { g: Group; open: boolean }) {
  const text: React.CSSProperties = { fontSize: 13, color: '#57534e', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
  let summary: React.ReactNode

  if (g.category === 'status') {
    const chain = [g.entries[0].old_value, ...g.entries.map((e) => e.new_value)]
    const reasons = g.entries.map((e) => /Reason: (.+)$/.exec(e.summary || '')?.[1]).filter(Boolean)
    summary = (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {chain.map((s, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <ArrowRight size={12} color="#a8a29e" />}
              <Pill label={statusLabel(s)} hex={s?.toLowerCase() === 'closed' ? '#16a34a' : s?.toLowerCase() === 'cancelled' ? '#dc2626' : '#7c3aed'} />
            </span>
          ))}
        </div>
        {reasons.map((r, i) => <p key={i} style={{ ...text, marginTop: 6 }}><b>Reason:</b> {r}</p>)}
      </>
    )
  } else if (g.category === 'technical') {
    // Latest value of each field in this group.
    const latest = new Map<string, AuditEntry>()
    for (const e of g.entries) if (e.field_name) latest.set(e.field_name, e)
    summary = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[...latest.values()].map((e) => {
          const before = shownValue(e.field_name, g.entries.find((x) => x.field_name === e.field_name)?.old_value)
          return (
            <div key={e.field_name}>
              <div style={label}>{e.field_name}</div>
              <p style={text}>{shownValue(e.field_name, e.new_value)}</p>
              {before !== '—' && <p style={{ ...muted, marginTop: 2 }}>Earlier: {before}</p>}
            </div>
          )
        })}
      </div>
    )
  } else if (g.category === 'attachments') {
    const files = uploadedFiles(g)
    const videos = files.filter((f) => VIDEO.test(f)).length
    const photos = files.filter((f) => PHOTO.test(f)).length
    const docs = files.length - videos - photos
    const others = g.entries.filter((e) => e.action !== 'attachment_uploaded')
    summary = (
      <>
        {files.length > 0 && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: '#44403c' }}>
            {photos > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><ImageIcon size={16} /> {photos} photo{photos > 1 ? 's' : ''}</span>}
            {videos > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><VideoCamera size={16} /> {videos} video{videos > 1 ? 's' : ''}</span>}
            {docs > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><FilePlus size={16} /> {docs} document{docs > 1 ? 's' : ''}</span>}
          </div>
        )}
        {(open || files.length === 0) && others.map((e) => <p key={e.id} style={{ ...text, marginTop: 4 }}>{e.summary || e.action}</p>)}
        {open && files.length > 0 && <p style={{ ...muted, marginTop: 6 }}>{files.join(', ')}</p>}
      </>
    )
    return <>{summary}</>
  } else if (g.category === 'activity' && g.entries[0].action === 'created') {
    const s = g.entries[0].summary || ''
    summary = (
      <>
        <p style={text}>{s || 'Service request created.'}</p>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {/free of charge/i.test(s) && <Pill label="Free of charge" hex="#16a34a" />}
          {/;\s*chargeable/i.test(s) && <Pill label="Chargeable" hex="#d97706" />}
          {/under warranty|in warranty/i.test(s) && <Pill label="Under warranty" hex="#2563eb" />}
        </div>
      </>
    )
  } else {
    // Activity / materials / billing / system: field edits as old → new, others as their sentence.
    const shown = open ? g.entries : g.entries.slice(0, 3)
    summary = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {shown.map((e) => <EntryLine key={e.id} e={e} />)}
        {!open && g.entries.length > 3 && <span style={muted}>+ {g.entries.length - 3} more</span>}
      </div>
    )
    return <>{summary}</>
  }

  return (
    <>
      {summary}
      {open && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(120,113,108,0.18)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {g.entries.map((e) => <EntryLine key={e.id} e={e} withTime />)}
        </div>
      )}
    </>
  )
}

function EntryLine({ e, withTime }: { e: AuditEntry; withTime?: boolean }) {
  const at = toDate(e.performed_at)
  return (
    <div style={{ fontSize: 12.5, color: '#57534e', wordBreak: 'break-word' }}>
      {withTime && <span style={{ ...muted, marginRight: 6 }}>{hhmm(at, true)}</span>}
      {e.field_name && e.action !== 'chargeability_overridden'
        ? <><b style={{ color: '#44403c' }}>{e.field_name}:</b> {shownValue(e.field_name, e.old_value)} <ArrowRight size={11} style={{ verticalAlign: -1 }} /> {shownValue(e.field_name, e.new_value)}</>
        : (e.summary || e.action)}
    </div>
  )
}
