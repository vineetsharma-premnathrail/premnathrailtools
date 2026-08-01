'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { CrmActivity, Organization, OrgContact } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { InfoRow, primaryBtnStyle, secondaryBtnStyle, inputStyle } from '@/components/crm/ui'

const QUICK_FILTERS = ['all', 'open', 'done', 'today', 'overdue'] as const

export default function ActivitiesPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [quickFilter, setQuickFilter] = useState<typeof QUICK_FILTERS[number]>('all')
  const [viewing, setViewing] = useState<CrmActivity | null>(null)
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    const [data, orgData] = await Promise.all([
      crmApi.listActivities({ search: search || undefined, status: statusFilter || undefined }),
      crmApi.listOrganizations(),
    ])
    setActivities(data)
    setOrganizations(orgData)
    setLoading(false)
  }

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const orgById = new Map(organizations.map((o) => [o.id, o]))
  const contactById = new Map<number, OrgContact>(organizations.flatMap((o) => (o.contacts || []).map((c) => [c.id, c] as const)))

  const remove = async (id: number) => {
    await crmApi.deleteActivity(id)
    load()
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const visible = activities.filter((a) => {
    if (quickFilter === 'open') return a.status === 'Open'
    if (quickFilter === 'done') return a.status === 'Done'
    if (quickFilter === 'today') return a.next_followup?.slice(0, 10) === todayStr
    if (quickFilter === 'overdue') return a.status === 'Open' && !!a.next_followup && a.next_followup.slice(0, 10) < todayStr
    return true
  })

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: 0 }}>Activities</h1>
        <button onClick={() => router.push('/dashboard/crm/activities/new')} style={primaryBtnStyle}>+ Log Activity</button>
      </div>

      <div style={{ borderRadius: 16, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 16, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by ID, owner, remarks…" style={{ ...inputStyle, flex: '1 1 260px' }} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: 160 }}>
            <option value="">All Statuses</option>
            <option value="Open">Open</option>
            <option value="Done">Done</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', overflowX: 'auto' }}>
          {QUICK_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setQuickFilter(f)}
              style={{
                padding: '5px 12px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize',
                background: quickFilter === f ? '#fa9b9b' : 'rgba(0,0,0,0.05)', color: quickFilter === f ? '#fff' : '#57534e',
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ fontSize: 13, color: '#78716c', padding: 24 }}>Loading…</p>
        ) : visible.length === 0 ? (
          <p style={{ fontSize: 13, color: '#a8a29e', padding: 24, textAlign: 'center' }}>No activities found</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#fffaf5' }}>
                  {['Type', 'Organization', 'Contact Person', 'Universal ID', 'Module', 'Next Follow-up', 'Assigned To', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id} onClick={() => setViewing(a)} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 8, background: 'rgba(0,0,0,0.05)', color: '#57534e' }}>{a.activity_type || '—'}</span>
                    </td>
                    <td style={{ padding: '10px 16px', color: '#1f1108', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.org_id ? orgById.get(a.org_id)?.name || '—' : '—'}</td>
                    <td style={{ padding: '10px 16px', color: '#57534e', whiteSpace: 'nowrap' }}>{a.org_contact_id ? contactById.get(a.org_contact_id)?.name || '—' : '—'}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 12, color: '#fa9b9b' }}>{a.universal_id || '—'}</td>
                    <td style={{ padding: '10px 16px', color: '#57534e', textTransform: 'capitalize' }}>{a.related_module || '—'}</td>
                    <td style={{ padding: '10px 16px', color: '#57534e' }}>{a.next_followup || '—'}</td>
                    <td style={{ padding: '10px 16px', color: '#57534e' }}>{a.assigned_to || '—'}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 8, background: a.status === 'Done' ? 'rgba(34,197,94,0.12)' : a.status === 'Cancelled' ? 'rgba(0,0,0,0.06)' : 'rgba(234,179,8,0.12)', color: a.status === 'Done' ? '#16a34a' : a.status === 'Cancelled' ? '#78716c' : '#a16207' }}>{a.status}</span>
                    </td>
                    <td style={{ padding: '10px 16px' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setViewing(a)} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 11.5 }}>View</button>
                        <button onClick={() => router.push(`/dashboard/crm/activities/${a.id}/edit`)} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 11.5 }}>Edit</button>
                        <button onClick={() => setPendingDelete(a.id)} style={{ padding: '4px 10px', fontSize: 11.5, borderRadius: 8, border: '1px solid rgba(220,38,38,0.2)', background: 'rgba(220,38,38,0.08)', color: '#dc2626', fontWeight: 700, cursor: 'pointer' }}>Del</button>
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
            <p style={{ fontSize: 16, fontWeight: 800, color: '#1f1108', margin: 0 }}>{viewing.activity_type || 'Activity'}</p>
            <InfoRow label="Organization" value={viewing.org_id ? orgById.get(viewing.org_id)?.name || '—' : '—'} />
            <InfoRow label="Contact Person" value={viewing.org_contact_id ? contactById.get(viewing.org_contact_id)?.name || '—' : '—'} />
            <InfoRow label="Related To" value={viewing.related_module && viewing.universal_id ? `${viewing.related_module} · ${viewing.universal_id}` : '—'} />
            <InfoRow label="Status" value={viewing.status} />
            <InfoRow label="Next Follow-up" value={viewing.next_followup || '—'} />
            <InfoRow label="Assigned To" value={viewing.assigned_to || '—'} />
            <InfoRow label="Remarks" value={viewing.remarks || '—'} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setViewing(null)} style={secondaryBtnStyle}>Close</button>
              <button onClick={() => router.push(`/dashboard/crm/activities/${viewing.id}/edit`)} style={primaryBtnStyle}>Edit</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this activity?"
        message="This activity will be permanently deleted."
        onConfirm={() => { const id = pendingDelete; setPendingDelete(null); if (id) remove(id) }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
