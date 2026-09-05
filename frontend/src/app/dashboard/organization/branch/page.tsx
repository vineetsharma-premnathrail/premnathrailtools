'use client'

import { Fragment, useEffect, useState } from 'react'
import { useRequireAdmin } from '@/hooks/useAuth'
import { organizationApi } from '@/lib/api'
import { Branch, Department } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'

export default function OrganizationBranchPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [expandedId, setExpandedId] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [b, d] = await Promise.all([organizationApi.listBranches(), organizationApi.listDepartments()])
      setBranches(b)
      setDepartments(d)
    } catch {
      setError('Failed to load branches.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <OrganizationNav />

      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Organization
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Branch</h1>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 20px' }}>
        Auto-populated from Azure AD on sign-in and admin Azure sync — see Organization &gt; Role &amp; Permissions &gt; Sync Azure Users.
      </p>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
       <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['Name', 'Code', 'City'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && branches.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No branches yet — sign in or run Azure sync to populate this.</td></tr>
            )}
            {branches.map((b) => {
              const isOpen = expandedId === b.id
              const branchDepartments = departments.filter((d) => d.branch_id === b.id)
              return (
                <Fragment key={b.id}>
                  <tr
                    onClick={() => setExpandedId(isOpen ? null : b.id)}
                    style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer', background: isOpen ? 'rgba(255,122,69,0.05)' : undefined }}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <svg
                        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ flex: 'none', color: TEXT.muted, transition: 'transform .15s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      {b.name}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.code}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{b.city || '—'}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={3} style={{ padding: '4px 16px 16px 40px', background: 'rgba(0,0,0,0.015)' }}>
                        {branchDepartments.length === 0 ? (
                          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No departments under this branch yet.</p>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: 640 }}>
                            <thead>
                              <tr>
                                {['Department', 'Code', 'Head'].map((h) => (
                                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {branchDepartments.map((d) => (
                                <tr key={d.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                                  <td style={{ padding: '6px 10px', fontSize: 12.5, fontWeight: 600, color: TEXT.secondary }}>{d.name}</td>
                                  <td style={{ padding: '6px 10px', fontSize: 12.5, color: TEXT.secondary }}>{d.code}</td>
                                  <td style={{ padding: '6px 10px', fontSize: 12.5, color: TEXT.secondary }}>{d.head_user_name || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
       </div>
      </div>
    </div>
  )
}
