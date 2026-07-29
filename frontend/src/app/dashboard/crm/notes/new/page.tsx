'use client'

import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import NoteForm from '@/components/crm/NoteForm'

export default function NewNotePage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 700, color: '#a8a29e', margin: '0 0 6px' }}>
          <span onClick={() => router.push('/dashboard/crm/notes')} style={{ cursor: 'pointer' }}>Notes</span> › New
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1f1108', margin: 0 }}>Add Note</h1>
      </div>

      <NoteForm
        submitLabel="Save Note"
        onCancel={() => router.push('/dashboard/crm/notes')}
        onSubmit={async (payload) => {
          await crmApi.createNote(payload)
          router.push('/dashboard/crm/notes')
        }}
      />
    </div>
  )
}
