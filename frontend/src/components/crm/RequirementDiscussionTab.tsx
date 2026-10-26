'use client'

// Discussion tab on a requirement sent to R&D — the same thread shows on the
// CRM Inquiry / Tender page (side="crm") and on R&D › Requirements
// (side="rnd"). Chat layout: messages in the middle (mine on the right,
// everyone else's on the left), composer pinned at the bottom. Tag people with
// "@" or the Tag button — tagged people show as chips before sending and on
// the message after, and get a bell notification. Files are open to both sides.
// BD can also pick Client / Internal documents already on the record.

import { useEffect, useMemo, useRef, useState } from 'react'
import { crmApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { CrmDocument, DiscussionPerson, DiscussionSide, RequirementComment } from '@/types'
import { formatDateTime } from '@/lib/format'
import { TEXT, GLASS, SHADOWS, BORDER, BRAND } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, chipBtnStyle, smallSecondaryBtnStyle, RowCount, pillStyle } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DiscussionDocumentPicker from '@/components/crm/DiscussionDocumentPicker'
import { extractErrorMessages } from '@/lib/validation'

const SIDE_TAG: Record<string, { label: string; color: string }> = {
  crm: { label: 'BD', color: '#2563eb' },
  rnd: { label: 'R&D', color: '#7c3aed' },
  // Departments an R&D requirement is shared with.
  design: { label: 'Design', color: '#0d9488' },
  electrical: { label: 'Electrical', color: '#d97706' },
  hydraulic: { label: 'Hydraulic & Pneumatic', color: '#0891b2' },
}
const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '3px 10px',
  borderRadius: 9999, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa',
}

function fmtSize(n?: number | null) {
  if (!n) return ''
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

// Highlight every "@Name" that belongs to a tagged person.
function renderBody(body: string, names: string[]) {
  if (!names.length) return body
  const escaped = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return body.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g')).map((p, i) => (p.startsWith('@') && names.includes(p.slice(1))
    ? <span key={i} style={{ color: '#c2410c', fontWeight: 700 }}>{p}</span>
    : <span key={i}>{p}</span>))
}

