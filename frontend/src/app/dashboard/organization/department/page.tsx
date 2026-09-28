'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRequireAdmin } from '@/hooks/useAuth'
import { organizationApi, usersApi } from '@/lib/api'
import { Branch, Department, DepartmentMember, DirectoryUser } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'
import MessageDialog from '@/components/erp/MessageDialog'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }

export default function OrganizationDepartmentPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const [departments, setDepartments] = useState<Department[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [directory, setDirectory] = useState<DirectoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [members, setMembers] = useState<Record<number, DepartmentMember[]>>({})
  const [membersLoading, setMembersLoading] = useState<number | null>(null)

  const [branchFilter, setBranchFilter] = useState('')

  // Add Department modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newBranchId, setNewBranchId] = useState('')
  const [headIds, setHeadIds] = useState<number[]>([])
  const [headSearch, setHeadSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
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

  useEffect(() => {
    if (isAuthorized) usersApi.directory().then(setDirectory).catch(() => setDirectory([]))
  }, [isAuthorized])

  const openAddModal = () => {
    setNewName('')
    setNewBranchId('')
    setHeadIds([])
    setHeadSearch('')
    setFormError('')
    setShowAddModal(true)
  }

  const addHead = (id: number) => {
    if (headIds.includes(id)) return
    setHeadIds((prev) => [...prev, id])
    setHeadSearch('')
  }
  const removeHead = (id: number) => setHeadIds((prev) => prev.filter((h) => h !== id))

  const headMatches = headSearch.trim()
    ? directory
        .filter((u) => !headIds.includes(u.id))
        .filter((u) => u.name.toLowerCase().includes(headSearch.toLowerCase()) || u.email.toLowerCase().includes(headSearch.toLowerCase()))
        .slice(0, 8)
    : []

  const handleCreate = async () => {
    if (!newName.trim()) {
      setFormError('Department name is required')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      await organizationApi.createDepartment({
        name: newName.trim(),
        branch_id: newBranchId ? Number(newBranchId) : undefined,
        head_user_id: headIds[0] ?? undefined,
        secondary_head_user_id: headIds[1] ?? undefined,
        additional_head_user_ids: headIds.length > 2 ? headIds.slice(2) : undefined,
      })
      setShowAddModal(false)
      load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFormError(detail || 'Failed to create department.')
    } finally {
      setSaving(false)
    }
  }

  const [addMemberSearch, setAddMemberSearch] = useState('')
  const [addMemberSaving, setAddMemberSaving] = useState(false)

  const refreshMembers = async (deptId: number) => {
    try {
      const data = await organizationApi.getDepartmentMembers(deptId)
      setMembers((prev) => ({ ...prev, [deptId]: data }))
    } catch {
      // leave existing list as-is on refresh failure
    }
  }

  const handleAddMember = async (deptId: number, userId: number) => {
    setAddMemberSaving(true)
    try {
      await organizationApi.addDepartmentMember(deptId, userId)
      setAddMemberSearch('')
      await refreshMembers(deptId)
    } catch {
      // swallow — member list simply won't reflect the change
    } finally {
      setAddMemberSaving(false)
    }
  }

  const handleRemoveMember = async (deptId: number, userId: number) => {
    try {
      await organizationApi.removeDepartmentMember(deptId, userId)
      await refreshMembers(deptId)
    } catch {
      // swallow — member list simply won't reflect the change
    }
  }

  const toggleExpand = async (d: Department) => {
    if (expandedId === d.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(d.id)
    setAddMemberSearch('')
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
      <OrganizationNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Organization
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Department</h1>
        </div>
        <button
          data-tour="org-dept-add-btn"
          onClick={openAddModal}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', borderRadius: 10, border: 'none',
            background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`,
            color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
            boxShadow: `0 4px 14px ${BRAND.primaryGlow}`,
          }}
        >
          <span style={{ fontSize: 17, lineHeight: 1 }}>+</span> Add Department
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 20px' }}>
        Auto-populated from Azure AD on sign-in and admin Azure sync — see Organization &gt; Role &amp; Permissions &gt; Sync Azure Users. You can also add departments manually below.
      </p>

      <MessageDialog
        open={!!error}
        variant="error"
        title="Failed to Load Departments"
        message={error}
        onClose={() => setError('')}
        actionLabel="Reload"
        onAction={() => window.location.reload()}
      />

      {showAddModal && (
        <div
          onClick={() => !saving && setShowAddModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, maxWidth: 480, width: '100%', padding: 24 }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px 0', color: TEXT.heading }}>Add Department</h2>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Name *</label>
              <input data-tour="org-dept-name" style={inputStyle} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Accounts" />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Branch</label>
              <select data-tour="org-dept-branch" style={inputStyle} value={newBranchId} onChange={(e) => setNewBranchId(e.target.value)}>
                <option value="">— Select —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 14 }} data-tour="org-dept-heads">
              <label style={labelStyle}>Head of Department (one or more)</label>
              {headIds.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {headIds.map((id) => {
                    const u = directory.find((d) => d.id === id)
                    return (
                      <span
                        key={id}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999,
                          background: 'rgba(255,122,69,0.12)', color: BRAND.primaryActive, fontSize: 12.5, fontWeight: 600,
                        }}
                      >
                        {u?.name || `User #${id}`}
                        <span onClick={() => removeHead(id)} style={{ cursor: 'pointer', fontWeight: 700 }}>×</span>
                      </span>
                    )
                  })}
                </div>
              )}
              <input
                style={inputStyle}
                value={headSearch}
                onChange={(e) => setHeadSearch(e.target.value)}
                placeholder="Search name or email…"
              />
              {headMatches.length > 0 && (
                <div style={{ marginTop: 6, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, overflow: 'hidden' }}>
                  {headMatches.map((u) => (
                    <div
                      key={u.id}
                      onClick={() => addHead(u.id)}
                      style={{ padding: '8px 12px', fontSize: 12.5, cursor: 'pointer', color: TEXT.secondary, borderTop: '1px solid rgba(0,0,0,0.04)' }}
                    >
                      <span style={{ fontWeight: 600 }}>{u.name}</span> · {u.email}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {formError && (
              <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fee2e2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12.5, marginBottom: 14 }}>
                {formError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowAddModal(false)}
                disabled={saving}
                style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #d4d4d8', background: '#fff', color: TEXT.body, fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1 }}
              >
                Cancel
              </button>
              <button
                data-tour="org-dept-save"
                onClick={handleCreate}
                disabled={saving}
                style={{
                  padding: '10px 20px', borderRadius: 8, border: 'none',
                  background: saving ? '#999' : BRAND.primary, color: '#fff', fontSize: 13, fontWeight: 700,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving…' : 'Save Department'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div data-tour="org-dept-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
       <div style={{ overflow: 'auto' }}>
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
                      data-tour="org-dept-branch-filter"
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
            {visibleDepartments.map((d, i) => {
              const isOpen = expandedId === d.id
              const list = members[d.id]
              return (
                <Fragment key={d.id}>
                  <tr
                    data-tour={i === 0 ? 'org-dept-row' : undefined}
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
                      <td colSpan={4} style={{ padding: '4px 16px 16px 40px', background: 'rgba(0,0,0,0.015)' }} onClick={(e) => e.stopPropagation()}>
                        {membersLoading === d.id ? (
                          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Loading…</p>
                        ) : !list || list.length === 0 ? (
                          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px 0' }}>No users linked to this department yet.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
                            {[...list].sort((a, b) => Number(b.is_head) - Number(a.is_head)).map((m, i) => (
                              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0', color: TEXT.secondary }}>
                                <span style={{ color: TEXT.muted, fontFamily: 'monospace' }}>{i === list.length - 1 ? '└─' : '├─'}</span>
                                <span style={{ fontWeight: m.is_head ? 700 : 500, color: m.is_head ? BRAND.primaryActive : TEXT.secondary }}>{m.name}</span>
                                {m.is_head && (
                                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(255,122,69,0.14)', color: BRAND.primaryActive, textTransform: 'uppercase' }}>Head</span>
                                )}
                                {m.designation && <span style={{ color: TEXT.muted }}>· {m.designation}</span>}
                                <span style={{ color: TEXT.muted }}>· {m.email}</span>
                                {!m.is_head && (
                                  <span
                                    onClick={() => handleRemoveMember(d.id, m.id)}
                                    style={{ color: '#b91c1c', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                                  >
                                    Remove
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ maxWidth: 320 }} data-tour="org-dept-add-member">
                          <input
                            style={{ ...inputStyle, fontSize: 12.5, padding: '7px 10px' }}
                            value={expandedId === d.id ? addMemberSearch : ''}
                            onChange={(e) => setAddMemberSearch(e.target.value)}
                            placeholder="+ Add member — search name or email…"
                            disabled={addMemberSaving}
                          />
                          {addMemberSearch.trim() && (
                            <div style={{ marginTop: 4, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                              {directory
                                .filter((u) => !(list || []).some((m) => m.id === u.id))
                                .filter((u) => u.name.toLowerCase().includes(addMemberSearch.toLowerCase()) || u.email.toLowerCase().includes(addMemberSearch.toLowerCase()))
                                .slice(0, 8)
                                .map((u) => (
                                  <div
                                    key={u.id}
                                    onClick={() => handleAddMember(d.id, u.id)}
                                    style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: TEXT.secondary, borderTop: '1px solid rgba(0,0,0,0.04)' }}
                                  >
                                    <span style={{ fontWeight: 600 }}>{u.name}</span> · {u.email}
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
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
