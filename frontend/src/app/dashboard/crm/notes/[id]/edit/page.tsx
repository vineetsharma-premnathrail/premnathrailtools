'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { CrmNote } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import NoteForm from '@/components/crm/NoteForm'

export default function EditNotePage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const params = useParams()
  const router = useRouter()
  const noteId = Number(params.id)

  const [note, setNote] = useState<CrmNote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    crmApi.listNotes({}).then((notes: CrmNote[]) => {
      const found = notes.find((n) => n.id === noteId)
      if (found) setNote(found)
      else setError('Note not found.')
      setLoading(false)
    })
  }, [isAuthorized, noteId])

  if (isLoading || !isAuthorized) return null
  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error || !note) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error || 'Note not found.'}</p>

  return (
    <div>
      <CrmNav />
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 700, color: '#a8a29e', margin: '0 0 6px' }}>
          <span onClick={() => router.push('/dashboard/crm/notes')} style={{ cursor: 'pointer' }}>Notes</span> › Edit
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f1108', margin: 0 }}>Edit Note</h1>
      </div>

      <NoteForm
        initial={note}
        submitLabel="Save Changes"
        onCancel={() => router.push('/dashboard/crm/notes')}
        onSubmit={async (payload) => {
          await crmApi.updateNote(note.id, payload)
          router.push('/dashboard/crm/notes')
        }}
      />
    </div>
  )
}
