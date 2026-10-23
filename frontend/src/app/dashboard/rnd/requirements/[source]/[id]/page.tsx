'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { RndRequirementDetail } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import RndNav from '@/components/rnd/RndNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import RequirementMovementTab from '@/components/crm/RequirementMovementTab'
import RequirementDiscussionTab from '@/components/crm/RequirementDiscussionTab'
import RequirementTasksTab from '@/components/rnd/RequirementTasksTab'
import RequirementDocumentsTab from '@/components/rnd/RequirementDocumentsTab'
import RequirementTechnicalOffersTab from '@/components/rnd/RequirementTechnicalOffersTab'
import RequirementAccessTab from '@/components/rnd/RequirementAccessTab'
import RequirementProjectsCard from '@/components/rnd/RequirementProjectsCard'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { rndRequestBadge } from '@/components/crm/RndRequestBlock'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

// Tasks and the departments the requirement is shared with live in one tab.
const TABS = ['Requirement', 'Tasks & Departments', 'Technical Offers', 'Documents', 'Discussion', 'Access'] as const
// Sub-tab → its R&D › Requirements feature (Organization › Role & Permissions).
const TAB_FEATURE: Partial<Record<typeof TABS[number], string>> = {
  'Tasks & Departments': 'tasks', 'Technical Offers': 'technical_offers', Documents: 'documents', Discussion: 'discussion', Access: 'access',
}
const TAB_PARAMS: Record<string, typeof TABS[number]> = { discussion: 'Discussion', tasks: 'Tasks & Departments', departments: 'Tasks & Departments', documents: 'Documents', 'technical-offers': 'Technical Offers', access: 'Access' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.heading, margin: '0 0 12px' }
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }

// Long free-text fields span the full row and keep their line breaks.
const WIDE_FIELDS = new Set(['Specification', 'Requirement Summary', 'Project Details'])

function Info({ label, value, wide }: { label: string; value: string | null | undefined; wide?: boolean }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <p style={labelStyle}>{label}</p>
      <p style={{ fontSize: 13, color: value ? TEXT.heading : TEXT.muted, margin: 0, whiteSpace: 'pre-wrap' }}>{value || 'Not provided'}</p>
    </div>
  )
}

const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }

// An explicit ?tab= deep link (e.g. from a notification) always wins over the auto-jump.
const hasTabParam = () => typeof window !== 'undefined' && !!TAB_PARAMS[new URLSearchParams(window.location.search).get('tab') || '']

