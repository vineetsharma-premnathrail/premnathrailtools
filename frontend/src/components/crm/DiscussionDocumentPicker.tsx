'use client'

// "Attach files → Already uploaded in the application" in the requirement
// Discussion: a centered dialog listing the record's Client / Internal
// documents, searchable, with a folder filter. Rendered into document.body —
// the discussion box uses backdrop-filter, which would trap a fixed overlay.

import { useEffect, useMemo, useState } from 'react'
import { CrmDocument } from '@/types'
import { formatDateTime } from '@/lib/format'
import { TEXT, BORDER } from '@/lib/theme'
import { FormSheet, SheetIcon, SHEET, sheetBtn, sheetInput } from '@/components/shared/FormSheet'
import { chipBtnStyle, pillStyle } from '@/components/shared/ui'

const FOLDERS = [['all', 'All'], ['client', 'From client'], ['internal', 'Internal']] as const
type Folder = typeof FOLDERS[number][0]

function fmtSize(n?: number | null) {
  if (!n) return ''
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

// Mount only while open — selection starts from what's already picked.
export default function DiscussionDocumentPicker({ source, docs, picked, maxFiles, onAdd, onClose }: {
  source: 'inquiry' | 'tender'
  docs: CrmDocument[] | null // null = still loading
  picked: CrmDocument[]
  maxFiles: number // room left in this message (10 minus files already attached)
  onAdd: (docs: CrmDocument[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState<Folder>('all')
  const [selected, setSelected] = useState<number[]>(() => picked.map((d) => d.id))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (docs || []).filter((d) => (folder === 'all' || d.folder_type === folder) && (!q || [d.file_name, d.doc_category, d.uploaded_by_name, d.description]
      .some((v) => v?.toLowerCase().includes(q))))
  }, [docs, folder, query])

  const full = selected.length >= maxFiles
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : full ? s : [...s, id]))
  const count = (f: Folder) => (docs || []).filter((d) => f === 'all' || d.folder_type === f).length

  return (
    <FormSheet width={660} icon="clip" title="Documents already uploaded" onClose={onClose} busy={false}
      subtitle={`Pick Client or Internal documents of this ${source} to send with your message. They stay in the Documents tab as they are.`}
      footer={<>
        <span style={{ fontSize: 12.5, color: SHEET.MUTED, marginRight: 'auto', alignSelf: 'center' }}>
          {selected.length} selected{full ? ` — the most one message can carry (${maxFiles})` : ''}
        </span>
        <button type="button" onClick={onClose} style={sheetBtn('secondary', SHEET.INK)}>Cancel</button>
        <button type="button" onClick={() => onAdd((docs || []).filter((d) => selected.includes(d.id)))} style={sheetBtn('primary', SHEET.BLUE)}>
          <SheetIcon name="plus" size={16} />{selected.length ? `Add ${selected.length} document${selected.length > 1 ? 's' : ''}` : 'Add'}
        </button>
      </>}>
      <div style={{ padding: '16px 24px 12px' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 11, top: 11, color: SHEET.MUTED, display: 'inline-flex' }}><SheetIcon name="search" size={16} /></span>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by file name, category or uploaded by…" style={{ ...sheetInput, paddingLeft: 34 }} />
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 10, width: 'fit-content' }}>
          {FOLDERS.map(([f, label]) => (
            <button key={f} type="button" onClick={() => setFolder(f)}
              style={chipBtnStyle(folder === f)}>
              {label} ({count(f)})
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxHeight: 'min(420px, calc(100vh - 340px))', minHeight: 160, overflowY: 'auto', borderTop: `1px solid ${SHEET.LINE}` }}>
          {docs === null && <p style={{ fontSize: 13, color: TEXT.muted, padding: 24, margin: 0, textAlign: 'center' }}>Loading documents…</p>}
          {docs?.length === 0 && (
            <p style={{ fontSize: 13, color: TEXT.muted, padding: 24, margin: 0, textAlign: 'center' }}>
              No Client or Internal documents on this {source} yet. Upload them in the Documents tab, or choose &ldquo;Upload new file&rdquo;.
            </p>
          )}
          {docs && docs.length > 0 && shown.length === 0 && (
            <p style={{ fontSize: 13, color: TEXT.muted, padding: 24, margin: 0, textAlign: 'center' }}>No document matches &ldquo;{query}&rdquo;.</p>
          )}
          {shown.map((d) => {
            const on = selected.includes(d.id)
            const disabled = !on && full
            return (
              <label key={d.id} title={disabled ? 'A message can carry at most 10 files, counting new uploads' : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 24px', borderBottom: `1px solid ${BORDER.light}`, cursor: disabled ? 'not-allowed' : 'pointer',
                  background: on ? '#eff6ff' : '#fff', opacity: disabled ? 0.5 : 1 }}>
                <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(d.id)} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: TEXT.heading, wordBreak: 'break-all' }}>{d.file_name}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>
                    {[d.doc_category, d.uploaded_by_name && `by ${d.uploaded_by_name}`, d.created_at && formatDateTime(d.created_at), fmtSize(d.file_size)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span style={{ ...pillStyle(d.folder_type === 'client' ? '#2563eb' : '#7c3aed'), fontSize: 10.5, padding: '2px 8px' }}>
                  {d.folder_type === 'client' ? 'Client' : 'Internal'}
                </span>
              </label>
            )
          })}
        </div>
    </FormSheet>
  )
}
