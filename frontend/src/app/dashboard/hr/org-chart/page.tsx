'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrDirectoryEntry } from '@/types'
import { TEXT, BORDER, BRAND } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import HrNav from '@/components/hr/HrNav'
import { extractErrorMessages } from '@/lib/validation'
import { sectionStyle, searchInputStyle, linkActionStyle, ErrorBanner, Avatar } from '@/components/hr/masters/masterUi'

type Tree = {
  byId: Map<number, HrDirectoryEntry>
  children: Map<number, HrDirectoryEntry[]>
  descendants: Map<number, number>
  leaders: HrDirectoryEntry[]
  standalone: HrDirectoryEntry[]
}

function buildTree(nodes: HrDirectoryEntry[], rootIds: number[]): Tree {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<number, HrDirectoryEntry[]>()
  for (const n of nodes) {
    if (n.manager_id != null && byId.has(n.manager_id)) {
      const list = children.get(n.manager_id) || []
      list.push(n)
      children.set(n.manager_id, list)
    }
  }
  children.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)))
  const descendants = new Map<number, number>()
  const count = (id: number, guard: Set<number>): number => {
    if (descendants.has(id)) return descendants.get(id) as number
    if (guard.has(id)) return 0
    guard.add(id)
    const total = (children.get(id) || []).reduce((s, c) => s + 1 + count(c.id, guard), 0)
    descendants.set(id, total)
    return total
  }
  nodes.forEach((n) => count(n.id, new Set()))
  const roots = rootIds.map((id) => byId.get(id)).filter(Boolean) as HrDirectoryEntry[]
  const leaders = roots.filter((r) => (children.get(r.id) || []).length > 0).sort((a, b) => (descendants.get(b.id) || 0) - (descendants.get(a.id) || 0) || a.name.localeCompare(b.name))
  const standalone = roots.filter((r) => !(children.get(r.id) || []).length).sort((a, b) => a.name.localeCompare(b.name))
  return { byId, children, descendants, leaders, standalone }
}

