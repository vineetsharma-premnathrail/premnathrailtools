'use client'

import { useEffect, useState } from 'react'
import { useRequireAdmin } from '@/hooks/useAuth'
import { organizationApi } from '@/lib/api'
import { AuditLogEntry, AuditDashboard } from '@/types'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'
import MessageDialog from '@/components/erp/MessageDialog'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const statCardStyle: React.CSSProperties = {
  padding: 16, borderRadius: 14, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(),
}
const inputStyle: React.CSSProperties = {
  padding: '9px 11px', borderRadius: 9, border: `1px solid ${BORDER.normal}`,
  background: '#fff', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cardRowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 16px', borderRadius: 12,
  background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.normal}`,
}

const MODULE_LABELS: Record<string, string> = {
  organization: 'Organization', erp: 'Service Module', crm: 'CRM Module', p2p: 'Procure-to-Pay', rnd: 'R&D Tools', other: 'Other',
}

const API_SOURCE_LABELS: Record<string, string> = {
  web_app: 'Web App', bearer_token: 'API Client (Bearer Token)',
}

function MetaField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <span style={{ fontSize: 11, color: TEXT.muted }}>
      <span style={{ fontWeight: 600, color: TEXT.secondary }}>{label}:</span> {value}
    </span>
  )
}

export default function AuditLogsPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const [dashboard, setDashboard] = useState<AuditDashboard | null>(null)
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [moduleFilter, setModuleFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [search, setSearch] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    Promise.all([
      organizationApi.getAuditDashboard(),
      organizationApi.listAuditLogs({
        module_key: moduleFilter || undefined,
        action: actionFilter || undefined,
        q: search || undefined,
      }),
    ])
      .then(([dash, logList]) => { setDashboard(dash); setLogs(logList) })
      .catch(() => setError('Failed to load audit logs.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, moduleFilter, actionFilter])

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault()
    load()
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <OrganizationNav />

      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Organization</p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>Audit Logs</h1>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 20px' }}>
        A read-only record of who did what, when — system-generated on every tracked action. Nothing here can be added or edited manually.
      </p>

      <MessageDialog open={!!error} variant="error" title="Audit Logs Error" message={error} onClose={() => setError('')} />

      {dashboard && (
        <div data-tour="org-audit-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 20 }}>
          <div style={statCardStyle}>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>Total Logs</p>
            <p style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{dashboard.total_logs}</p>
          </div>
          <div style={statCardStyle}>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>Today</p>
            <p style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{dashboard.logs_today}</p>
          </div>
          <div style={statCardStyle}>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>Last 7 Days</p>
            <p style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{dashboard.logs_last_7_days}</p>
          </div>
          <div style={statCardStyle}>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>Most Active User (7d)</p>
            <p style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{dashboard.top_users[0]?.user_name || '—'}</p>
            <p style={{ fontSize: 11, color: TEXT.muted, margin: '2px 0 0' }}>{dashboard.top_users[0] ? `${dashboard.top_users[0].count} action(s)` : ''}</p>
          </div>
        </div>
      )}

      {dashboard && Object.keys(dashboard.by_module).length > 0 && (
        <div style={sectionStyle} data-tour="org-audit-by-module">
          <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>Activity by Module</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {Object.entries(dashboard.by_module).map(([mk, count]) => (
              <span key={mk} style={{ fontSize: 12.5, fontWeight: 600, padding: '6px 14px', borderRadius: 9999, background: 'rgba(244,113,59,0.08)', color: BRAND.primary }}>
                {MODULE_LABELS[mk] || mk}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', marginBottom: 12 }}>All Audit Logs</h2>

        <form onSubmit={runSearch} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <select data-tour="org-audit-filter-module" style={inputStyle} value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
            <option value="">All Modules</option>
            {Object.entries(MODULE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <select data-tour="org-audit-filter-action" style={inputStyle} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">All Actions</option>
            {['create', 'created', 'update', 'updated', 'delete', 'deleted', 'approve', 'approved', 'reject', 'rejected', 'status_change'].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input data-tour="org-audit-filter-search" style={{ ...inputStyle, flex: '1 1 240px' }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search summary…" />
          <button data-tour="org-audit-search-btn" type="submit" style={{ padding: '9px 18px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`, color: '#fff' }}>Search</button>
        </form>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: TEXT.muted, fontSize: 13 }}>Loading…</div>
        ) : logs.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted }}>No audit logs match your filters.</p>
        ) : (
          <div data-tour="org-audit-log-list" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 460px)', overflowY: 'auto' }}>
            {logs.map((log) => (
              <div key={log.id} style={cardRowStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10.5, color: TEXT.muted }}>#{log.id}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading }}>{log.action}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: BRAND.primary }}>{MODULE_LABELS[log.module_key || 'other'] || log.module_key}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 9999, background: 'rgba(0,0,0,0.05)', color: TEXT.secondary }}>{log.entity_type}{log.entity_id ? ` #${log.entity_id}` : ''}</span>
                  </div>
                  <span style={{ fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>{new Date(log.performed_at).toLocaleString()}</span>
                </div>
                <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: 0 }}>
                  {log.summary || '—'}{log.performed_by_name ? ` · by ${log.performed_by_name}` : ''}
                </p>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 2 }}>
                  <MetaField label="IP Address" value={log.ip_address} />
                  <MetaField label="Device / Browser" value={log.user_agent} />
                  <MetaField label="Session ID" value={log.session_id != null ? String(log.session_id) : null} />
                  <MetaField label="API / Application Source" value={API_SOURCE_LABELS[log.api_source || ''] || log.api_source} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
