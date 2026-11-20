'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowsClockwise, ChatCircleDots, CheckSquare, FileArrowUp, FileText, Flag, FolderSimple, PaperPlaneTilt, Paperclip, SealCheck,
  type Icon,
} from '@phosphor-icons/react'
import { rndApi } from '@/lib/api'
import { RndProjectHistoryEntry } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { chipBtnStyle, inputStyle as sharedInputStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'

// Entry kinds the Timeline can show (older milestone entries stay readable).
const KIND: Record<string, { text: string; hex: string; icon: Icon }> = {
  revision: { text: 'Revision', hex: '#2563EB', icon: ArrowsClockwise },
  review: { text: 'Review', hex: '#16A34A', icon: SealCheck },
  requirement: { text: 'Requirement', hex: '#475569', icon: FileText },
  task: { text: 'Task', hex: '#7C3AED', icon: CheckSquare },
  response: { text: 'Response', hex: '#0D9488', icon: PaperPlaneTilt },
  query: { text: 'Asked BD', hex: '#9333EA', icon: ChatCircleDots },
  offer: { text: 'Technical Offer', hex: '#D97706', icon: FileArrowUp },
  document: { text: 'Document', hex: '#64748B', icon: Paperclip },
  milestone: { text: 'Milestone', hex: '#2563EB', icon: Flag },
  project: { text: 'Project', hex: '#78716c', icon: FolderSimple },
}
const kindOf = (k: string) => KIND[k] || { text: k.charAt(0).toUpperCase() + k.slice(1), hex: '#78716c', icon: FileText }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const inputStyle: React.CSSProperties = { ...sharedInputStyle, background: 'rgba(255,255,255,.7)' }

const dayKey = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dayLabel = (key: string) => {
  if (!key) return 'Date not recorded'
  const today = dayKey(new Date().toISOString())
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (key === today) return 'Today'
  if (key === dayKey(y.toISOString())) return 'Yesterday'
  const [yy, mm, dd] = key.split('-').map(Number)
  return new Date(yy, mm - 1, dd).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}
const timeOf = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''

/** "Suraj Verma completed task 'X'.\nDelay reason: …" → the performer's name is shown once (bold, above),
 *  the first line is the headline and further lines (reasons, remarks) sit in a muted note block. */
function splitSummary(summary: string, by: string) {
  let text = (summary || '').trim()
  if (by && text.toLowerCase().startsWith(by.toLowerCase() + ' ')) text = text.slice(by.length + 1)
  const [head, ...rest] = text.split('\n')
  const headline = head ? head.charAt(0).toUpperCase() + head.slice(1) : ''
  return { headline, note: rest.join('\n').trim() }
}

/** Timeline of an R&D requirement or Prototype / Research project — read only, newest first: revisions, accept /
 *  return (with the reason), response, task events, offers, documents and project links.
 *  A requirement passes its own `load` and wording; the project passes only `projectId`. */
export default function RndProjectHistory({ projectId, load, tour = 'rnd-pd-history', errorText = 'Could not load the timeline. Refresh the page; if it keeps failing, check you can still open this project.' }: {
  projectId: number | string
  load?: () => Promise<RndProjectHistoryEntry[]>
  tour?: string
  errorText?: string
}) {
  const [entries, setEntries] = useState<RndProjectHistoryEntry[] | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')

  useEffect(() => {
    (load ? load() : rndApi.projectHistory(Number(projectId)))
      .then((d) => setEntries(Array.isArray(d) ? d : []))
      .catch((err) => { setEntries([]); setError(extractErrorMessages(err, errorText)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const all = useMemo(() => entries || [], [entries])
  const kinds = useMemo(() => {
    const n: Record<string, number> = {}
    for (const e of all) n[e.kind] = (n[e.kind] || 0) + 1
    return Object.entries(n).sort((a, b) => b[1] - a[1])
  }, [all])
  const q = search.trim().toLowerCase()
  const shown = all.filter((e) => (!kind || e.kind === kind) && (!q || [e.summary, e.performed_by, kindOf(e.kind).text].some((v) => (v || '').toLowerCase().includes(q))))
  const days: { key: string; items: RndProjectHistoryEntry[] }[] = []
  for (const e of shown) {
    const k = dayKey(e.performed_at)
    const last = days[days.length - 1]
    if (last && last.key === k) last.items.push(e)
    else days.push({ key: k, items: [e] })
  }

  return (
    <div data-tour={tour} style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }}>Timeline</p>
        {entries && entries.length > 0 && <span style={{ fontSize: 12, color: TEXT.muted }}>{all.length} event{all.length === 1 ? '' : 's'} · newest first</span>}
      </div>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px' }}>Everything that happened, in order — revisions from BD, reviews, tasks, documents, offers and responses.</p>

      {error ? (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      ) : !entries ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
      ) : all.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nothing on the timeline yet.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <input style={{ ...inputStyle, flex: '1 1 240px', maxWidth: 340 }} value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search who, task, file…" aria-label="Search the timeline" />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setKind('')} style={chipBtnStyle(!kind)}>All ({all.length})</button>
              {kinds.map(([k, n]) => (
                <button key={k} type="button" onClick={() => setKind(kind === k ? '' : k)} style={chipBtnStyle(kind === k)}>{kindOf(k).text} ({n})</button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nothing matches — clear the search or pick another type.</p>
          ) : days.map((day) => (
            <section key={day.key || 'none'} style={{ marginBottom: 6 }}>
              <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0 10px' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.secondary, background: 'rgba(255,255,255,.9)', border: `1px solid ${BORDER.light}`, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>
                  {dayLabel(day.key)}
                </span>
                <span style={{ flex: 1, height: 1, background: BORDER.light }} />
              </div>
              <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {day.items.map((e, i) => {
                  const k = kindOf(e.kind)
                  const KIcon = k.icon
                  const { headline, note } = splitSummary(e.summary, e.performed_by)
                  const lastInDay = i === day.items.length - 1
                  return (
                    <li key={e.id} style={{ display: 'grid', gridTemplateColumns: '32px 1fr', columnGap: 12 }}>
                      {/* rail: icon + connector to the next event of the day */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span aria-hidden style={{ width: 30, height: 30, borderRadius: '50%', background: `${k.hex}14`, border: `1.5px solid ${k.hex}55`, color: k.hex, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <KIcon size={15} weight="bold" />
                        </span>
                        {!lastInDay && <span style={{ flex: 1, width: 2, minHeight: 12, background: BORDER.light, margin: '2px 0' }} />}
                      </div>
                      <div style={{ paddingBottom: lastInDay ? 14 : 16, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 30 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading }}>{e.performed_by || 'System'}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: k.hex, background: `${k.hex}14`, borderRadius: 999, padding: '2px 8px' }}>{k.text}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap' }} title={e.performed_at || undefined}>{timeOf(e.performed_at)}</span>
                        </div>
                        <p style={{ fontSize: 13, color: TEXT.body, margin: '2px 0 0', lineHeight: 1.5, wordBreak: 'break-word' }}>{headline}</p>
                        {note && (
                          <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '6px 0 0', padding: '7px 10px', borderRadius: 8, background: 'rgba(15,23,42,.035)', borderLeft: `3px solid ${k.hex}66`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {note}
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
