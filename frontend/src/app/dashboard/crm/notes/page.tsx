'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { CrmNote } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { InfoRow, primaryBtnStyle, secondaryBtnStyle, inputStyle } from '@/components/crm/ui'

const NOTE_FILTERS = [
  { key: 'all', label: 'All Notes' },
  { key: 'org', label: 'Org Notes' },
  { key: 'inquiry', label: 'Inquiry Notes' },
  { key: 'tender', label: 'Tender Notes' },
] as const

export default function NotesPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()
  const [notes, setNotes] = useState<CrmNote[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [noteFilter, setNoteFilter] = useState<typeof NOTE_FILTERS[number]['key']>('all')
  const [viewing, setViewing] = useState<CrmNote | null>(null)
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    setNotes(await crmApi.listNotes({ search: search || undefined }))
    setLoading(false)
  }

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (id: number) => {
    await crmApi.deleteNote(id)
    load()
  }

  const visible = notes.filter((n) => {
    if (noteFilter === 'org') return !n.related_module || n.related_module === 'organization'
    if (noteFilter === 'inquiry') return n.related_module === 'inquiry'
    if (noteFilter === 'tender') return n.related_module === 'tender'
    return true
  })

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: 0 }}>Notes</h1>
        <button onClick={() => router.push('/dashboard/crm/notes/new')} style={primaryBtnStyle}>+ Add Note</button>
      </div>

      <div style={{ borderRadius: 16, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ padding: 16, borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes…" style={inputStyle} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {NOTE_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setNoteFilter(f.key)}
                style={{
                  padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  background: noteFilter === f.key ? '#fa9b9b' : '#fff', color: noteFilter === f.key ? '#fff' : '#57534e',
                  borderColor: noteFilter === f.key ? '#fa9b9b' : 'rgba(0,0,0,0.1)',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p style={{ fontSize: 13, color: '#78716c', padding: 24 }}>Loading…</p>
        ) : visible.length === 0 ? (
          <p style={{ fontSize: 13, color: '#a8a29e', padding: 24, textAlign: 'center' }}>No notes found</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#fffaf5' }}>
                  {['Note', 'Universal ID', 'Module', 'By', 'Date', 'Actions'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((n) => (
                  <tr key={n.id} onClick={() => setViewing(n)} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer' }}>
                    <td style={{ padding: '10px 16px', color: '#1f1108', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.note}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 12, color: '#0284c7' }}>{n.universal_id || '—'}</td>
                    <td style={{ padding: '10px 16px', color: '#57534e', textTransform: 'capitalize' }}>{n.related_module || '—'}</td>
                    <td style={{ padding: '10px 16px', color: '#57534e' }}>{n.created_by_name || '—'}</td>
                    <td style={{ padding: '10px 16px', color: '#57534e' }}>{n.created_at ? new Date(n.created_at).toLocaleDateString() : ''}</td>
                    <td style={{ padding: '10px 16px' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setViewing(n)} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 11.5 }}>View</button>
                        <button onClick={() => router.push(`/dashboard/crm/notes/${n.id}/edit`)} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 11.5 }}>Edit</button>
                        <button onClick={() => setPendingDelete(n.id)} style={{ padding: '4px 10px', fontSize: 11.5, borderRadius: 8, border: '1px solid rgba(220,38,38,0.2)', background: 'rgba(220,38,38,0.08)', color: '#dc2626', fontWeight: 700, cursor: 'pointer' }}>Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && (
        <div onClick={() => setViewing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '80vh', overflowY: 'auto' }}>
            <p style={{ fontSize: 16, fontWeight: 800, color: '#1f1108', margin: 0 }}>Note</p>
            <InfoRow label="Note" value={viewing.note} />
            <InfoRow label="Related To" value={viewing.related_module && viewing.universal_id ? `${viewing.related_module} · ${viewing.universal_id}` : '—'} />
            <InfoRow label="By" value={viewing.created_by_name || '—'} />
            <InfoRow label="Date" value={viewing.created_at ? new Date(viewing.created_at).toLocaleString() : '—'} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setViewing(null)} style={secondaryBtnStyle}>Close</button>
              <button onClick={() => router.push(`/dashboard/crm/notes/${viewing.id}/edit`)} style={primaryBtnStyle}>Edit</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this note?"
        message="This note will be permanently deleted."
        onConfirm={() => { const id = pendingDelete; setPendingDelete(null); if (id) remove(id) }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
