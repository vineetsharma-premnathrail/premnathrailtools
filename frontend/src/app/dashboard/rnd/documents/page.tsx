'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { RndProject } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import RndNav from '@/components/rnd/RndNav'
import RndDocumentsPanel from '@/components/rnd/RndDocumentsPanel'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}

export default function RndDocumentsPage() {
  return (
    <Suspense fallback={null}>
      <RndDocuments />
    </Suspense>
  )
}

function RndDocuments() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const searchParams = useSearchParams()

  const [projects, setProjects] = useState<RndProject[]>([])
  const [projectFilter, setProjectFilter] = useState(searchParams.get('project_id') || '')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    rndApi.listProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load R&D projects.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <RndNav />

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          R&amp;D Module
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>R&amp;D Documents</h1>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
          Specifications, drawings, test reports and process documents across every R&amp;D project.
        </p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          style={{ ...inputStyle, flex: '1 1 240px', minWidth: 200 }}
          placeholder="Search by title or file name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ flex: '0 1 300px', minWidth: 220 }}>
          <SearchableSelect
            value={projectFilter}
            onChange={setProjectFilter}
            options={[{ value: '', label: 'All projects' }, ...projects.map((p) => ({ value: String(p.id), label: `${p.project_number} — ${p.title}` }))]}
            placeholder="All projects"
          />
        </div>
        <select style={{ ...inputStyle, flex: '0 1 190px' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="specification">Specification</option>
          <option value="drawing">Drawing</option>
          <option value="test_report">Test Report</option>
          <option value="research_note">Research Note</option>
          <option value="process_document">Process Document</option>
          <option value="other">Other</option>
        </select>
      </div>

      <RndDocumentsPanel
        key={projectFilter || 'all'}
        projectId={projectFilter ? Number(projectFilter) : undefined}
        docTypeFilter={typeFilter}
        search={search}
        currentUserId={user?.id}
        isAdmin={user?.role === 'admin'}
      />
    </div>
  )
}