export default function RndRequirementDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('rnd')
  const { canFeature } = useCan()
  // Role-level gates (R&D › Requirements features) on top of the per-requirement access.
  const see = (feature: string) => canFeature('rnd', 'requirements', feature, 'view')
  const router = useRouter()
  const params = useParams<{ source: string; id: string }>()
  const source = params.source === 'tender' ? 'tender' : 'inquiry'
  const { id: resolvedId, error: linkError } = useRecordId(params.id)
  const id = resolvedId ?? 0

  const [data, setData] = useState<RndRequirementDetail | null>(null)
  const [error, setError] = useState<string | string[]>('')
  // ?tab=discussion|tasks|documents|access (e.g. from a notification) opens that tab.
  const [tab, setTab] = useState<typeof TABS[number]>(() => (typeof window !== 'undefined' && TAB_PARAMS[new URLSearchParams(window.location.search).get('tab') || '']) || 'Requirement')

  const load = (openMovementIfMine = false) => {
    rndApi.getRequirement(source, id)
      .then((d) => {
        setData(d)
        // An open request for me (or the whole R&D team) → land straight on the answer form.
        const latest = d.movements[d.movements.length - 1]?.rnd_request
        if (openMovementIfMine && !hasTabParam() && latest?.status === 'open' && (latest.assigned_to_id == null ? d.my_access.respond : latest.assigned_to_id === user?.id)) setTab('Requirement')
      })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load this requirement.')))
  }

  useEffect(() => {
    if (!isAuthorized || !id) return
    load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, source, id])

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><RndNav /><InvalidRecordLink message={linkError} listHref="/dashboard/rnd/requirements" listLabel="Back to requirements" /></div>)

  const back = <button data-tour="rnd-reqd-back-btn" onClick={() => router.push('/dashboard/rnd/requirements')} type="button" style={secondaryBtnStyle}>← Back</button>

  if (error && !data) {
    return (
      <div>
        <RndNav />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 13, color: '#b91c1c', margin: 0, maxWidth: 640 }}>{Array.isArray(error) ? error.join(' ') : error}</p>
          {back}
        </div>
      </div>
    )
  }
  if (!data) return <div><RndNav /><p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p></div>

  const currentReq = data.movements[data.movements.length - 1]?.rnd_request ?? null
  const canRespond = data.my_access.respond && canFeature('rnd', 'requirements', 'crm_request', 'submit')
  // The answer form: the head / Respond-right holders for team requests, the named engineer for older assigned ones.
  const canAnswerCrm = canFeature('rnd', 'requirements', 'crm_request', 'submit') && (data.my_access.respond || (currentReq?.assigned_to_id != null && currentReq.assigned_to_id === user?.id))
  const visibleTabs = TABS.filter((t) => (t !== 'Access' || data.my_access.is_head) && (!TAB_FEATURE[t] || see(TAB_FEATURE[t] as string)))
  const shownTab = visibleTabs.includes(tab) ? tab : 'Requirement'
  const docAccess = {
    ...data.my_access,
    upload: data.my_access.upload && canFeature('rnd', 'requirements', 'documents', 'create'),
    download: data.my_access.download && canFeature('rnd', 'requirements', 'documents', 'export'),
  }
  const taskGates = {
    tasks: {
      create: canFeature('rnd', 'requirements', 'tasks', 'create'), edit: canFeature('rnd', 'requirements', 'tasks', 'edit'),
      approve: canFeature('rnd', 'requirements', 'tasks', 'approve'), cancel: canFeature('rnd', 'requirements', 'tasks', 'cancel'),
    },
    departments: see('departments'),
    share: canFeature('rnd', 'requirements', 'departments', 'create'),
  }

  return (
    <div>
      <RndNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div data-tour="rnd-reqd-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#FF7A45' }}>{data.offer_number}</span>
            <span style={{ fontSize: 11, color: '#d6d3d1' }}>·</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: TEXT.muted }}>{data.source === 'inquiry' ? 'Inquiry' : 'Tender'} {data.universal_id}</span>
            {data.priority && <><span style={{ fontSize: 11, color: '#d6d3d1' }}>·</span><span style={{ fontSize: 11, fontWeight: 600, color: TEXT.muted }}>{data.priority}</span></>}
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{data.title}</h1>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0 0' }}>
            {data.organization.name || 'Unknown customer'} · last sent {formatDateTime(data.last_sent_at)}
          </p>
        </div>
        {back}
      </div>

      {currentReq && (() => {
        const badge = rndRequestBadge(currentReq)
        const team = currentReq.assigned_to_id == null
        // Team requests: whoever has the Respond right (head, or granted in Access).
        const mine = team ? canRespond : currentReq.assigned_to_id === user?.id
        return (
          <div data-tour="rnd-req-assignment" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: `${badge.hex}12`, border: `1px solid ${badge.hex}40`, fontSize: 12.5, color: TEXT.heading }}>
            <span>
              {team ? <>Sent to the <strong>R&amp;D head</strong>{canRespond ? ' — you can respond' : ''}</> : mine ? <strong>Assigned to you</strong> : <>Assigned to <strong>{currentReq.assigned_to}</strong></>}
              {' · '}response due <strong>{formatDate(currentReq.due_date)}</strong>
              {currentReq.requested_by && <> · requested by {currentReq.requested_by}</>}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 9999, background: `${badge.hex}1a`, color: badge.hex }}>{badge.label}</span>
              {mine && currentReq.status === 'open' && shownTab !== 'Requirement' && see('crm_request') && (
                <button data-tour="rnd-reqd-respond-btn" type="button" onClick={() => setTab('Requirement')} style={{ ...secondaryBtnStyle, padding: '6px 14px' }}>Respond →</button>
              )}
            </span>
          </div>
        )
      })()}

      {data.edited_after_send && (
        <div data-tour="rnd-reqd-edited" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(234,88,12,0.08)', border: '1px solid rgba(234,88,12,0.25)', color: '#9a3412', fontSize: 12.5 }}>
          CRM has edited this requirement since it was last sent to R&amp;D. The Requirement tab shows the <strong>current</strong> CRM values;
          the Technical Offer Request card shows exactly what R&amp;D received (expand &ldquo;View requirement as sent&rdquo;). Ask the BD owner{data.bd_owner ? ` (${data.bd_owner})` : ''} to re-send if the changes affect the offer.
        </div>
      )}

      <div className="hide-scrollbar" style={{ display: 'flex', gap: 4, marginBottom: 16, padding: 4, borderRadius: 999, background: 'rgba(0,0,0,0.05)', overflowX: 'auto', width: 'fit-content', maxWidth: '100%' }}>
        {visibleTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-tour={`rnd-req-tab-${t}`}
            style={{
              padding: '9px 16px', border: 'none', borderRadius: 999, whiteSpace: 'nowrap',
              background: shownTab === t ? '#fff' : 'transparent', boxShadow: shownTab === t ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
              color: shownTab === t ? '#FF7A45' : '#78716c', fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {shownTab === 'Requirement' && (
        <>
          {see('projects') && <RequirementProjectsCard source={data.source} recordId={data.record_id} isHead={data.my_access.is_head} />}
          {/* CRM's request, what was sent, and the "Respond to CRM" form (the answer marks the request Responded for CRM). */}
          {see('crm_request') && data.movements.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <RequirementMovementTab
                module={data.source}
                recordId={data.record_id}
                movements={data.movements}
                responder={user ? { userId: user.id, isAdmin: user.role === 'admin', canRespond: canAnswerCrm } : undefined}
                onChanged={() => load()}
                latestOnly
              />
            </div>
          )}
          {/* Only the Technical Offer button: first click opens the Word template, then a menu (edit / download / send). */}
          {see('technical_offers') && (
            <div style={{ marginBottom: 16 }}>
              <RequirementTechnicalOffersTab source={data.source} recordId={data.record_id} access={data.my_access} embedded />
            </div>
          )}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
            {see('customer') && <div data-tour="rnd-reqd-customer" style={{ ...sectionStyle, flex: '1 1 320px' }}>
              <p style={sectionTitle}>Customer</p>
              <div style={grid}>
                <Info label="Organization" value={data.organization.name} />
                <Info label="Type" value={data.organization.type} />
                <Info label="City / State" value={[data.organization.city, data.organization.state].filter(Boolean).join(', ')} />
              </div>
              {data.contact && (
                <>
                  <p style={{ ...sectionTitle, margin: '16px 0 12px' }}>Contact Person</p>
                  <div style={grid}>
                    <Info label="Name" value={data.contact.name} />
                    <Info label="Designation" value={data.contact.designation} />
                    <Info label="Department" value={data.contact.department} />
                    <Info label="Mobile" value={data.contact.mobile} />
                    <Info label="Email" value={data.contact.email} />
                  </div>
                </>
              )}
            </div>}
            {see('crm_info') && <div data-tour="rnd-reqd-crm" style={{ ...sectionStyle, flex: '0 1 280px' }}>
              <p style={sectionTitle}>From CRM</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Info label="BD Owner" value={data.bd_owner} />
                <Info label="CRM Status" value={data.crm_status} />
                <Info label="Priority" value={data.priority} />
              </div>
            </div>}
          </div>
          {see('product_requirement') && <div data-tour="rnd-reqd-requirement" style={sectionStyle}>
            <p style={sectionTitle}>{data.source === 'inquiry' ? 'Product Requirement' : 'Tender Details'}</p>
            <div style={grid}>
              {data.requirement.map((f) => <Info key={f.label} label={f.label} value={f.value} wide={WIDE_FIELDS.has(f.label)} />)}
            </div>
          </div>}
        </>
      )}

      {shownTab === 'Tasks & Departments' && user && <RequirementTasksTab source={data.source} recordId={data.record_id} userId={user.id} access={data.my_access} gates={taskGates} />}
      {shownTab === 'Technical Offers' && <RequirementTechnicalOffersTab source={data.source} recordId={data.record_id} access={data.my_access} />}
      {shownTab === 'Documents' && <RequirementDocumentsTab source={data.source} recordId={data.record_id} access={docAccess} />}
      {shownTab === 'Discussion' && <RequirementDiscussionTab source={data.source} recordId={data.record_id} side="rnd" />}
      {shownTab === 'Access' && data.my_access.is_head && <RequirementAccessTab source={data.source} recordId={data.record_id} canEdit={canFeature('rnd', 'requirements', 'access', 'edit')} />}

    </div>
  )
}
