'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { rolesApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { Role } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, chipBtnStyle, RowCount } from '@/components/shared/ui'
import OrganizationNav from '@/components/organization/OrganizationNav'
import { recordPath } from '@/lib/recordRef'
import TourButton from '@/components/tour/TourButton'
import { extractErrorMessages } from '@/lib/validation'

// Organization › Role & Permissions — the list of roles. A role is a named
// bundle of module › tab › action grants ("Store Keeper", "Finance – View
// Only"); users get access by holding one or more roles (assigned here or on
// the user's profile). Built-in presets (Full Access / View Only per module)
// can be assigned or copied but not edited.

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden',
}

type Filter = 'all' | 'custom' | 'builtin'

function badge(bg: string, color: string): React.CSSProperties {
  return { fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 9999, background: bg, color, whiteSpace: 'nowrap' }
}

export default function OrganizationRolesPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('roles')
  const { can } = useCan()
  const router = useRouter()
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('custom')

  useEffect(() => {
    if (!isAuthorized) return
    rolesApi.list()
      .then(setRoles)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load roles. Reload the page; if it keeps failing, check the backend is running.').join(' ')))
      .finally(() => setLoading(false))
  }, [isAuthorized])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return roles.filter((r) => {
      if (filter === 'custom' && r.is_system) return false
      if (filter === 'builtin' && !r.is_system) return false
      return !q || r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q)
    })
  }, [roles, query, filter])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <OrganizationNav />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Role &amp; Permissions</h1>
          <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '6px 0 0', maxWidth: 720 }}>
            A role is a job&apos;s access — which modules, tabs and actions (view, create, edit, delete, approve…) it allows.
            Give users one or more roles; their access is everything their roles allow. Users can delete only records they
            created themselves (admins can delete anything).
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TourButton variant="icon" />
          {can('organization', 'roles', 'create') && <button type="button" data-tour="org-roles-new" onClick={() => router.push('/dashboard/organization/roles/new')} style={primaryBtnStyle}>+ New Role</button>}
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13, marginBottom: 14 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search roles…" style={{ ...inputStyle, maxWidth: 280 }} data-tour="org-roles-search" />
        <div data-tour="org-roles-filter" style={{ display: 'flex', gap: 6 }}>
          {([['custom', 'Custom roles'], ['builtin', 'Built-in presets'], ['all', 'All']] as [Filter, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} style={chipBtnStyle(filter === k)}>{label}</button>
          ))}
        </div>
      </div>

      <div style={cardStyle} data-tour="org-roles-table">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                {['Role', 'Description', 'Type', 'Users'].map((h, hi) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}{hi === 0 && <RowCount count={visible.length} />}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4} style={{ padding: 20, fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>}
              {!loading && visible.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 20, fontSize: 13, color: TEXT.muted }}>
                  {filter === 'custom' && !query ? 'No custom roles yet — click “+ New Role”, or copy a built-in preset.' : 'No role matches.'}
                </td></tr>
              )}
              {visible.map((r) => (
                <tr key={r.id} onClick={() => router.push(recordPath('/dashboard/organization/roles', r))}
                  style={{ borderTop: `1px solid ${BORDER.normal}`, cursor: 'pointer', opacity: r.is_active ? 1 : 0.55 }}>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{r.name}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, maxWidth: 420 }}>{r.description || '—'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {r.is_system ? <span style={badge('rgba(37,99,235,0.1)', '#1d4ed8')}>Built-in</span> : <span style={badge('rgba(244,113,59,0.1)', '#c2410c')}>Custom</span>}
                      {r.is_default && <span style={badge('rgba(16,185,129,0.12)', '#047857')}>Everyone</span>}
                      {!r.is_active && <span style={badge('rgba(0,0,0,0.06)', TEXT.muted)}>Inactive</span>}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.body }}>{r.is_default ? 'All' : r.user_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
