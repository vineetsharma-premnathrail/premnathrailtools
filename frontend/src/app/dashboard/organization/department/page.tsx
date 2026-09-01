'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRequireAdmin } from '@/hooks/useAuth'
import { organizationApi } from '@/lib/api'
import { Branch, Department, DepartmentMember } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'

export default function OrganizationDepartmentPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const [departments, setDepartments] = useState<Department[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [members, setMembers] = useState<Record<number, DepartmentMember[]>>({})
  const [membersLoading, setMembersLoading] = useState<number | null>(null)

  const [branchFilter, setBranchFilter] = useState('')
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false)
  const [branchDropdownCoords, setBranchDropdownCoords] = useState({ top: 0, left: 0 })
  const branchHeaderRef = useRef<HTMLSpanElement>(null)
  const branchDropdownRef = useRef<HTMLDivElement>(null)

  // Portaled to <body> with position:fixed, like SearchableSelect/DateField —
  // this header lives inside a table wrapper with overflow:'auto' + a
  // backdrop-filter glass card, which clips/breaks stacking for a normal
  // position:absolute dropdown.
  const openBranchDropdown = () => {
    const rect = branchHeaderRef.current?.getBoundingClientRect()
    if (rect) setBranchDropdownCoords({ top: rect.bottom + 6, left: rect.left })
    setBranchDropdownOpen((v) => !v)
  }

  useEffect(() => {
    if (!branchDropdownOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (branchHeaderRef.current?.contains(target)) return
      if (branchDropdownRef.current?.contains(target)) return
      setBranchDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [branchDropdownOpen])

  const visibleDepartments = branchFilter
    ? departments.filter((d) => String(d.branch_id) === branchFilter)
    : departments

  const load = async () => {
    setLoading(true)
    try {
      const [d, b] = await Promise.all([organizationApi.listDepartments(), organizationApi.listBranches()])
      setDepartments(d)
      setBranches(b)
    } catch {
      setError('Failed to load departments.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const toggleExpand = async (d: Department) => {
    if (expandedId === d.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(d.id)
    if (!members[d.id]) {
      setMembersLoading(d.id)
      try {
        const data = await organizationApi.getDepartmentMembers(d.id)
        setMembers((prev) => ({ ...prev, [d.id]: data }))
      } catch {
        setMembers((prev) => ({ ...prev, [d.id]: [] }))
      } finally {
        setMembersLoading(null)
      }
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Organization
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Department</h1>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 20px' }}>
        Auto-populated from Azure AD on sign-in and admin Azure sync — see Organization &gt; Users &gt; Sync Azure Users.
      </p>

      <OrganizationNav />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['Name', 'Code', 'Branch', 'Head'].map((h) =>
                h === 'Branch' ? (
                  <th
                    key={h}
                    style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap' }}
                  >
                    <span
                      ref={branchHeaderRef}
                      onClick={openBranchDropdown}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none', color: branchFilter ? BRAND.primaryActive : TEXT.muted }}
                    >
                      {h}
                      {branchFilter && <span>({branches.find((b) => String(b.id) === branchFilter)?.name})</span>}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </span>
                    {branchDropdownOpen && typeof document !== 'undefined' && createPortal(
                      <div
                        ref={branchDropdownRef}
                        style={{
                          position: 'fixed', top: branchDropdownCoords.top, left: branchDropdownCoords.left, zIndex: 1000, minWidth: 160,
                          background: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)',
                          boxShadow: '0 8px 24px rgba(15,23,42,0.16)', overflow: 'hidden', textTransform: 'none', letterSpacing: 'normal',
                        }}
                      >
                        <div
                          onClick={() => { setBranchFilter(''); setBranchDropdownOpen(false) }}
                          style={{ padding: '8px 14px', fontSize: 12.5, fontWeight: !branchFilter ? 700 : 500, color: !branchFilter ? BRAND.primaryActive : TEXT.secondary, cursor: 'pointer', background: !branchFilter ? 'rgba(255,122,69,0.08)' : 'transparent' }}
                        >
                          All Branches
                        </div>
                        {branches.map((b) => (
                          <div
                            key={b.id}
                            onClick={() => { setBranchFilter(String(b.id)); setBranchDropdownOpen(false) }}
                            style={{ padding: '8px 14px', fontSize: 12.5, fontWeight: branchFilter === String(b.id) ? 700 : 500, color: branchFilter === String(b.id) ? BRAND.primaryActive : TEXT.secondary, cursor: 'pointer', background: branchFilter === String(b.id) ? 'rgba(255,122,69,0.08)' : 'transparent' }}
                          >
                            {b.name}
                          </div>
                        ))}
                      </div>,
                      document.body
                    )}
                  </th>
                ) : (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted }}>{h}</th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && visibleDepartments.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No departments yet — sign in or run Azure sync to populate this.</td></tr>
            )}
            {visibleDepartments.map((d) => {
              const isOpen = expandedId === d.id
              const list = members[d.id]
              return (
                <Fragment key={d.id}>
                  <tr
                    onClick={() => toggleExpand(d)}
                    style={{ borderTop: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer', background: isOpen ? 'rgba(255,122,69,0.05)' : undefined }}
                  >
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <svg
                        width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ flex: 'none', color: TEXT.muted, transition: 'transform .15s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      {d.name}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{d.code}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{d.branch_name || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{d.head_user_name || '—'}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={4} style={{ padding: '4px 16px 16px 40px', background: 'rgba(0,0,0,0.015)' }}>
                        {membersLoading === d.id ? (
                          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Loading…</p>
                        ) : !list || list.length === 0 ? (
                          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No users linked to this department yet.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {[...list].sort((a, b) => Number(b.is_head) - Number(a.is_head)).map((m, i) => (
                              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0', color: TEXT.secondary }}>
                                <span style={{ color: TEXT.muted, fontFamily: 'monospace' }}>{i === list.length - 1 ? '└─' : '├─'}</span>
                                <span style={{ fontWeight: m.is_head ? 700 : 500, color: m.is_head ? BRAND.primaryActive : TEXT.secondary }}>{m.name}</span>
                                {m.is_head && (
                                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(255,122,69,0.14)', color: BRAND.primaryActive, textTransform: 'uppercase' }}>Head</span>
                                )}
                                {m.designation && <span style={{ color: TEXT.muted }}>· {m.designation}</span>}
                                <span style={{ color: TEXT.muted }}>· {m.email}</span>
                              </div>
                            ))}
                          </div>
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
  )
}
