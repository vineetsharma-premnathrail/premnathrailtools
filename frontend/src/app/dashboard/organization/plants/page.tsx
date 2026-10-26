'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { organizationApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { Branch } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'
import { recordPath } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { PLANT_STATUS_LABELS, PLANT_STATUS_HEX } from '@/components/organization/PlantForm'
import { extractErrorMessages } from '@/lib/validation'
import { RowCount, pillStyle } from '@/components/shared/ui'
import { formatDate } from '@/lib/format'

export default function OrganizationPlantsPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('branches')
  const { can, canDelete } = useCan()
  const canEdit = can('organization', 'branches', 'edit')
  const router = useRouter()
  const [plants, setPlants] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await organizationApi.listBranches()
      setPlants(data)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to load branches.').join(' '))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const filtered = useMemo(() => {
    if (!search.trim()) return plants
    const q = search.toLowerCase()
    return plants.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q) ||
      (p.company_name || '').toLowerCase().includes(q) ||
      (p.plant_type || '').toLowerCase().includes(q) ||
      (p.manager_user_name || '').toLowerCase().includes(q) ||
      (p.industry_function || '').toLowerCase().includes(q)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, search])

  const toggleActive = async (p: Branch, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const updated = await organizationApi.updateBranch(p.id, { status: p.status === 'active' ? 'inactive' : 'active' })
      setPlants((prev) => prev.map((x) => (x.id === p.id ? updated : x)))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to update branch status.').join(' '))
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null)

  const askDelete = (p: Branch, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteTarget(p)
  }

  const handleDelete = async () => {
    const p = deleteTarget
    if (!p) return
    setDeleteTarget(null)
    try {
      await organizationApi.deleteBranch(p.id)
      setPlants((prev) => prev.filter((x) => x.id !== p.id))
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not delete branch "${p.name}" — it may still have stores, departments or users attached. Remove those first, or deactivate the branch instead.`).join(' '))
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <OrganizationNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Organization
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>All Branches</h1>
        </div>
        {can('organization', 'branches', 'create') && <Link
          href="/dashboard/organization/plants/new"
          data-tour="org-plants-add-btn"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 10,
            background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`,
            color: '#fff', fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
            boxShadow: `0 4px 14px ${BRAND.primaryGlow}`,
          }}
        >
          <span style={{ fontSize: 17, lineHeight: 1 }}>+</span> Add Branch
        </Link>}
      </div>

      <div style={{ marginBottom: 16, maxWidth: 360 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Branch…"
          data-tour="org-plants-search"
          style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${BORDER.normal}`, background: '#fff', fontSize: 13.5, outline: 'none' }}
        />
      </div>

      <MessageDialog
        open={!!error}
        variant="error"
        title="Branches Error"
        message={error}
        onClose={() => setError('')}
        actionLabel="Reload"
        onAction={() => window.location.reload()}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this branch?"
        message={`Delete branch "${deleteTarget?.name}"? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead>
              <tr style={{ background: '#fdf1e6' }}>
                {['Branch Code', 'Branch Name', 'Company', 'Branch Type', 'Branch Manager', 'Industry / Function', 'Status', 'Created Date', 'Last Updated', ''].map((h, hi) => (
                  <th key={h} style={{ position: 'sticky', top: 0, zIndex: 1, background: '#fdf1e6', textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}>
                    {h}{hi === 0 && <RowCount count={filtered.length} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody data-tour="org-plants-table-rows">
              {loading && <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No branches found.</td></tr>
              )}
              {filtered.map((p, idx) => (
                <tr
                  key={p.id}
                  onClick={() => router.push(recordPath('/dashboard/organization/plants', p))}
                  style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer' }}
                >
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{p.code}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.body }}>{p.name}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{p.company_name || '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{p.plant_type || '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{p.manager_user_name || '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{p.industry_function || '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>
                    <span data-tour={idx === 0 ? 'org-plants-status-badge' : undefined} style={pillStyle(PLANT_STATUS_HEX[p.status] || '#78716c')}>
                      {PLANT_STATUS_LABELS[p.status] || p.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(p.created_at)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{formatDate(p.updated_at)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <span onClick={() => router.push(recordPath('/dashboard/organization/plants', p))} data-tour={idx === 0 ? 'org-plants-view-btn' : undefined} style={{ color: BRAND.primaryActive, cursor: 'pointer', fontWeight: 600 }}>View</span>
                      {canEdit && <span onClick={() => router.push(`${recordPath('/dashboard/organization/plants', p)}/edit`)} data-tour={idx === 0 ? 'org-plants-edit-btn' : undefined} style={{ color: BRAND.primaryActive, cursor: 'pointer', fontWeight: 600 }}>Edit</span>}
                      {canEdit && <span
                        onClick={(e) => toggleActive(p, e)}
                        data-tour={idx === 0 ? 'org-plants-toggle-status' : undefined}
                        style={{ color: p.status === 'active' ? '#92400e' : '#166534', cursor: 'pointer', fontWeight: 600 }}
                      >
                        {p.status === 'active' ? 'Deactivate' : 'Activate'}
                      </span>}
                      {canDelete('organization', 'branches', null) && <span
                        onClick={(e) => askDelete(p, e)}
                        data-tour={idx === 0 ? 'org-plants-delete-btn' : undefined}
                        style={{ color: '#b91c1c', cursor: 'pointer', fontWeight: 600 }}
                      >
                        Delete
                      </span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
