'use client'

// Project Management conversations: the milestone team chat and task
// comments. Type "@" (or use "@ Tag") to tag anyone in the company — e.g.
// R&D tagging someone in Purchase. Tagged people get a bell notification and
// can open the chat to reply. Drawings and other files can be sent with a
// message.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pmWorkApi, usersApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { DirectoryUser, PmMessage, PmPerson } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { ErrorBanner, actionBtn, inputStyle, sectionStyle } from './pmUi'

const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '3px 10px',
  borderRadius: 9999, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa',
}

/** Highlights every "@Name" that belongs to a tagged person. */
export function MentionText({ body, mentions }: { body: string; mentions: PmPerson[] }) {
  const names = mentions.map((m) => m.name)
  if (!names.length) return <>{body}</>
  const escaped = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return (
    <>
      {body.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g')).map((p, i) => (p.startsWith('@') && names.includes(p.slice(1))
        ? <span key={i} style={{ color: '#c2410c', fontWeight: 700 }}>{p}</span>
        : <span key={i}>{p}</span>))}
    </>
  )
}

/** Textarea with "@" tagging, tag chips and (optionally) file attach. */
export function MentionComposer({ onSend, allowFiles = false, placeholder = 'Write a message… type @ to tag someone', sendLabel = 'Send' }: {
  onSend: (body: string, mentionIds: number[], files: File[]) => Promise<boolean>
  allowFiles?: boolean
  placeholder?: string
  sendLabel?: string
}) {
  const { user } = useAuth()
  const [people, setPeople] = useState<DirectoryUser[]>([])
  const [text, setText] = useState('')
  const [tagged, setTagged] = useState<DirectoryUser[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [picker, setPicker] = useState<{ via: 'at' | 'button'; query: string } | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { usersApi.directory().then(setPeople).catch(() => setPeople([])) }, [])

  const matches = useMemo(() => {
    if (!picker) return []
    const q = picker.query.trim().toLowerCase()
    const pool = people.filter((p) => p.id !== user?.id && !tagged.some((t) => t.id === p.id))
    return (q ? pool.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) : pool).slice(0, 8)
  }, [picker, people, tagged, user])

  const onTextChange = (v: string) => {
    setText(v)
    const caret = textRef.current?.selectionStart ?? v.length
    const m = /(?:^|\s)@([^\s@]{0,30})$/.exec(v.slice(0, caret))
    if (m) setPicker({ via: 'at', query: m[1] })
    else if (picker?.via === 'at') setPicker(null)
  }
  const pick = (p: DirectoryUser) => {
    setTagged((t) => [...t, p])
    if (picker?.via === 'at') {
      const caret = textRef.current?.selectionStart ?? text.length
      const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `)
      setText(before + text.slice(caret))
    } else {
      setText((t) => (t && !/\s$/.test(t) ? `${t} ` : t) + `@${p.name} `)
    }
    setPicker(null)
    requestAnimationFrame(() => textRef.current?.focus())
  }
  const untag = (p: DirectoryUser) => {
    setTagged((t) => t.filter((x) => x.id !== p.id))
    setText((t) => t.replace(`@${p.name} `, '').replace(`@${p.name}`, ''))
  }
  const send = async () => {
    if (sending || (!text.trim() && !files.length)) return
    setSending(true)
    // Only keep tags whose "@Name" is still in the text.
    const ids = tagged.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id)
    const ok = await onSend(text.trim(), ids, files)
    setSending(false)
    if (ok) {
      setText('')
      setTagged([])
      setFiles([])
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      {tagged.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: TEXT.secondary }}>Tagging:</span>
          {tagged.map((p) => (
            <span key={p.id} style={chip} title={p.email}>@{p.name}<span style={{ cursor: 'pointer', fontWeight: 700 }} onClick={() => untag(p)}>×</span></span>
          ))}
        </div>
      )}
      <textarea ref={textRef} value={text} rows={2} placeholder={placeholder}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={(e) => {
          if (picker && matches.length && e.key === 'Enter') { e.preventDefault(); pick(matches[0]) }
          else if (e.key === 'Escape') setPicker(null)
          else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() }
        }}
        style={{ ...inputStyle, resize: 'vertical', minHeight: 56, fontFamily: 'inherit' }} />
      {picker && (
        <div style={{ marginTop: 6, borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: '#fff', boxShadow: '0 6px 18px rgba(0,0,0,.08)', overflow: 'hidden', maxWidth: 420 }}>
          {picker.via === 'button' && (
            <input autoFocus value={picker.query} placeholder="Search by name or email…"
              onChange={(e) => setPicker({ via: 'button', query: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && matches.length) { e.preventDefault(); pick(matches[0]) } if (e.key === 'Escape') setPicker(null) }}
              style={{ ...inputStyle, border: 'none', borderBottom: `1px solid ${BORDER.light}`, borderRadius: 0 }} />
          )}
          {matches.length === 0 && <p style={{ fontSize: 12.5, color: TEXT.muted, padding: '8px 12px', margin: 0 }}>No one matching &quot;{picker.query}&quot;.</p>}
          {matches.map((p) => (
            <div key={p.id} onMouseDown={(e) => { e.preventDefault(); pick(p) }} style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderBottom: `1px solid ${BORDER.light}` }}>
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              <span style={{ display: 'block', color: TEXT.muted, fontSize: 11.5 }}>{p.email}{p.department ? ` · ${p.department}` : ''}</span>
            </div>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {files.map((f, i) => (
            <span key={i} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 9999, background: 'rgba(0,0,0,0.05)', color: TEXT.body }}>
              📎 {f.name} <span style={{ cursor: 'pointer', fontWeight: 700, marginLeft: 4 }} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}>×</span>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" style={actionBtn('secondary', sending)} disabled={sending}
          onClick={() => setPicker(picker?.via === 'button' ? null : { via: 'button', query: '' })}>@ Tag</button>
        {allowFiles && (
          <>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => setFiles((l) => [...l, ...Array.from(e.target.files || [])].slice(0, 10))} />
            <button type="button" style={actionBtn('secondary', sending)} disabled={sending} onClick={() => fileRef.current?.click()}>Attach drawing / file</button>
          </>
        )}
        <span style={{ fontSize: 11.5, color: TEXT.muted }}>Ctrl+Enter to send</span>
        <button type="button" onClick={send} disabled={sending || (!text.trim() && !files.length)} style={{ ...actionBtn('primary', sending || (!text.trim() && !files.length)), marginLeft: 'auto' }}>
          {sending ? 'Sending…' : sendLabel}
        </button>
      </div>
    </div>
  )
}

/** Milestone team chat — lead, assistants, department heads, management and
 * anyone tagged. */
export default function PmChat({ milestoneId, readOnly = false }: { milestoneId: number; readOnly?: boolean }) {
  const { user } = useAuth()
  const [items, setItems] = useState<PmMessage[]>([])
  const [error, setError] = useState<string | string[]>('')
  const listRef = useRef<HTMLDivElement>(null)
  const scrollToEnd = () => requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight })

  const load = useCallback(() => {
    pmWorkApi.messages(milestoneId).then((d: PmMessage[]) => { setItems(d); scrollToEnd() })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the team chat — reload the page.')))
  }, [milestoneId])
  useEffect(() => { load() }, [load])

  const send = async (body: string, mentionIds: number[], files: File[]) => {
    setError('')
    try {
      const m: PmMessage = await pmWorkApi.postMessage(milestoneId, { body, mentionIds, files })
      setItems((l) => [...l, m])
      scrollToEnd()
      return true
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not send the message — try again.'))
      return false
    }
  }

  return (
    <div data-tour="pm-mw-chat" style={sectionStyle}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Team chat ({items.length})</h2>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>Talk with the team, share drawings, and tag anyone with <b>@</b> (e.g. Purchase, Electrical) — they get a notification and can reply here.</p>
      <div ref={listRef} style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.02)', marginBottom: 12 }}>
        {items.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: 'auto', textAlign: 'center' }}>No messages yet.</p>}
        {items.map((c) => {
          const mine = c.user_id === user?.id
          return (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
              <div style={{ fontSize: 11.5, color: TEXT.muted, marginBottom: 3 }}>
                <b style={{ color: TEXT.heading, fontSize: 12.5 }}>{mine ? 'You' : c.user_name}</b> · {c.created_at ? formatDateTime(c.created_at) : ''}
              </div>
              <div style={{ maxWidth: 'min(640px, 85%)', padding: '9px 13px', borderRadius: 14, borderTopRightRadius: mine ? 4 : 14, borderTopLeftRadius: mine ? 14 : 4, background: mine ? 'rgba(99,102,241,0.08)' : '#fff', border: `1px solid ${BORDER.light}` }}>
                {c.body && <p style={{ fontSize: 13.5, color: TEXT.body, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}><MentionText body={c.body} mentions={c.mentions} /></p>}
                {c.files.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: c.body ? 8 : 0 }}>
                    {c.files.map((f) => (
                      <button key={f.id} type="button" onClick={() => openAttachmentBlob(() => pmWorkApi.fileBlob(f.id), f.file_name).catch(() => setError(`Could not open ${f.file_name} — it may have been removed from SharePoint.`))}
                        style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: `1px solid ${BORDER.normal}`, background: '#fff', color: '#2563eb', cursor: 'pointer' }}>
                        📎 {f.file_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <ErrorBanner error={error} />
      {readOnly ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>The project is closed — the chat is read-only.</p> : <MentionComposer onSend={send} allowFiles />}
    </div>
  )
}
