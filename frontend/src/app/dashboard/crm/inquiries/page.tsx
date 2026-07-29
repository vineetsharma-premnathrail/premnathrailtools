'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { Inquiry, Organization } from '@/types'
import CrmNav from '@/components/crm/CrmNav'
import { INQUIRY_STATUSES } from '@/components/crm/constants'
import { secondaryBtnStyle, pageBtnStyle } from '@/components/crm/ui'

const PAGE_SIZE = 20

export default function InquiriesPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const router = useRouter()
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [data, orgData] = await Promise.all([
        crmApi.listInquiries({ search: search || undefined, status: statusFilter !== 'all' ? statusFilter : undefined }),
        crmApi.listOrganizations(),
      ])
      setInquiries(data)
      setOrganizations(orgData)
      setPage(1)
    } catch {
      setError('Failed to load inquiries.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, statusFilter])

  useEffect(() => {
    if (!isAuthorized) return
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const orgById = useMemo(() => new Map(organizations.map((o) => [o.id, o])), [organizations])
  const clearFilters = () => { setSearch(''); setStatusFilter('all') }

  const totalPages = Math.max(1, Math.ceil(inquiries.length / PAGE_SIZE))
  const paged = inquiries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <CrmNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1f1108', margin: '0 0 4px' }}>Inquiries</h1>
          <p style={{ fontSize: 13, color: '#78716c', margin: 0 }}>{inquiries.length} Inquiries Found</p>
        </div>
        <Link
          href="/dashboard/crm/inquiries/new"
          style={{ fontSize: 13.5, fontWeight: 700, padding: '10px 20px', borderRadius: 10, background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)', color: '#fff', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          + New Inquiry
        </Link>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Inquiry #, product, BD owner..."
          style={{ flex: '1 1 260px', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13.5, outline: 'none' }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontSize: 13 }}>
          <option value="all">All Statuses</option>
          {INQUIRY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={clearFilters} style={secondaryBtnStyle}>Clear</button>
      </div>

      <div style={{ borderRadius: 18, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)', overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr style={{ background: 'rgba(244,113,59,0.06)' }}>
              {['Inquiry #', 'Organization', 'Product', 'Stage', 'Status', 'Priority', 'Expected Value', 'Next Follow-up'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>Loading…</td></tr>}
            {!loading && paged.length === 0 && <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>No inquiries found.</td></tr>}
            {paged.map((i) => (
              <tr key={i.id} onClick={() => router.push(`/dashboard/crm/inquiries/${i.id}`)} style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <td style={{ padding: '12px 16px' }}><span style={{ fontSize: 13, fontWeight: 700, color: '#fa9b9b' }}>{i.universal_id}</span></td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{orgById.get(i.org_id)?.name || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: '#57534e', whiteSpace: 'nowrap' }}>{i.product || '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{i.current_stage}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#57534e', whiteSpace: 'nowrap' }}>{i.status}</td>
                <td style={{ padding: '12px 16px', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', color: '#f97316' }}>{i.priority}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{i.expected_value != null ? `₹${i.expected_value.toLocaleString()}` : '—'}</td>
                <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#78716c', whiteSpace: 'nowrap' }}>{i.next_followup_date || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && inquiries.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: '#78716c' }}>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, inquiries.length)} of {inquiries.length}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={pageBtnStyle(page === 1)}>‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce<number[]>((acc, p) => {
                if (acc.length && p - acc[acc.length - 1] > 1) acc.push(-1)
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                p === -1 ? (
                  <span key={`gap-${i}`} style={{ fontSize: 12.5, color: '#a8a29e', padding: '0 4px' }}>…</span>
                ) : (
                  <button key={p} onClick={() => setPage(p)} style={{ ...pageBtnStyle(false), background: p === page ? '#fa9b9b' : '#fff', color: p === page ? '#fff' : '#57534e' }}>
                    {p}
                  </button>
                )
              )}
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={pageBtnStyle(page === totalPages)}>›</button>
          </div>
        </div>
      )}
    </div>
  )
}
