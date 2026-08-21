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
          <div style={{ display: 'flex', gap: 24, paddingTop: 0 }}>
            {children.map((child) => (
              <NodeCard key={child.employee.id} node={child} />
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
        <div style={{ overflowX: 'auto', paddingBottom: 20 }}>
          <div style={{ display: 'flex', gap: 40, minWidth: 'max-content', padding: '10px 4px' }}>
            {forest.map((root) => (
              <NodeCard key={root.employee.id} node={root} />
            ))}
          </div>
        </div>
      )}

      {forest.length > 1 && (
        <p style={{ fontSize: 12, color: TEXT.muted, marginTop: 8 }}>
          {forest.length} employee(s) have no reporting manager set — each shown as a separate root above.
        </p>
      )}
    </div>
  )
}
