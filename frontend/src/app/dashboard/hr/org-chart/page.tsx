'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { User } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import HrNav from '@/components/hr/HrNav'

interface TreeNode {
  employee: User
  children: TreeNode[]
}

function buildForest(employees: User[]): TreeNode[] {
  const byId = new Map<number, TreeNode>(employees.map((e) => [e.id, { employee: e, children: [] }]))
  const roots: TreeNode[] = []
  for (const emp of employees) {
    const node = byId.get(emp.id)!
    const managerNode = emp.reporting_manager_id ? byId.get(emp.reporting_manager_id) : undefined
    if (managerNode) {
      managerNode.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

function NodeCard({ node }: { node: TreeNode }) {
  const [expanded, setExpanded] = useState(true)
  const { employee, children } = node

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div
        style={{
          borderRadius: 14, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
          border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: '10px 16px', minWidth: 170,
          textAlign: 'center', cursor: children.length ? 'pointer' : 'default',
        }}
        onClick={() => children.length && setExpanded((v) => !v)}
      >
        <p style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading, margin: '0 0 2px' }}>{employee.name}</p>
        <p style={{ fontSize: 11.5, color: TEXT.muted, margin: 0 }}>{employee.designation || employee.department || '—'}</p>
        {children.length > 0 && (
          <p style={{ fontSize: 10.5, color: '#db2777', margin: '4px 0 0', fontWeight: 600 }}>
            {expanded ? '▲' : `▼ ${children.length} report(s)`}
          </p>
        )}
      </div>
      {expanded && children.length > 0 && (
        <>
          <div style={{ width: 1, height: 16, background: BORDER.normal }} />
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24, paddingTop: 16, borderTop: `1px solid ${BORDER.normal}` }}>
            {children.map((child) => (
              <div key={child.employee.id} style={{ position: 'relative', paddingTop: 0 }}>
                <div style={{ position: 'absolute', top: -16, left: '50%', width: 1, height: 16, background: BORDER.normal }} />
                <NodeCard node={child} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function OrgChartPage() {
  const { isAuthorized, isLoading } = useRequireApp('hr')
  const [employees, setEmployees] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    setLoading(true)
    hrApi.directory()
      .then(setEmployees)
      .catch(() => setError('Failed to load org chart.'))
      .finally(() => setLoading(false))
  }, [isAuthorized])

  const forest = useMemo(() => buildForest(employees), [employees])
  const assignedForest = useMemo(() => forest.filter((root) => root.children.length > 0), [forest])
  const unassigned = useMemo(() => forest.filter((root) => root.children.length === 0).map((root) => root.employee), [forest])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        HR Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Org Chart</h1>

      <HrNav />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.secondary }}>Loading…</p>
      ) : forest.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>No employees found.</p>
      ) : (
        <div style={{ paddingBottom: 20 }}>
          {assignedForest.length > 0 && (
            <div style={{ overflowX: 'auto', padding: '10px 4px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 56, minWidth: 'max-content' }}>
                {assignedForest.map((root) => <NodeCard key={root.employee.id} node={root} />)}
              </div>
            </div>
          )}
          {unassigned.length > 0 && (
            <div style={{ marginTop: assignedForest.length ? 8 : 0, padding: 16, borderRadius: 14, background: 'rgba(148,163,184,0.08)', border: `1px dashed ${BORDER.normal}` }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, margin: '0 0 12px' }}>Employees awaiting reporting manager</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
                {unassigned.map((employee) => (
                  <div key={employee.id} style={{ borderRadius: 12, background: GLASS.card, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: '9px 14px', minWidth: 150, textAlign: 'center' }}>
                    <p style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading, margin: '0 0 2px' }}>{employee.name}</p>
                    <p style={{ fontSize: 11, color: TEXT.muted, margin: 0 }}>{employee.designation || employee.department || '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {unassigned.length > 0 && (
        <p style={{ fontSize: 12, color: TEXT.muted, marginTop: 8 }}>
          {unassigned.length} employee(s) have no reporting manager set. Assign managers from the Directory to build the pyramid hierarchy.
        </p>
      )}
    </div>
  )
}
