'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { erpApi } from '@/lib/api'
import ErpNav from '@/components/erp/ErpNav'
import { Section, smallPrimaryBtnStyle } from '@/components/shared/ui'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'

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
  created_by_id?: number | null
}

export default function RecycleBinPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('erp')
  // Restoring = Recycle Bin › Edit; an SR can only be restored by its creator (or an admin).
  const { can } = useCan()
  const canRestoreProjects = can('erp', 'recycle_bin', 'edit')
  const canRestoreSr = (sr: DeletedSR) =>
    canRestoreProjects && (user?.role === 'admin' || sr.created_by_id == null || sr.created_by_id === user?.id)
  const [projects, setProjects] = useState<DeletedProject[]>([])
  const [srs, setSrs] = useState<DeletedSR[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [p, s] = await Promise.all([erpApi.getDeletedProjects(), erpApi.getRecycleBin()])
      setProjects(p)
      setSrs(s)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not load the Recycle Bin — check your connection and reload the page.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const restoreProject = async (id: number) => {
    try {
      await erpApi.restoreProject(id)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Could not restore the machine — check you have Recycle Bin › Edit permission and your connection, then try again.'))
    }
  }

  const restoreSr = async (id: number) => {
    try {
      await erpApi.restoreServiceRequest(id)
      load()
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Could not restore the service request — if its machine is also in the Recycle Bin, restore the machine first; otherwise check your connection and try again.'))
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ErpNav />
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: '0 0 4px' }}>Recycle Bin</h1>
      <p data-tour="erp-bin-purge-note" style={{ fontSize: 13, color: '#78716c', margin: '0 0 24px' }}>Deleted items are auto-purged after 10 days</p>

      <MessageDialog open={!!error} variant="error" title="Restore Failed" message={error} onClose={() => setError('')} />

      {loading ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div data-tour="erp-bin-projects">
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
                  onRestore={canRestoreProjects ? () => restoreProject(p.id) : undefined}
                />
              ))
            )}
          </Section>
          </div>

          <div data-tour="erp-bin-srs">
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
                  onRestore={canRestoreSr(sr) ? () => restoreSr(sr.id) : undefined}
                />
              ))
            )}
          </Section>
          </div>
        </div>
      )}
    </div>
  )
}

function RecycleRow({ primary, secondary, deletedAt, onRestore }: { primary: string; secondary?: string; deletedAt: string | null; onRestore?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: '0 0 2px' }}>{primary}</p>
        <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>
          {secondary} {deletedAt ? `· Deleted ${formatDate(deletedAt)}` : ''}
        </p>
      </div>
      {onRestore && (
        <button
          data-tour="erp-bin-restore-btn"
          onClick={onRestore}
          style={smallPrimaryBtnStyle}
        >
          Restore
        </button>
      )}
    </div>
  )
}
