'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { erpApi } from '@/lib/api'
import ErpNav from '@/components/erp/ErpNav'

interface DeletedProject {
  id: number
  serial_number: string
  model_name?: string
  client_company?: string
  deleted_at: string | null
}

interface DeletedSR {
  id: number
  request_number: string
  project_id: number
  status: string
  issue_description?: string
  deleted_at: string | null
  days_remaining: number
}

export default function RecycleBinPage() {
  const { isAuthorized, isLoading } = useRequireApp('erp')
  const [projects, setProjects] = useState<DeletedProject[]>([])
  const [srs, setSrs] = useState<DeletedSR[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [p, s] = await Promise.all([erpApi.getDeletedProjects(), erpApi.getRecycleBin()])
      setProjects(p)
      setSrs(s)
    } catch {
      setError('Failed to load recycle bin.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const restoreProject = async (id: number) => {
    await erpApi.restoreProject(id)
    load()
  }

  const restoreSr = async (id: number) => {
    await erpApi.restoreServiceRequest(id)
    load()
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ErpNav />
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: '0 0 4px' }}>Recycle Bin</h1>
      <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 24px' }}>Deleted items are auto-purged after 10 days</p>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Section title="Deleted Projects">
            {projects.length === 0 ? (
              <p style={{ fontSize: 13, color: '#a8a29e' }}>Nothing here.</p>
            ) : (
              projects.map((p) => (
                <RecycleRow
                  key={p.id}
                  primary={p.serial_number}
                  secondary={[p.model_name, p.client_company].filter(Boolean).join(' · ')}
                  deletedAt={p.deleted_at}
                  onRestore={() => restoreProject(p.id)}
                />
              ))
            )}
          </Section>

          <Section title="Deleted Service Requests">
            {srs.length === 0 ? (
              <p style={{ fontSize: 13, color: '#a8a29e' }}>Nothing here.</p>
            ) : (
              srs.map((sr) => (
                <RecycleRow
                  key={sr.id}
                  primary={sr.request_number}
                  secondary={`${sr.issue_description || ''} — ${sr.days_remaining} day(s) left`}
                  deletedAt={sr.deleted_at}
                  onRestore={() => restoreSr(sr.id)}
                />
              ))
            )}
          </Section>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#fa9b9b', margin: '0 0 10px' }}>{title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

function RecycleRow({ primary, secondary, deletedAt, onRestore }: { primary: string; secondary?: string; deletedAt: string | null; onRestore: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#1f1108', margin: '0 0 2px' }}>{primary}</p>
        <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>
          {secondary} {deletedAt ? `· Deleted ${new Date(deletedAt).toLocaleDateString()}` : ''}
        </p>
      </div>
      <button
        onClick={onRestore}
        style={{ fontSize: 12.5, fontWeight: 700, padding: '7px 16px', borderRadius: 9, border: 'none', background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}
      >
        Restore
      </button>
    </div>
  )
}
