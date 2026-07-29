'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import { primaryBtnStyle } from '@/components/crm/ui'

interface DeletedItem {
  id: number
  [key: string]: unknown
}

export default function CrmRecycleBinPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const [orgs, setOrgs] = useState<DeletedItem[]>([])
  const [inquiries, setInquiries] = useState<DeletedItem[]>([])
  const [tenders, setTenders] = useState<DeletedItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const [o, i, t] = await Promise.all([
      crmApi.getDeletedOrganizations(),
      crmApi.getDeletedInquiries(),
      crmApi.getDeletedTenders(),
    ])
    setOrgs(o)
    setInquiries(i)
    setTenders(t)
    setLoading(false)
  }

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized]) // eslint-disable-line react-hooks/exhaustive-deps

  const restoreOrg = async (id: number) => { await crmApi.restoreOrganization(id); load() }
  const restoreInquiry = async (id: number) => { await crmApi.restoreInquiry(id); load() }
  const restoreTender = async (id: number) => { await crmApi.restoreTender(id); load() }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: '0 0 4px' }}>Recycle Bin</h1>
      <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 24px' }}>Deleted records can be restored within 10 days.</p>

      {loading ? (
        <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <RecycleSection title="Deleted Organizations" items={orgs} labelKey="name" onRestore={restoreOrg} />
          <RecycleSection title="Deleted Inquiries" items={inquiries} labelKey="universal_id" onRestore={restoreInquiry} />
          <RecycleSection title="Deleted Tenders" items={tenders} labelKey="universal_id" onRestore={restoreTender} />
        </div>
      )}
    </div>
  )
}

function RecycleSection({ title, items, labelKey, onRestore }: { title: string; items: DeletedItem[]; labelKey: string; onRestore: (id: number) => void }) {
  return (
    <div>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1f1108', margin: '0 0 12px' }}>{title} ({items.length})</h2>
      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>Nothing here.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item) => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1f1108', margin: '0 0 2px' }}>{String(item[labelKey] ?? `#${item.id}`)}</p>
                <p style={{ fontSize: 11.5, color: '#a8a29e', margin: 0 }}>
                  Deleted {item.deleted_at ? new Date(String(item.deleted_at)).toLocaleString() : '—'}
                </p>
              </div>
              <button onClick={() => onRestore(item.id)} style={primaryBtnStyle}>Restore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
