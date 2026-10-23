'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { useCan } from '@/lib/permissions'
import OrganizationNav from '@/components/organization/OrganizationNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { grcApi, SodMitigationRow, SodReport, SodRule } from '@/lib/basisApi'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { BORDER, GLASS, SHADOWS, TEXT } from '@/lib/theme'
import { usePermissionWords } from '@/lib/permissionWords'

// Organization › Access Risk (SAP GRC Access Risk Analysis). The ruleset is
// coded (backend core/sod_rules.py); this page reports who / which role
// violates it and the mitigations that were accepted on assignment.

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 18, marginBottom: 16,
}
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const td: React.CSSProperties = { padding: '9px 10px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const RISK_LABELS: Record<string, string> = { high: 'High', medium: 'Medium' }
const RISK_HEX: Record<string, string> = { high: '#DC2626', medium: '#F59E0B' }
const TABS = [{ key: 'users', label: 'Users in conflict' }, { key: 'roles', label: 'Roles in conflict' }, { key: 'mitigations', label: 'Mitigations' }, { key: 'rules', label: 'Ruleset' }] as const

function Risk({ risk }: { risk: string }) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${RISK_HEX[risk]}1a`, color: RISK_HEX[risk], whiteSpace: 'nowrap' }}>{RISK_LABELS[risk] || risk}</span>
}

export default function AccessRiskPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('grc')
  const { can } = useCan()
  const router = useRouter()
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('users')
  const [report, setReport] = useState<SodReport | null>(null)
  const [rules, setRules] = useState<SodRule[]>([])
  const [mitigations, setMitigations] = useState<SodMitigationRow[]>([])
  const [error, setError] = useState('')
  const [withdraw, setWithdraw] = useState<SodMitigationRow | null>(null)
  const { permLabel } = usePermissionWords()
  const words = (ids: string[]) => ids.map(permLabel).join('; ')

  const load = useCallback(() => {
    grcApi.sodReport().then(setReport).catch((e) => setError(extractErrorMessages(e, 'Could not run the SoD analysis.').join(' ')))
    grcApi.sodRules().then(setRules).catch(() => {})
    grcApi.mitigations().then(setMitigations).catch(() => {})
  }, [])
  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, load])

  if (isLoading || !isAuthorized) return null

  const doWithdraw = async () => {
    const m = withdraw; setWithdraw(null)
    if (!m) return
    try { await grcApi.deleteMitigation(m.id); load() } catch (e) { setError(extractErrorMessages(e, 'Could not withdraw the mitigation.').join(' ')) }
  }
  const unmitigatedHigh = (report?.users || []).filter((u) => u.conflicts.some((c) => c.risk === 'high' && !c.mitigation)).length

  return (
    <div>
      <OrganizationNav />
      <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Access Risk (Segregation of Duties)</h1>
      <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 16px' }}>
        Who holds two duties that should be split between people. Assigning a high-risk conflict on the Users page needs a mitigation reason.
        {report && ` ${report.admins_excluded} admin account(s) hold everything by design and are not listed.`}
      </p>
      {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      <ConfirmDialog open={!!withdraw} title="Withdraw this mitigation?" confirmLabel="Withdraw"
        message={withdraw ? `${withdraw.user_name}'s ${withdraw.rule_id} conflict will show as unmitigated again.` : ''}
        onConfirm={doWithdraw} onCancel={() => setWithdraw(null)} />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        {[{ l: 'Users in conflict', v: report?.users.length ?? '—' }, { l: 'Unmitigated high risk', v: report ? unmitigatedHigh : '—' }, { l: 'Roles in conflict', v: report?.roles.length ?? '—' }, { l: 'Rules', v: rules.length }].map((t) => (
          <div key={t.l} style={{ ...cardStyle, marginBottom: 0, flex: '1 1 180px', maxWidth: 260, padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase' }}>{t.l}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: TEXT.heading }}>{t.v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{ padding: '7px 14px', borderRadius: 9999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${tab === t.key ? '#FF7A45' : BORDER.normal}`, background: tab === t.key ? 'rgba(255,122,69,0.1)' : '#fff', color: tab === t.key ? '#c2410c' : TEXT.secondary }}>{t.label}</button>
        ))}
      </div>

      <div style={{ ...cardStyle, overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        {tab === 'users' && (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr><th style={th}>User</th><th style={th}>Rule</th><th style={th}>Risk</th><th style={th}>Holds</th><th style={th}>Mitigation</th></tr></thead>
            <tbody>
              {report && report.users.length === 0 && <tr><td style={td} colSpan={5}>No user holds conflicting duties.</td></tr>}
              {report?.users.flatMap((u) => u.conflicts.map((c, i) => (
                <tr key={`${u.user_id}-${c.rule_id}`} style={{ cursor: 'pointer' }} onClick={() => router.push(recordPath('/dashboard/users', u, 'user_id'))}>
                  <td style={{ ...td, fontWeight: 600 }}>{i === 0 ? <>{u.name}<div style={{ fontSize: 11, color: TEXT.muted, fontWeight: 400 }}>{u.department || u.email}</div></> : ''}</td>
                  <td style={td}><b>{c.rule_id}</b> {c.title}<div style={{ fontSize: 11, color: TEXT.muted }}>{c.why}</div></td>
                  <td style={td}><Risk risk={c.risk} /></td>
                  <td style={{ ...td, fontSize: 11.5 }}>{c.side_a_label}: {words(c.side_a_held)}<br />{c.side_b_label}: {words(c.side_b_held)}</td>
                  <td style={td}>{c.mitigation ? <>{c.mitigation.reason}<div style={{ fontSize: 11, color: TEXT.muted }}>by {c.mitigation.mitigated_by_name || '—'}{c.mitigation.valid_to ? `, until ${new Date(c.mitigation.valid_to).toLocaleDateString('en-GB')}` : ''}</div></> : <span style={{ color: '#b91c1c', fontWeight: 600 }}>None</span>}</td>
                </tr>
              )))}
            </tbody>
          </table>
        )}
        {tab === 'roles' && (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr><th style={th}>Role</th><th style={th}>Rule</th><th style={th}>Risk</th><th style={th}>Grants both</th></tr></thead>
            <tbody>
              {report && report.roles.length === 0 && <tr><td style={td} colSpan={4}>No role on its own combines conflicting duties.</td></tr>}
              {report?.roles.flatMap((r) => r.conflicts.map((c) => (
                <tr key={`${r.role_id}-${c.rule_id}`} style={{ cursor: 'pointer' }} onClick={() => router.push(recordPath('/dashboard/organization/roles', r, 'role_id'))}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.name}{r.is_system && <span style={{ fontSize: 10, color: '#1d4ed8', marginLeft: 6 }}>BUILT-IN</span>}</td>
                  <td style={td}><b>{c.rule_id}</b> {c.title}</td><td style={td}><Risk risk={c.risk} /></td>
                  <td style={{ ...td, fontSize: 11.5 }}>{words([...c.side_a_held, ...c.side_b_held])}</td>
                </tr>
              )))}
            </tbody>
          </table>
        )}
        {tab === 'mitigations' && (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead><tr><th style={th}>User</th><th style={th}>Rule</th><th style={th}>Mitigating control</th><th style={th}>Valid to</th><th style={th}>Accepted by</th><th style={th}></th></tr></thead>
            <tbody>
              {mitigations.length === 0 && <tr><td style={td} colSpan={6}>No SoD risk has been accepted yet.</td></tr>}
              {mitigations.map((m) => (
                <tr key={m.id} style={{ opacity: m.active ? 1 : 0.55 }}>
                  <td style={{ ...td, fontWeight: 600 }}>{m.user_name}</td><td style={td}><b>{m.rule_id}</b> {m.rule_title}</td>
                  <td style={td}>{m.reason}</td><td style={td}>{m.valid_to ? new Date(m.valid_to).toLocaleDateString('en-GB') : 'No end date'}</td>
                  <td style={td}>{m.mitigated_by_name || '—'}<div style={{ fontSize: 11, color: TEXT.muted }}>{new Date(m.created_at).toLocaleDateString('en-GB')}</div></td>
                  <td style={td}>{can('organization', 'grc', 'edit') && <button type="button" onClick={() => setWithdraw(m)} style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer' }}>Withdraw</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'rules' && (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr><th style={th}>Rule</th><th style={th}>Risk</th><th style={th}>Duty A</th><th style={th}>Duty B</th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.rule_id}>
                  <td style={td}><b>{r.rule_id}</b> {r.title}<div style={{ fontSize: 11, color: TEXT.muted }}>{r.why}</div></td>
                  <td style={td}><Risk risk={r.risk} /></td>
                  <td style={{ ...td, fontSize: 11.5 }}><b>{r.side_a_label}</b><br />{words(r.side_a)}</td>
                  <td style={{ ...td, fontSize: 11.5 }}><b>{r.side_b_label}</b><br />{words(r.side_b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