export default function RequirementDiscussionTab({ source, recordId, side }: {
  source: 'inquiry' | 'tender'
  recordId: number
  side: DiscussionSide
}) {
  const { user } = useAuth()
  const { canFeature } = useCan()
  // Posting: BD side = Inquiries & Tenders › Discussion with R&D › Create; R&D side =
  // R&D › Requirements › Discussion › Create; departments unchanged. Picking the
  // record's own documents (BD side) also needs its Documents feature.
  const canPost = side === 'crm' ? canFeature('crm', 'inquiries_tenders', 'discussion', 'create')
    : side === 'rnd' ? canFeature('rnd', 'requirements', 'discussion', 'create') : true
  const canPickDocs = side === 'crm' && canFeature('crm', 'inquiries_tenders', 'documents', 'view')
  const [items, setItems] = useState<RequirementComment[]>([])
  const [people, setPeople] = useState<DiscussionPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [tagged, setTagged] = useState<DiscussionPerson[]>([])
  const [files, setFiles] = useState<File[]>([])
  // BD side: Client / Internal documents of this record to send with the message.
  const [recordDocs, setRecordDocs] = useState<CrmDocument[] | null>(null)
  const [pickedDocs, setPickedDocs] = useState<CrmDocument[]>([])
  const [docPicker, setDocPicker] = useState(false)
  // BD side: "Attach files" first asks — upload new, or pick one already in the application.
  const [attachMenu, setAttachMenu] = useState(false)
  const attachRef = useRef<HTMLDivElement>(null)
  // Clicking anywhere outside the menu (or Esc) closes it.
  useEffect(() => {
    if (!attachMenu) return
    const onDown = (e: MouseEvent) => { if (!attachRef.current?.contains(e.target as Node)) setAttachMenu(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAttachMenu(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [attachMenu])
  const [sending, setSending] = useState(false)
  // Picker: opened by typing "@…" in the message (query = text after @) or by the Tag button (own search box).
  const [picker, setPicker] = useState<{ via: 'at' | 'button'; query: string } | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [view, setView] = useState<'messages' | 'files'>('messages')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  // The tab fills the screen down to the bottom edge; messages scroll inside it.
  const [boxHeight, setBoxHeight] = useState<number | null>(null)
  useEffect(() => {
    // Sized to the page's scrolling area (not the window), so the page itself never gets a scrollbar.
    const scroller = () => {
      for (let el = boxRef.current?.parentElement; el; el = el.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el
      }
      return document.scrollingElement as HTMLElement | null
    }
    let raf = 0
    const fit = () => {
      const box = boxRef.current
      const sc = scroller()
      if (!box || !sc) return
      const scBottom = sc === document.scrollingElement ? window.innerHeight : sc.getBoundingClientRect().bottom
      const h = Math.max(420, Math.floor(scBottom - parseFloat(getComputedStyle(sc).paddingBottom || '0') - box.getBoundingClientRect().top - 8))
      setBoxHeight(h)
      // Second pass: trim whatever still overflows (margins below the tab, etc.).
      raf = requestAnimationFrame(() => {
        const over = sc.scrollHeight - sc.clientHeight
        if (over > 0 && h - over >= 420) setBoxHeight(h - over)
      })
    }
    const first = requestAnimationFrame(fit)
    window.addEventListener('resize', fit)
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(raf); window.removeEventListener('resize', fit) }
  }, [])

  const scrollToEnd = () => requestAnimationFrame(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  })

  useEffect(() => {
    let cancelled = false
    Promise.all([crmApi.listDiscussion(source, recordId, side), crmApi.discussionPeople()])
      .then(([c, p]) => { if (!cancelled) { setItems(c); setPeople(p); scrollToEnd() } })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not load the discussion — reload the page.').join(' ')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [source, recordId, side])

  // You can't tag yourself, and someone already tagged isn't offered again.
  const taggable = useMemo(() => people.filter((p) => p.id !== user?.id && !tagged.some((t) => t.id === p.id)), [people, user, tagged])
  const matches = useMemo(() => {
    if (!picker) return []
    const q = picker.query.trim().toLowerCase()
    // Nobody is listed until a name is typed — the full list is everyone with CRM / R&D access.
    return q ? taggable.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)).slice(0, 8) : []
  }, [picker, taggable])

  // The tag popup closes on a click anywhere outside it, its button or the message box.
  const pickerRef = useRef<HTMLDivElement>(null)
  const tagBtnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!picker) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (![pickerRef.current, tagBtnRef.current, textRef.current].some((el) => el?.contains(t))) setPicker(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [picker])

  // Files folder: every file shared in this discussion, newest first, with who sent it and when.
  const fileHistory = useMemo(() => items
    .flatMap((c) => c.attachments.map((a) => ({ ...a, author: c.author_id === user?.id ? 'You' : c.author_name, side: c.side, sentAt: c.created_at })))
    .reverse(), [items, user])

  const onTextChange = (v: string) => {
    setText(v)
    const caret = textRef.current?.selectionStart ?? v.length
    const m = /(?:^|\s)@([^\s@]{0,30})$/.exec(v.slice(0, caret))
    if (m) setPicker({ via: 'at', query: m[1] })
    else if (picker?.via === 'at') setPicker(null)
  }

  const pickPerson = (p: DiscussionPerson) => {
    setTagged((t) => [...t, p])
    if (picker?.via === 'at') {
      // Replace the "@abc" being typed with the full "@Name ".
      const caret = textRef.current?.selectionStart ?? text.length
      const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `)
      setText(before + text.slice(caret))
      requestAnimationFrame(() => { textRef.current?.focus(); textRef.current?.setSelectionRange(before.length, before.length) })
    } else {
      setText((t) => (t && !/\s$/.test(t) ? `${t} ` : t) + `@${p.name} `)
      requestAnimationFrame(() => textRef.current?.focus())
    }
    setPicker(null)
  }

  const untag = (id: number) => {
    const p = tagged.find((t) => t.id === id)
    setTagged((t) => t.filter((x) => x.id !== id))
    if (p) setText((t) => t.replace(`@${p.name} `, '').replace(`@${p.name}`, ''))
  }

  const openDocPicker = () => {
    setAttachMenu(false)
    setDocPicker(true)
    if (recordDocs !== null) return
    crmApi.listDocuments({ related_module: source, related_id: recordId })
      .then((docs: CrmDocument[]) => setRecordDocs(docs.filter((d) => d.folder_type === 'client' || d.folder_type === 'internal')))
      .catch((err) => { setDocPicker(false); setError(extractErrorMessages(err, `Could not load this ${source}'s documents — reload the page.`).join(' ')) })
  }
  const togglePicked = (d: CrmDocument) => setPickedDocs((l) => (l.some((x) => x.id === d.id) ? l.filter((x) => x.id !== d.id) : [...l, d]))

  const send = async () => {
    if (!text.trim() && !files.length && !pickedDocs.length) {
      setError('Write a message or attach a file before sending.')
      return
    }
    setSending(true)
    setError('')
    try {
      const c = await crmApi.postDiscussion(source, recordId, { side, body: text, mentionIds: tagged.map((p) => p.id), files, documentIds: pickedDocs.map((d) => d.id) })
      setItems((list) => [...list, c])
      setText('')
      setTagged([])
      setFiles([])
      setPickedDocs([])
      setDocPicker(false)
      setAttachMenu(false)
      setPicker(null)
      if (fileRef.current) fileRef.current.value = ''
      scrollToEnd()
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not send the message — try again.').join(' '))
    } finally {
      setSending(false)
    }
  }

  const remove = async () => {
    const id = deleteId
    setDeleteId(null)
    if (!id) return
    try {
      await crmApi.deleteDiscussion(id)
      setItems((list) => list.filter((c) => c.id !== id))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not delete the message — try again.').join(' '))
    }
  }

  const openDoc = async (doc: { id: number; file_size?: number | null }) => {
    try {
      await crmApi.openDocument(doc)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not open the file — it may have been removed from SharePoint.').join(' '))
    }
  }

  return (
    <div ref={boxRef} data-tour="req-discussion" style={{
      height: boxHeight ?? undefined, display: 'flex', flexDirection: 'column', borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
      border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 18px', borderBottom: `1px solid ${BORDER.light}` }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {([['messages', `💬 Messages (${items.length})`], ['files', `📁 Files (${fileHistory.length})`]] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setView(v)}
              style={chipBtnStyle(view === v)}>
              {label}
            </button>
          ))}
        </div>
        <span style={{ flex: '1 1 260px', fontSize: 12, color: TEXT.muted }}>
          Shared with {side === 'crm' ? 'the R&D team and the departments it brought in' : side === 'rnd' ? 'the Business Development (BD) team and the departments this requirement is shared with' : 'R&D, the Business Development (BD) team and the other shared departments'}. Tag people with <b>@</b> — they get a notification.
        </span>
      </div>

      {view === 'files' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {fileHistory.length === 0 ? (
            <p style={{ fontSize: 13, color: TEXT.muted, padding: 24, margin: 0, textAlign: 'center' }}>No files shared yet. Files attached to any message appear here.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  {['File', 'Sent by', 'Sent on', 'Size'].map((h, hi) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', position: 'sticky', top: 0, background: '#fdf1e6' }}>{h}{hi === 0 && <RowCount count={fileHistory.length} />}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fileHistory.map((f) => {
                  const t = SIDE_TAG[f.side] || SIDE_TAG.crm
                  return (
                    <tr key={f.id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                      <td style={{ padding: '10px 16px' }}>
                        <button type="button" onClick={() => openDoc(f)} title="Open file"
                          style={{ fontSize: 13, color: '#2563eb', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', wordBreak: 'break-all' }}>
                          📎 {f.file_name}
                        </button>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 13, color: TEXT.body, whiteSpace: 'nowrap' }}>
                        {f.author} <span style={{ ...pillStyle(t.color), fontSize: 10, padding: '1px 7px' }}>{t.label}</span>
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: 12.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>{formatDateTime(f.sentAt)}</td>
                      <td style={{ padding: '10px 16px', fontSize: 12.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>{fmtSize(f.file_size) || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={listRef} style={{ display: view === 'messages' ? 'flex' : 'none', flex: 1, minHeight: 0, overflowY: 'auto', padding: 18, flexDirection: 'column', gap: 14, background: 'rgba(0,0,0,0.015)' }}>
        {loading && <p style={{ fontSize: 13, color: TEXT.muted, margin: 'auto' }}>Loading…</p>}
        {!loading && items.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 'auto', textAlign: 'center' }}>No messages yet — start the discussion below.</p>}
        {items.map((c) => {
          const mine = c.author_id === user?.id
          const tag = SIDE_TAG[c.side] || SIDE_TAG.crm
          return (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 11.5, color: TEXT.muted, flexDirection: mine ? 'row-reverse' : 'row' }}>
                <b style={{ color: TEXT.heading, fontSize: 12.5 }}>{mine ? 'You' : c.author_name}</b>
                <span style={{ ...pillStyle(tag.color), fontSize: 10, padding: '1px 7px' }}>{tag.label}</span>
                <span>{formatDateTime(c.created_at)}</span>
                {c.can_delete && (
                  <button type="button" onClick={() => setDeleteId(c.id)}
                    style={{ fontSize: 11, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Delete</button>
                )}
              </div>
              <div style={{
                maxWidth: 'min(640px, 85%)', padding: '10px 14px', borderRadius: 14,
                borderTopRightRadius: mine ? 4 : 14, borderTopLeftRadius: mine ? 14 : 4,
                background: mine ? BRAND.primarySoft : '#fff', border: `1px solid ${mine ? '#fed7aa' : BORDER.light}`,
              }}>
                {c.body && <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderBody(c.body, c.mentions.map((m) => m.name))}</p>}
                {c.attachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: c.body ? 8 : 0 }}>
                    {c.attachments.map((a) => (
                      <button key={a.id} type="button" onClick={() => openDoc(a)} title="Open file"
                        style={{ ...smallSecondaryBtnStyle, color: '#2563eb' }}>
                        📎 {a.file_name} <span style={{ color: TEXT.muted }}>{fmtSize(a.file_size)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {c.mentions.length > 0 && (
                  <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '8px 0 0' }}>
                    Tagged: {c.mentions.map((m) => <span key={m.id} style={{ color: '#c2410c', fontWeight: 600, marginRight: 6 }}>@{m.name}</span>)}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {!canPost && (
        <div style={{ flex: 'none', padding: 14, borderTop: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.85)', fontSize: 12.5, color: TEXT.muted }}>
          {error && <div style={{ marginBottom: 6, color: '#b91c1c' }}>{error}</div>}
          You can read this discussion. Posting needs {side === 'rnd' ? 'R&D › Requirements › Discussion › Create' : 'CRM › Inquiries & Tenders › Discussion with R&D › Create'} — ask an admin to add it to your role.
        </div>
      )}
      {/* Composer — always at the bottom */}
      {canPost && <div style={{ position: 'relative', flex: 'none', padding: 14, borderTop: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.85)' }}>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 10, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        )}

        {tagged.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary }}>Tagging:</span>
            {tagged.map((p) => (
              <span key={p.id} style={chip} title={p.email}>
                @{p.name} <span style={{ fontWeight: 400, color: TEXT.muted }}>{(SIDE_TAG[p.side] || SIDE_TAG.crm).label}</span>
                <span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => untag(p.id)} title="Remove tag">×</span>
              </span>
            ))}
          </div>
        )}

        <textarea ref={textRef} value={text} rows={3} placeholder="Write a message… type @ to tag someone"
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (picker && matches.length && e.key === 'Enter') { e.preventDefault(); pickPerson(matches[0]) }
            else if (e.key === 'Escape') setPicker(null)
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() }
          }}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 70, fontFamily: 'inherit' }} />

        {/* People picker — a small popup just above the composer, over the messages. */}
        {picker && (
          <div ref={pickerRef} style={{ position: 'absolute', bottom: 'calc(100% - 8px)', left: 14, zIndex: 30, width: 'min(380px, calc(100% - 28px))', borderRadius: 12,
            border: `1px solid ${BORDER.normal}`, background: '#fff', boxShadow: '0 10px 28px rgba(0,0,0,.14)', overflow: 'hidden' }}>
            {picker.via === 'button' && (
              <input autoFocus value={picker.query} placeholder="Search by name or email…"
                onChange={(e) => setPicker({ via: 'button', query: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matches.length) { e.preventDefault(); pickPerson(matches[0]) }
                  if (e.key === 'Escape') setPicker(null)
                }}
                style={{ ...inputStyle, border: 'none', borderBottom: `1px solid ${BORDER.light}`, borderRadius: 0 }} />
            )}
            {matches.length === 0 && (
              <p style={{ fontSize: 12.5, color: TEXT.muted, padding: '8px 12px', margin: 0 }}>
                {people.length === 0 ? 'Nobody is set in the R&D or Business Development department yet (Organization › Users).' : !picker.query.trim()
                  ? (taggable.length ? 'Type a name or email to find someone.' : 'Everyone available is already tagged.')
                  : user && user.name?.toLowerCase().includes(picker.query.trim().toLowerCase())
                    && !taggable.some((p) => p.name.toLowerCase().includes(picker.query.trim().toLowerCase()))
                    ? 'That’s you — you can’t tag yourself.'
                    : `No one matching "${picker.query}" in the R&D or Business Development department. If they should be, set their department in Organization › Users.`}
              </p>
            )}
            {matches.length > 0 && (
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {matches.map((p) => {
                  const t = SIDE_TAG[p.side] || SIDE_TAG.crm
                  return (
                    <div key={p.id} onMouseDown={(e) => { e.preventDefault(); pickPerson(p) }}
                      style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid ${BORDER.light}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                        <span style={{ display: 'block', color: TEXT.muted, fontSize: 11.5 }}>{p.email}{p.department ? ` · ${p.department}` : ''}</span>
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: t.color }}>{t.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {docPicker && (
          <DiscussionDocumentPicker source={source} docs={recordDocs} picked={pickedDocs} maxFiles={Math.max(0, 10 - files.length)}
            onAdd={(docs) => { setPickedDocs(docs); setDocPicker(false) }} onClose={() => setDocPicker(false)} />
        )}

        {pickedDocs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {pickedDocs.map((d) => (
              <span key={d.id} style={{ ...pillStyle('#2563eb'), fontSize: 12, fontWeight: 400, padding: '4px 10px', color: TEXT.body, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                📂 {d.file_name} <span style={{ cursor: 'pointer', fontWeight: 700, marginLeft: 4 }} onClick={() => togglePicked(d)} title="Remove">×</span>
              </span>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {files.map((f, i) => (
              <span key={i} style={{ ...pillStyle('#57534e'), fontSize: 12, fontWeight: 400, padding: '4px 10px', color: TEXT.body, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                📎 {f.name} <span style={{ cursor: 'pointer', fontWeight: 700, marginLeft: 4 }} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}>×</span>
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button ref={tagBtnRef} type="button" style={secondaryBtnStyle} disabled={sending}
            onClick={() => setPicker(picker?.via === 'button' ? null : { via: 'button', query: '' })}>@ Tag people</button>
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
            onChange={(e) => setFiles((l) => [...l, ...Array.from(e.target.files || [])].slice(0, Math.max(0, 10 - pickedDocs.length)))} />
          <div ref={attachRef} style={{ position: 'relative' }}>
            <button type="button" style={secondaryBtnStyle} disabled={sending} data-tour="req-discussion-attach"
              onClick={() => (canPickDocs ? setAttachMenu((v) => !v) : fileRef.current?.click())}>📎 Attach files</button>
            {attachMenu && (
              <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 20, width: 300, borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: '#fff', boxShadow: '0 6px 18px rgba(0,0,0,.12)', overflow: 'hidden' }}>
                {/* ui-audit-ignore-next-line custom-button — full-width two-line menu row in the attach dropdown, not a pill */}
                <button type="button" onClick={() => { setAttachMenu(false); fileRef.current?.click() }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: `1px solid ${BORDER.light}`, background: '#fff', cursor: 'pointer' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>💻 Upload new file</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>From your computer</span>
                </button>
                {/* ui-audit-ignore-next-line custom-button — full-width two-line menu row in the attach dropdown, not a pill */}
                <button type="button" onClick={openDocPicker}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: '#fff', cursor: 'pointer' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>📂 Already uploaded in the application</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>Client or Internal documents of this {source}</span>
                </button>
              </div>
            )}
          </div>
          <span style={{ fontSize: 11.5, color: TEXT.muted }}>Up to 10 files · Ctrl+Enter to send</span>
          <button type="button" onClick={send} disabled={sending}
            style={{ ...primaryBtnStyle, marginLeft: 'auto', opacity: sending ? 0.7 : 1 }}>{sending ? 'Sending…' : 'Send'}</button>
        </div>
      </div>}

      <ConfirmDialog open={deleteId !== null} title="Delete this message?" message="The message and its attached files are removed from the discussion for everyone."
        onConfirm={remove} onCancel={() => setDeleteId(null)} />
    </div>
  )
}
