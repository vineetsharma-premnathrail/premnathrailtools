'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { User } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import HrNav from '@/components/hr/HrNav'
import { inputStyle } from '@/components/shared/ui'

export default function HrDirectoryPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const [employees, setEmployees] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editManager, setEditManager] = useState('')
  const [editDoj, setEditDoj] = useState('')
  const [editDesignation, setEditDesignation] = useState('')
  const [editDepartment, setEditDepartment] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setEmployees(await hrApi.directory())
    } catch {
      setError('Failed to load employee directory.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return employees
    return employees.filter((e) =>
      e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) ||
      (e.department || '').toLowerCase().includes(q) || (e.designation || '').toLowerCase().includes(q)
    )
  }, [employees, search])

  const startEdit = (emp: User) => {
    setEditingId(emp.id)
    setEditManager(emp.reporting_manager_id ? String(emp.reporting_manager_id) : '')
    setEditDoj(emp.date_of_joining || '')
    setEditDesignation(emp.designation || '')
    setEditDepartment(emp.department || '')
  }

  const saveEdit = async (id: number) => {
    setBusy(true)
    setError('')
    try {
      await hrApi.updateProfile(id, {
        reporting_manager_id: editManager ? Number(editManager) : null,
        date_of_joining: editDoj || null,
        designation: editDesignation || undefined,
        department: editDepartment || undefined,
      })
      setEditingId(null)
      await load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to save.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        HR Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Employee Directory</h1>
      <p style={{ fontSize: 13.5, color: TEXT.muted, margin: '0 0 20px' }}>{employees.length} active employee(s)</p>

      <HrNav />

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, email, department, or designation…"
        style={{ ...inputStyle, maxWidth: 420, marginBottom: 16 }}
      />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr style={{ background: `${BRAND.primary}0d` }}>
              {['Name', 'Email', 'Department', 'Designation', 'Reporting Manager', 'Date of Joining', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>Loading…</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: TEXT.muted, fontSize: 13 }}>No employees found.</td></tr>
            )}
            {filtered.map((emp) => (
              <tr key={emp.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{emp.name}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{emp.email}</td>
                {editingId === emp.id ? (
                  <>
                    <td style={{ padding: '8px 12px', minWidth: 130 }}>
                      <input style={inputStyle} value={editDepartment} onChange={(e) => setEditDepartment(e.target.value)} />
                    </td>
                    <td style={{ padding: '8px 12px', minWidth: 130 }}>
                      <input style={inputStyle} value={editDesignation} onChange={(e) => setEditDesignation(e.target.value)} />
                    </td>
                    <td style={{ padding: '8px 12px', minWidth: 180 }}>
                      <SearchableSelect
                        value={editManager}
                        onChange={setEditManager}
                        options={employees.filter((e) => e.id !== emp.id).map((e) => ({ value: String(e.id), label: e.name }))}
                        placeholder="Search manager…"
                      />
                    </td>
                    <td style={{ padding: '8px 12px', minWidth: 140 }}>
                      <DateField value={editDoj} onChange={setEditDoj} />
                    </td>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                      <span onClick={() => !busy && saveEdit(emp.id)} style={{ fontSize: 11.5, fontWeight: 600, color: '#16a34a', cursor: 'pointer', marginRight: 10 }}>Save</span>
                      <span onClick={() => setEditingId(null)} style={{ fontSize: 11.5, fontWeight: 600, color: TEXT.muted, cursor: 'pointer' }}>Cancel</span>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{emp.department || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{emp.designation || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: TEXT.secondary }}>{emp.reporting_manager_name || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12.5, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{emp.date_of_joining ? new Date(emp.date_of_joining).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span onClick={() => startEdit(emp)} style={{ fontSize: 11.5, fontWeight: 600, color: '#2563eb', cursor: 'pointer' }}>Edit</span>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
