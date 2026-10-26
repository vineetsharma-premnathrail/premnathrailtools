'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { RndRequirementDetail } from '@/types'
import { TEXT } from '@/lib/theme'
import RndNav from '@/components/rnd/RndNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { useRecordId } from '@/lib/recordRef'
import RndRequestBlock from '@/components/crm/RndRequestBlock'
import RequirementDiscussionTab from '@/components/crm/RequirementDiscussionTab'
import RequirementTasksTab from '@/components/rnd/RequirementTasksTab'
import RequirementDocumentsTab from '@/components/rnd/RequirementDocumentsTab'
import RequirementTechnicalOffersTab from '@/components/rnd/RequirementTechnicalOffersTab'
import RequirementAccessTab from '@/components/rnd/RequirementAccessTab'
import { secondaryBtnStyle, primaryBtnStyle, pillStyle, DetailCard, DetailGroup, DetailRow } from '@/components/shared/ui'
import { SheetIcon } from '@/components/shared/FormSheet'
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
        // Days to the due date (negative = overdue), for the "due in / overdue" note.
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const daysLeft = Math.round((new Date(currentReq.due_date + 'T00:00:00').getTime() - today.getTime()) / 86400000)
        const open = currentReq.status === 'open'
        const title = !open
          ? 'Response sent to CRM'
          : mine ? 'CRM is waiting for your response'
          : team ? 'Waiting for the R&D head to respond'
          : `Waiting for ${currentReq.assigned_to || 'the assigned engineer'} to respond`
        const dueNote = !open ? null
          : daysLeft < 0 ? `${-daysLeft} day${daysLeft === -1 ? '' : 's'} overdue`
          : daysLeft === 0 ? 'due today'
          : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
        return (
          <div data-tour="rnd-req-assignment" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
            padding: '12px 16px', marginBottom: 16, borderRadius: 12, background: '#fff',
            border: '1px solid rgba(15,23,42,0.08)', borderLeft: `4px solid ${badge.hex}`, boxShadow: '0 2px 8px rgba(15,23,42,0.05)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${badge.hex}14`, color: badge.hex }}>
                <SheetIcon name={open ? 'send' : 'check'} size={18} />
              </span>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: TEXT.heading }}>{title}</p>
                <p style={{ margin: '2px 0 0', fontSize: 12.5, color: TEXT.muted }}>
                  {currentReq.requested_by ? <>Requested by <strong style={{ color: TEXT.body }}>{currentReq.requested_by}</strong> · </> : null}
                  Due <strong style={{ color: TEXT.body }}>{formatDate(currentReq.due_date)}</strong>
                  {dueNote && <span style={{ color: daysLeft < 0 ? '#DC2626' : daysLeft <= 1 ? '#D97706' : TEXT.muted, fontWeight: daysLeft <= 1 ? 600 : 400 }}> ({dueNote})</span>}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={pillStyle(badge.hex)}>{badge.label}</span>
              {mine && open && see('crm_request') && (
                <RndRequestBlock
                  request={currentReq}
                  canRespond={canAnswerCrm}
                  onOpenDoc={() => {}}
                  onResponded={() => load()}
                  buttonOnly
                  renderButton={(openForm) => (
                    <button data-tour="rnd-reqd-respond-btn" type="button" onClick={openForm} style={primaryBtnStyle}>
                      <SheetIcon name="send" size={15} />Respond to CRM
                    </button>
                  )}
                />
              )}
            </div>
          </div>
        )
      })()}

      {data.edited_after_send && (
        <div data-tour="rnd-reqd-edited" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(234,88,12,0.08)', border: '1px solid rgba(234,88,12,0.25)', color: '#9a3412', fontSize: 12.5 }}>
          CRM has edited this requirement since it was last sent to R&amp;D. The Requirement tab shows the <strong>current</strong> CRM values.
          Ask the BD owner{data.bd_owner ? ` (${data.bd_owner})` : ''} to re-send if the changes affect the offer.
        </div>
      )}

      <div className="hide-scrollbar" style={{ display: 'flex', gap: 4, marginBottom: 16, padding: 4, borderRadius: 999, background: 'rgba(0,0,0,0.05)', overflowX: 'auto', width: 'fit-content', maxWidth: '100%' }}>
        {visibleTabs.map((t) => (
          // ui-audit-ignore-next-line custom-button — page tab bar (navigation between tabs, not an action button)
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

      {shownTab === 'Requirement' && (see('customer') || see('crm_info') || see('product_requirement')) && (
        // One card, every detail as label–value rows (same layout as R&D › Project › Overview).
        <DetailCard>
          {see('product_requirement') && <div data-tour="rnd-reqd-requirement">
            <DetailGroup title={data.source === 'inquiry' ? 'Product Requirement' : 'Tender Details'}>
              {data.requirement.length === 0
                ? <DetailRow label="Details">{null}</DetailRow>
                : data.requirement.map((f) => <DetailRow key={f.label} label={f.label}>{f.value}</DetailRow>)}
            </DetailGroup>
          </div>}
          {see('customer') && <div data-tour="rnd-reqd-customer">
            <DetailGroup title="Customer" last={!data.contact && !see('crm_info')}>
              <DetailRow label="Organization">{data.organization.name}</DetailRow>
              <DetailRow label="Type">{data.organization.type}</DetailRow>
              <DetailRow label="City / State">{[data.organization.city, data.organization.state].filter(Boolean).join(', ')}</DetailRow>
            </DetailGroup>
            {data.contact && (
              <DetailGroup title="Contact Person" last={!see('crm_info')}>
                <DetailRow label="Name">{data.contact.name}</DetailRow>
                <DetailRow label="Designation">{data.contact.designation}</DetailRow>
                <DetailRow label="Department">{data.contact.department}</DetailRow>
                <DetailRow label="Mobile">{data.contact.mobile}</DetailRow>
                <DetailRow label="Email">{data.contact.email}</DetailRow>
              </DetailGroup>
            )}
          </div>}
          {see('crm_info') && <div data-tour="rnd-reqd-crm">
            <DetailGroup title="From CRM" last>
              <DetailRow label="BD Owner">{data.bd_owner}</DetailRow>
              <DetailRow label="CRM Status">{data.crm_status}</DetailRow>
              <DetailRow label="Priority">{data.priority}</DetailRow>
              <DetailRow label="Last sent to R&D">{data.last_sent_at ? formatDateTime(data.last_sent_at) : null}</DetailRow>
            </DetailGroup>
          </div>}
        </DetailCard>
      )}

      {shownTab === 'Tasks & Departments' && user && <RequirementTasksTab source={data.source} recordId={data.record_id} userId={user.id} access={data.my_access} gates={taskGates} />}
      {shownTab === 'Technical Offers' && <RequirementTechnicalOffersTab source={data.source} recordId={data.record_id} access={data.my_access} />}
      {shownTab === 'Documents' && <RequirementDocumentsTab source={data.source} recordId={data.record_id} access={docAccess} />}
      {shownTab === 'Discussion' && <RequirementDiscussionTab source={data.source} recordId={data.record_id} side="rnd" />}
      {shownTab === 'Access' && data.my_access.is_head && <RequirementAccessTab source={data.source} recordId={data.record_id} canEdit={canFeature('rnd', 'requirements', 'access', 'edit')} />}

    </div>
  )
}