export default function HrOrgChartPage() {
  // Any logged-in user may view the org chart (PII-free).
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const isHr = !!user?.apps?.includes('hr')

  const [nodes, setNodes] = useState<HrDirectoryEntry[]>([])
  const [rootIds, setRootIds] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [showStandalone, setShowStandalone] = useState(false)

  useEffect(() => {
    if (!user) return
    hrApi.getOrgChart()
      .then((res) => {
        setNodes(res.nodes)
        setRootIds(res.root_ids)
        // start with every top-level leader open one level
        const open = new Set<number>()
        res.root_ids.forEach((id) => open.add(id))
        setExpanded(open)
        setError([])
      })
      .catch((err) => setError(extractErrorMessages(err, "Couldn't load the org chart.")))
      .finally(() => setLoading(false))
  }, [user])

  const tree = useMemo(() => buildTree(nodes, rootIds), [nodes, rootIds])
  const departments = useMemo(() => Array.from(new Set(nodes.map((n) => n.department).filter(Boolean) as string[])).sort(), [nodes])

  // Search / department filter: show matches plus the chain above them.
  const q = search.trim().toLowerCase()
  const filtering = !!q || !!department
  const { matches, visible } = useMemo(() => {
    const m = new Set<number>()
    const v = new Set<number>()
    if (!filtering) return { matches: m, visible: v }
    for (const n of nodes) {
      const textHit = !q || n.name.toLowerCase().includes(q) || (n.designation || '').toLowerCase().includes(q) || (n.department || '').toLowerCase().includes(q)
      const deptHit = !department || n.department === department
      if (textHit && deptHit) {
        m.add(n.id)
        let cur: HrDirectoryEntry | undefined = n
        const guard = new Set<number>()
        while (cur && !guard.has(cur.id)) {
          guard.add(cur.id)
          v.add(cur.id)
          cur = cur.manager_id != null ? tree.byId.get(cur.manager_id) : undefined
        }
      }
    }
    return { matches: m, visible: v }
  }, [filtering, q, department, nodes, tree])

  const isOpen = (id: number) => (filtering ? visible.has(id) : expanded.has(id))
  const toggle = (id: number) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const expandAll = () => setExpanded(new Set(nodes.filter((n) => (tree.children.get(n.id) || []).length).map((n) => n.id)))
  const collapseAll = () => setExpanded(new Set())

  const renderNode = (n: HrDirectoryEntry, depth: number, guard: Set<number>): React.ReactNode => {
    if (guard.has(n.id)) return null
    const nextGuard = new Set(guard).add(n.id)
    let kids = tree.children.get(n.id) || []
    if (filtering) kids = kids.filter((k) => visible.has(k.id))
    const open = isOpen(n.id) && kids.length > 0
    const allKids = (tree.children.get(n.id) || []).length
    const hit = filtering && matches.has(n.id)
    const isMe = user?.id === n.id
    return (
      <div key={n.id} style={{ marginLeft: depth ? 22 : 0, borderLeft: depth ? `1px solid ${BORDER.light}` : 'none', paddingLeft: depth ? 14 : 0 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', margin: '6px 0', borderRadius: 12,
            background: hit ? `${BRAND.primary}14` : isMe ? 'rgba(37,99,235,0.07)' : 'rgba(255,255,255,.6)',
            border: `1px solid ${hit ? BRAND.primaryBorder : BORDER.light}`, maxWidth: 640,
          }}
        >
          <button
            type="button"
            onClick={() => allKids && !filtering && toggle(n.id)}
            aria-label={open ? 'Collapse' : 'Expand'}
            style={{ width: 20, height: 20, border: 'none', background: 'none', padding: 0, cursor: allKids && !filtering ? 'pointer' : 'default', color: TEXT.muted, fontSize: 12, flex: 'none', visibility: allKids ? 'visible' : 'hidden' }}
          >
            {open ? '▾' : '▸'}
          </button>
          <Avatar name={n.name} url={n.profile_photo_url} id={n.id} size={34} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {isHr
                ? <span onClick={() => router.push(`/dashboard/hr/employees/${n.id}`)} style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading, cursor: 'pointer' }}>{n.name}</span>
                : <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{n.name}</span>}
              {isMe && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: '#2563EB1a', color: '#2563EB' }}>You</span>}
            </div>
            <div style={{ fontSize: 12, color: TEXT.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {[n.designation, n.department, n.branch].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
          {allKids > 0 && (
            <span title={`${tree.descendants.get(n.id) || 0} people in this team in total`} style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: 'rgba(0,0,0,0.05)', color: TEXT.secondary, whiteSpace: 'nowrap', flex: 'none' }}>
              {allKids} direct{(tree.descendants.get(n.id) || 0) > allKids ? ` · ${tree.descendants.get(n.id)} total` : ''}
            </span>
          )}
        </div>
        {open && kids.map((k) => renderNode(k, depth + 1, nextGuard))}
      </div>
    )
  }

  if (isLoading || !user) return null

  const leaders = filtering ? tree.leaders.filter((r) => visible.has(r.id)) : tree.leaders
  const standalone = filtering ? tree.standalone.filter((r) => visible.has(r.id)) : tree.standalone

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            HR &amp; Administration
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Org Chart</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>
            Who reports to whom, from each person&apos;s reporting manager. {nodes.length ? `${nodes.length} people.` : ''}
          </p>
        </div>
        {isHr && <button type="button" style={secondaryBtnStyle} onClick={() => router.push('/dashboard/hr/employees')}>Manage Employees</button>}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <input style={searchInputStyle} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person, designation or department…" />
        <select style={{ ...searchInputStyle, width: 200 }} value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {!filtering && (
          <>
            <button type="button" style={linkActionStyle} onClick={expandAll}>Expand all</button>
            <button type="button" style={linkActionStyle} onClick={collapseAll}>Collapse all</button>
          </>
        )}
        {filtering && (
          <>
            <span style={{ fontSize: 12.5, color: TEXT.secondary }}>{matches.size} match{matches.size === 1 ? '' : 'es'}</span>
            <button type="button" style={linkActionStyle} onClick={() => { setSearch(''); setDepartment('') }}>Clear</button>
          </>
        )}
      </div>

      <ErrorBanner errors={error} />

      <div style={sectionStyle}>
        {loading && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>}
        {!loading && !nodes.length && !error.length && <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No people to show yet.</p>}
        {!loading && nodes.length > 0 && leaders.length === 0 && standalone.length === 0 && (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nobody matches your search.</p>
        )}
        {!loading && nodes.length > 0 && leaders.length === 0 && !filtering && (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 8px' }}>
            No reporting lines are set yet. {isHr ? 'Set each person’s Reporting Manager on their HR profile to build the chart.' : 'HR sets reporting managers on employee profiles.'}
          </p>
        )}
        {leaders.map((r) => renderNode(r, 0, new Set()))}
      </div>

      {standalone.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '0 0 3px' }}>No reporting line ({standalone.length})</h3>
              <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
                People with no reporting manager and no direct reports.{isHr ? ' Set their manager on the HR profile so their approvals route correctly.' : ''}
              </p>
            </div>
            {!filtering && <button type="button" style={linkActionStyle} onClick={() => setShowStandalone(!showStandalone)}>{showStandalone ? 'Hide' : 'Show'}</button>}
          </div>
          {(showStandalone || filtering) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, marginTop: 12 }}>
              {standalone.map((n) => (
                <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 12, background: matches.has(n.id) ? `${BRAND.primary}14` : 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.light}` }}>
                  <Avatar name={n.name} url={n.profile_photo_url} id={n.id} size={30} />
                  <div style={{ minWidth: 0 }}>
                    <div onClick={isHr ? () => router.push(`/dashboard/hr/employees/${n.id}`) : undefined} style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, cursor: isHr ? 'pointer' : 'default' }}>{n.name}</div>
                    <div style={{ fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[n.designation, n.department].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
