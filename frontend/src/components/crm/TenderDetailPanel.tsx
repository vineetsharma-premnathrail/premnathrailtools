'use client'

import Select from '@/components/shared/Select'
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { crmApi } from '@/lib/api'
import { recordVisit } from '@/lib/crmShortcuts'
import { Tender, Organization, OrgContact, CrmActivity, CrmDocument, CrmStageLogEntry, RndRequestAssignment } from '@/types'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ReasonSheet from '@/components/shared/ReasonSheet'
import CrmDocumentFolder, { DocumentSearch } from '@/components/crm/CrmDocumentFolder'
import TenderForm from '@/components/crm/TenderForm'
import { RichText } from '@/components/RichTextEditor'
import ActivityViewDialog from '@/components/crm/ActivityViewDialog'
import ActivityForm from '@/components/crm/ActivityForm'
import MomExportDialog from '@/components/crm/MomExportDialog'
import TechnicalOfferPickerDialog from '@/components/crm/TechnicalOfferPickerDialog'
import RequirementDiscussionTab from '@/components/crm/RequirementDiscussionTab'
import SalesOrderHandoff from '@/components/crm/SalesOrderHandoff'
import { TND_STAGES, TENDER_STATUSES, tenderStatusColor, FOLLOW_UP_STATUSES } from '@/components/crm/constants'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, RevisionSelector, SpecDetailRow, SpecRevision, StageProgress, smallDangerBtnStyle, smallSecondaryBtnStyle, AnchoredMenu } from '@/components/crm/ui'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { refOf } from '@/lib/recordRef'
import { formatDate, formatDateTime } from '@/lib/format'
import { segmentBtnStyle, RowCount, Pill, pillStyle, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'

// ?tab=discussion (from a @mention notification) opens the Discussion tab.
const tabFromUrl = (): 'Discussion' | 'Info' =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'discussion' ? 'Discussion' : 'Info'

const TABS = ['Info', 'Discussion', 'Documents', 'Dates', 'Follow Ups', 'Timeline'] as const

export default function TenderDetailPanel({ tenderId, onDeleted }: { tenderId: number; onDeleted?: () => void }) {
  const { user } = useAuth()
  const { can, canDelete, canFeature } = useCan()
  const router = useRouter()
  const searchParams = useSearchParams()
  const backParam = searchParams.get('back')
  const backHref = backParam && backParam.startsWith('/dashboard/') ? backParam : '/dashboard/crm/inquiries'

  const [tender, setTender] = useState<Tender | null>(null)
  const [org, setOrg] = useState<Organization | null>(null)
  const [contact, setContact] = useState<OrgContact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [tab, setTab] = useState<typeof TABS[number]>(tabFromUrl)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pendingStage, setPendingStage] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [revisions, setRevisions] = useState<SpecRevision[]>([])
  const [selectedRevId, setSelectedRevId] = useState<number | null>(null)
  const [sendingTOR, setSendingTOR] = useState(false)
  const [torError, setTorError] = useState<string | string[]>('')
  const [showTorPicker, setShowTorPicker] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await crmApi.getTender(tenderId)
      setTender(data)
      recordVisit({ kind: 'tender', id: data.id, ref: refOf(data), title: data.universal_id, sub: data.tender_name || data.current_stage })
      crmApi.getOrganization(data.org_id).then((o: Organization) => {
        setOrg(o)
        recordVisit({ kind: 'tender', id: data.id, ref: refOf(data), title: data.universal_id, sub: [o.name, data.tender_name].filter(Boolean).join(' · ') })
      }).catch(() => {})
      if (data.org_contact_id) {
        crmApi.listOrgContacts(data.org_id).then((contacts: OrgContact[]) => {
          setContact(contacts.find((c) => c.id === data.org_contact_id) || null)
        }).catch(() => {})
      } else {
        setContact(null)
      }
      crmApi.getTenderSpecRevisions(tenderId).then(setRevisions).catch(() => setRevisions([]))
    } catch (err) {
      setError(extractErrorMessages(err, 'Tender not found.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Deferred so the effect itself sets no state.
    if (tenderId) Promise.resolve().then(() => { setTab(tabFromUrl()); setEditing(false); load() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId])

  // No discussion until the Technical Requirement has been sent to R&D.
  useEffect(() => {
    if (tab === 'Discussion' && tender && !tender.technical_offer_sent_at) Promise.resolve().then(() => setTab('Info'))
  }, [tab, tender])

  // Creator-or-admin (backend rule) AND Inquiries & Tenders › Edit in the Permission Matrix.
  const canModify = !!tender && !!user && (user.role === 'admin' || tender.created_by_id === user.id) && can('crm', 'inquiries_tenders', 'edit')
  const canDeleteRecord = !!tender && canDelete('crm', 'inquiries_tenders', tender.created_by_id ?? null)
  // Tenders share the Inquiries & Tenders tab, so they share its features (core/features/crm.py).
  const seeTab = (t: typeof TABS[number]) => t === 'Info'
    || (t === 'Dates' && canFeature('crm', 'inquiries_tenders', 'tender_dates', 'view'))
    || (t === 'Discussion' && canFeature('crm', 'inquiries_tenders', 'discussion', 'view'))
    || (t === 'Documents' && canFeature('crm', 'inquiries_tenders', 'documents', 'view'))
    || (t === 'Follow Ups' && canFeature('crm', 'inquiries_tenders', 'followups', 'view'))
    || (t === 'Timeline' && canFeature('crm', 'inquiries_tenders', 'timeline', 'view'))
  const isAdmin = user?.role === 'admin'
  const movingBack = !!pendingStage && !!tender && TND_STAGES.indexOf(pendingStage) < TND_STAGES.indexOf(tender.current_stage)

  const patch = async (payload: Record<string, unknown>) => {
    if (!tender) return
    try {
      setTender(await crmApi.updateTender(tender.id, payload))
      crmApi.getTenderSpecRevisions(tender.id).then(setRevisions).catch(() => {})
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the change to this tender — reload the page and try again; if it keeps failing, check your connection.'))
    }
  }

  // Status is a quick lead-info toggle, not a requirement change — keep
  // updated_at as it was so it doesn't re-arm the "Send Technical Requirement"
  // button (that button only cares about the requirement details changing).
  const patchLeadInfo = async (payload: Record<string, unknown>) => {
    if (!tender) return
    try {
      const prevUpdatedAt = tender.updated_at
      const updated = await crmApi.updateTender(tender.id, payload)
      setTender({ ...updated, updated_at: prevUpdatedAt })
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the change to this tender — reload the page and try again; if it keeps failing, check your connection.'))
    }
  }

  const handleDelete = async () => {
    if (!tender) return
    try {
      await crmApi.deleteTender(tender.id)
      if (onDeleted) onDeleted()
      else router.push('/dashboard/crm/tenders')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete tender.'))
    }
  }

  const torActive = !!tender && (
    !tender.technical_offer_sent_at ||
    (!!tender.updated_at && new Date(tender.updated_at) > new Date(tender.technical_offer_sent_at))
  )

  const sendTechnicalOfferRequest = async (documentIds: number[], assignment: RndRequestAssignment) => {
    if (!tender || !torActive) return
    setSendingTOR(true)
    setTorError('')
    try {
      setTender(await crmApi.createTenderTechnicalOfferRequest(tender.id, documentIds, assignment))
      setShowTorPicker(false)
      setTab('Info')
    } catch (err) {
      setTorError(extractErrorMessages(err, 'Failed to send Technical Requirement to R&D.'))
    } finally {
      setSendingTOR(false)
    }
  }

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error && !tender) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!tender) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#FF7A45' }}>{tender.universal_id}</span>
            <Pill label={tender.status} hex={tenderStatusColor(tender.status).text} title={`Status: ${tender.status}`} />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f1108', margin: 0 }}>{tender.tender_name || org?.name || 'Tender'}</h1>
        </div>
        {editing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pill label="✎ Editing Tender" hex="#FF7A45" />
            <button onClick={() => setEditing(false)} type="button" style={secondaryBtnStyle}>Cancel</button>
          </div>
        )}
      </div>

      <MessageDialog open={!!torError} variant="error" title="Send Technical Requirement Failed" message={torError} onClose={() => setTorError('')} />
      <MessageDialog open={!!error} variant="error" title="Tender Action Failed" message={error} onClose={() => setError('')} />

      {editing && (
        <StageProgress stage={tender.current_stage} stages={TND_STAGES} canModify={canModify && canFeature('crm', 'inquiries_tenders', 'stage', 'edit')} allowBackward={isAdmin} onRequestChange={setPendingStage} tourId="tender-stage-progress" />
      )}
      {!editing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <StageProgress
            stage={tender.current_stage}
            stages={TND_STAGES}
            canModify={canModify && canFeature('crm', 'inquiries_tenders', 'stage', 'edit')}
            allowBackward={isAdmin}
            onRequestChange={setPendingStage}
            tourId="tender-stage-progress"
            style={{ marginBottom: 0, flex: '1 1 280px', minWidth: 240 }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button onClick={() => router.push(backHref)} type="button" data-tour="tender-back-btn" style={secondaryBtnStyle}>
                ← Back
              </button>
              {canFeature('crm', 'inquiries_tenders', 'send_tor', 'create') && <button
                onClick={() => setShowTorPicker(true)}
                disabled={!torActive || sendingTOR}
                data-tour="tender-tor-btn"
                title={!torActive ? `Already sent as ${tender.technical_offer_number} — edit the tender to send again.` : 'Emails R&D the Customer Organization, Project, and Product Requirement details as a PDF.'}
                style={{ ...secondaryBtnStyle, opacity: !torActive || sendingTOR ? 0.5 : 1, cursor: !torActive || sendingTOR ? 'not-allowed' : 'pointer' }}
              >
                {sendingTOR ? 'Sending…' : 'Send Technical Requirement to R&D'}
              </button>}
              <SalesOrderHandoff source="tender" record={tender} tourId="tender-create-so-btn" />
              {canModify && <button onClick={() => { setEditing(true); setTab('Info') }} data-tour="tender-edit-btn" style={secondaryBtnStyle}>Edit</button>}
              {canDeleteRecord && <button onClick={() => setShowDeleteConfirm(true)} data-tour="tender-delete-btn" style={dangerBtnStyle}>Delete</button>}
            </div>
            {tender.technical_offer_number && (
              <span style={{ fontSize: 11, color: '#78716c' }}>
                {torActive ? 'Previously sent as ' : 'Sent as '}<strong>{tender.technical_offer_number}</strong>
                {tender.technical_offer_sent_at && ` on ${formatDateTime(tender.technical_offer_sent_at)}`}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="hide-scrollbar" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 20, overflowX: 'auto', overflowY: 'visible' }}>
        {TABS.filter((t) => (t !== 'Discussion' || !!tender.technical_offer_sent_at) && seeTab(t)).map((t) => (
          <div key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => setTab(t)}
              data-tour={`tender-tab-${t}`}
              style={{ ...segmentBtnStyle(tab === t), transition: 'background .15s, color .15s' }}
            >
              {t}
              {t === 'Info' && tab === t && revisions.length > 0 && (
                <span title={`${revisions.length} revision(s) of the requirement`} style={{ ...pillStyle('#FF7A45'), fontSize: 10.5, padding: '1px 6px' }}>
                  {revisions.length}
                </span>
              )}
            </button>
            {t === 'Info' && tab === t && !editing && revisions.length > 0 && (
              <RevisionSelector revisions={revisions} selectedId={selectedRevId} onSelect={setSelectedRevId} tourId="tender-revision-selector" />
            )}
          </div>
        ))}
      </div>

      {(tab === 'Info' || !seeTab(tab)) && editing && (
        <TenderForm
          initial={tender}
          submitLabel="Save Changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (payload) => {
            await patch(payload)
            setEditing(false)
          }}
        />
      )}
      {(tab === 'Info' || !seeTab(tab)) && !editing && (
        <InfoTab tender={tender} org={org} contact={contact} revisions={revisions} selectedRevId={selectedRevId} canModify={canModify} onChangeLeadInfo={patchLeadInfo} />
      )}
      {tab === 'Dates' && seeTab('Dates') && <DatesTab tender={tender} />}
      {tab === 'Discussion' && seeTab('Discussion') && tender.technical_offer_sent_at && <RequirementDiscussionTab source="tender" recordId={tender.id} side="crm" />}
      {tab === 'Documents' && seeTab('Documents') && <DocumentsTab tender={tender} canModify={canModify && canFeature('crm', 'inquiries_tenders', 'documents', 'create')} isAdmin={isAdmin} />}
      {tab === 'Follow Ups' && seeTab('Follow Ups') && <ActivitiesTab tender={tender} org={org} />}
      {tab === 'Timeline' && seeTab('Timeline') && <TimelineTab tenderId={tender.id} />}

      <TechnicalOfferPickerDialog
        open={showTorPicker}
        relatedModule="tender"
        relatedId={tender.id}
        sending={sendingTOR}
        onSend={sendTechnicalOfferRequest}
        onCancel={() => setShowTorPicker(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this tender?"
        message={`Delete tender ${tender.universal_id}? This action cannot be undone.`}
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete() }}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Stages only move forward; going back is an admin correction and needs a reason. */}
      <ConfirmDialog
        open={!!pendingStage && !movingBack}
        title="Update Stage"
        danger={false}
        confirmLabel="Update Stage"
        message={pendingStage ? `Move this tender from "${tender.current_stage}" to "${pendingStage}"? Stages only move forward — once moved, it cannot be undone except by an admin.` : ''}
        onConfirm={() => { const s = pendingStage; setPendingStage(null); if (s) patch({ current_stage: s }) }}
        onCancel={() => setPendingStage(null)}
      />
      <ReasonSheet
        open={!!pendingStage && movingBack}
        title="Move Stage Back"
        message={pendingStage ? `Move this tender back from "${tender.current_stage}" to "${pendingStage}"? This reverses the pipeline — the reason is kept on the timeline.` : ''}
        placeholder="e.g. LOA cancelled by the railway — tender re-opened"
        label="Reason for moving the stage back"
        hint="Admin correction — the reason is kept on the tender's timeline."
        confirmLabel="Move Back"
        requireValue
        requiredMessage="Enter the reason for moving the stage back — it is required and is kept on the record."
        onConfirm={(reason) => { const s = pendingStage; setPendingStage(null); if (s) patch({ current_stage: s, stage_reason: reason.trim() }) }}
        onCancel={() => setPendingStage(null)}
      />
    </div>
  )
}

function InfoTab({ tender, org, contact, revisions, selectedRevId, canModify, onChangeLeadInfo }: { tender: Tender; org: Organization | null; contact: OrgContact | null; revisions: SpecRevision[]; selectedRevId: number | null; canModify: boolean; onChangeLeadInfo: (payload: Record<string, unknown>) => void }) {
  const selectedRev = revisions.find((r) => r.id === selectedRevId) || null
  const changeFor = (field: string) => selectedRev?.changes.find((c) => c.field === field)
  const { canFeature } = useCan()
  const seeCustomer = canFeature('crm', 'inquiries_tenders', 'customer_contact', 'view')
  const seePrices = canFeature('crm', 'inquiries_tenders', 'prices', 'view')

  const join = (...v: (string | null | undefined)[]) => v.filter(Boolean).join(', ') || null
  const dot = <span style={{ color: '#cbd5e1' }}>·</span>
  const hex = tenderStatusColor(tender.status).text

  // One card, same order as the tender form: summary, tender information, customer.
  // Stage is the stage bar above; the key dates have their own Dates tab.
  return (
    <div data-tour="tender-info-view">
      <DetailCard>
        <DetailSummary
          title={tender.tender_number ? `Tender No. ${tender.tender_number}` : 'Tender number not filled in yet'}
          text={<span data-tour="tnd-info-current-status">{tender.current_status_note || <span style={{ color: '#64748b' }}>No current status written yet — use Edit to add where this tender stands.</span>}</span>}
          meta={<>
            <span>Submission due: <strong style={{ color: '#0f172a' }}>{tender.submission_date ? formatDate(tender.submission_date) : '—'}</strong></span>
            {tender.priority && <>{dot}<span>Priority: <strong style={{ color: '#0f172a' }}>{tender.priority}</strong></span></>}
            {dot}<span>BD Owner: <strong style={{ color: '#0f172a' }}>{tender.bd_owner || '—'}</strong></span>
            {tender.created_at && <>{dot}<span>Created {formatDate(tender.created_at)}{tender.created_by_name ? ` by ${tender.created_by_name}` : ''}</span></>}
          </>}
        />

        <DetailGroup title="Tender Information" last={!seeCustomer}>
          <DetailRow label="Status">
            {canModify ? (
              <div style={{ maxWidth: 320 }}>
                <Select data-tour="tnd-info-status" value={tender.status} onChange={(e) => onChangeLeadInfo({ status: e.target.value })} style={{ ...inputStyle, width: '100%' }}>
                  {TENDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
            ) : <Pill label={tender.status} hex={hex} />}
          </DetailRow>
          <SpecDetailRow label="Tender details" value={tender.tender_details} change={changeFor('tender_details')} />
          <SpecDetailRow label="Tender authority" value={tender.tender_authority} change={changeFor('tender_authority')} />
          <SpecDetailRow label="Tender portal" value={tender.tender_portal} change={changeFor('tender_portal')} />
          <SpecDetailRow label="Tender type" value={tender.tender_type} change={changeFor('tender_type')} />
          {seePrices && <SpecDetailRow label="Tender value" value={tender.tender_value != null ? `${tender.currency} ${tender.tender_value.toLocaleString('en-IN')}` : null} change={changeFor('tender_value') || changeFor('currency')} />}
          <DetailRow label="Lead source">{tender.lead_source}</DetailRow>
          {changeFor('tender_number') && <SpecDetailRow label="Tender number" value={tender.tender_number} change={changeFor('tender_number')} />}
        </DetailGroup>

        {seeCustomer && (
          <DetailGroup title="Customer" last>
            <DetailRow label="Customer organization">{org?.name}</DetailRow>
            <SpecDetailRow label="Railway zone" value={tender.railway_zone} change={changeFor('railway_zone')} />
            <SpecDetailRow label="Division" value={tender.division} change={changeFor('division')} />
            <DetailRow label="Contact person">{contact ? join(contact.name, contact.designation, contact.department) : null}</DetailRow>
            <DetailRow label="Mobile">{contact ? join(contact.mobile, ...(contact.additional_mobiles || [])) : null}</DetailRow>
            <DetailRow label="Email">{contact ? join(contact.email, ...(contact.additional_emails || [])) : null}</DetailRow>
          </DetailGroup>
        )}
      </DetailCard>
    </div>
  )
}

function DatesTab({ tender }: { tender: Tender }) {
  const day = (v?: string | null) => (v ? formatDate(v) : '—')
  const rows: [string, string][] = [
    ['Publish Date', day(tender.publish_date)],
    ['Document Download', day(tender.doc_download_date)],
    ['Submission Date', day(tender.submission_date)],
    // Wall-clock date and time as printed on the tender.
    ['Tender Closing', tender.closing_at ? `${formatDate(tender.closing_at.slice(0, 10))} ${tender.closing_at.slice(11, 16)}` : '—'],
  ]
  return (
    <div data-tour="tender-dates-table" style={{ borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden' }}>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#fffaf5', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e' }}>Milestone <RowCount count={rows.length} /></th>
            <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#a8a29e' }}>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <td style={{ padding: '10px 16px', color: '#57534e' }}>{label}</td>
              <td style={{ padding: '10px 16px', fontWeight: 600, color: '#1f1108', whiteSpace: 'nowrap' }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DocumentsTab({ tender, canModify }: { tender: Tender; canModify: boolean; isAdmin: boolean }) {
  const [documents, setDocuments] = useState<CrmDocument[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [loadError, setLoadError] = useState<string | string[]>('')
  const [docSearch, setDocSearch] = useState('')

  const load = () => crmApi.listDocuments({ related_module: 'tender', related_id: tender.id })
    .then(setDocuments)
    .catch((err) => setLoadError(extractErrorMessages(err, 'Could not load the documents of this tender. Reload the page; if it persists, check that you still have CRM access.')))
  useEffect(() => { load() }, [tender.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const clientDocs = documents.filter((d) => d.folder_type === 'client')
  // Sent TOR PDFs are filed as internal; R&D's reply files are listed with them.
  const internalDocs = documents.filter((d) => d.folder_type === 'internal' || d.doc_category === 'rnd_response')

  const related = { module: 'tender' as const, id: tender.id, universalId: tender.universal_id, orgId: tender.org_id }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 }}>
      <MessageDialog open={!!error} variant="error" title="Document Error" message={error} onClose={() => setError('')} />
      <MessageDialog open={!!loadError} variant="error" title="Cannot Load Documents" message={loadError} onClose={() => setLoadError('')} />
      <DocumentSearch value={docSearch} onChange={setDocSearch} />
      <CrmDocumentFolder tourId="tender-docs-client" title="Client Documents" folderType="client" docs={clientDocs} related={related} canModify={canModify} onUploaded={load} setError={setError} query={docSearch} />
      <CrmDocumentFolder tourId="tender-docs-internal" title="Internal Documents" folderType="internal" docs={internalDocs} related={related} canModify={canModify} onUploaded={load} setError={setError} query={docSearch} />
    </div>
  )
}

function ActivitiesTab({ tender, org }: { tender: Tender; org: Organization | null }) {
  const { user } = useAuth()
  const { canFeature } = useCan()
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingActivity, setEditingActivity] = useState<CrmActivity | null>(null)
  const [viewingActivity, setViewingActivity] = useState<CrmActivity | null>(null)
  const [deletingActivity, setDeletingActivity] = useState<CrmActivity | null>(null)
  const [exportingMomId, setExportingMomId] = useState<number | null>(null)
  const [momError, setMomError] = useState<string | string[]>('')
  const [loadError, setLoadError] = useState<string | string[]>('')
  const [showMomExport, setShowMomExport] = useState(false)

  const load = () => crmApi.listActivities({ related_module: 'tender', related_id: tender.id })
    .then(setActivities)
    .catch((err) => setLoadError(extractErrorMessages(err, 'Could not load the follow-ups of this tender. Reload the page; if it persists, check that you still have CRM access.')))
  useEffect(() => { load() }, [tender.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const exportMom = async (a: CrmActivity) => {
    setExportingMomId(a.id)
    setMomError('')
    try {
      const blob = await crmApi.exportActivityMom(a.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const orgSlug = (org?.name || 'Activity').replace(/\s+/g, '_').replace(/\//g, '-')
      const dateSlug = (a.created_at || '').slice(0, 10).replace(/-/g, '') || 'undated'
      link.download = `MOM_${orgSlug}_${dateSlug}.docx`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setMomError(extractErrorMessages(err, 'MoM export failed.'))
    } finally {
      setExportingMomId(null)
    }
  }

  const startEdit = (a: CrmActivity) => {
    setEditingActivity(a)
    setShowForm(true)
  }

  const cancelForm = () => {
    setEditingActivity(null)
    setShowForm(false)
  }

  const canEditActivity = (a: CrmActivity) => canFeature('crm', 'inquiries_tenders', 'followups', 'edit') && !!user && (user.role === 'admin' || a.created_by_id === user.id)
  const changeStatus = (a: CrmActivity, status: string) => crmApi.updateActivity(a.id, { status }).then(load)

  const handleDelete = async () => {
    if (!deletingActivity) return
    await crmApi.deleteActivity(deletingActivity.id)
    setDeletingActivity(null)
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {canFeature('crm', 'inquiries_tenders', 'followups', 'create') && <button onClick={() => { setEditingActivity(null); setShowForm(true) }} data-tour="activity-add-btn" style={primaryBtnStyle}>+ Add Follow Up</button>}
        {canFeature('crm', 'inquiries_tenders', 'followups', 'print') && <button onClick={() => setShowMomExport(true)} data-tour="activity-export-meeting-mom-btn" style={secondaryBtnStyle}>Export Meeting MOM</button>}
      </div>
      <MessageDialog open={!!momError} variant="error" title="Cannot Export MoM" message={momError} onClose={() => setMomError('')} />
      <MessageDialog open={!!loadError} variant="error" title="Cannot Load Follow Ups" message={loadError} onClose={() => setLoadError('')} />
      <MomExportDialog
        open={showMomExport}
        onClose={() => setShowMomExport(false)}
        orgId={tender.org_id}
        orgName={org?.name}
        activities={activities}
        onExportDocx={(payload) => crmApi.exportTenderMom(tender.id, payload)}
        onExportPdf={(payload) => crmApi.exportTenderMomPdf(tender.id, payload)}
      />
      {showForm && (
        <ActivityForm
          initial={editingActivity || { org_id: tender.org_id, related_module: 'tender', related_id: tender.id, universal_id: tender.universal_id }}
          submitLabel={editingActivity ? 'Save Changes' : 'Add Follow Up'}
          onCancel={cancelForm}
          onSubmit={async (payload, photos) => {
            const saved = editingActivity
              ? await crmApi.updateActivity(editingActivity.id, payload)
              : await crmApi.createActivity(payload)
            if (photos.length) await crmApi.uploadActivityAttachments(saved.id, photos)
            cancelForm()
            load()
          }}
        />
      )}
      {activities.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No follow-ups logged.</p>
      ) : (
        activities.map((a, idx) => (
          <div key={a.id} data-tour={idx === 0 ? 'tender-followups-list' : undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: '#1f1108', margin: '0 0 2px' }}>
                {a.activity_type || 'Follow Up'}
                {a.assigned_to && <span title={`Contact Person: ${a.assigned_to}`} style={{ fontWeight: 500, color: '#78716c' }}> · {a.assigned_to}</span>}
                {a.created_at && <span title={`Created: ${new Date(a.created_at).toLocaleString('en-GB')}`} style={{ fontWeight: 500, color: '#a8a29e' }}> · {new Date(a.created_at).toLocaleString('en-GB')}</span>}
              </p>
              {(a.contact_details || []).length > 0 && (
                <p style={{ fontSize: 11, color: '#78716c', margin: '0 0 4px' }}>
                  {a.contact_details!.map((c, i) => (
                    <span key={i}>
                      {i > 0 && ' · '}
                      {c.name}{c.designation && ` (${c.designation})`}{c.mobile && ` · ${c.mobile}`}{c.email && ` · ${c.email}`}
                    </span>
                  ))}
                </p>
              )}
              {a.remarks ? <RichText html={a.remarks} style={{ fontSize: 12, color: '#57534e' }} /> : <p style={{ fontSize: 12, color: '#57534e', margin: 0 }}>—</p>}
              <p style={{ fontSize: 11.5, color: '#a8a29e', margin: '2px 0 0' }}>Due: {a.next_followup || 'To Be Decided'}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button onClick={() => setViewingActivity(a)} data-tour={idx === 0 ? 'activity-row-view-btn' : undefined} style={{ ...smallSecondaryBtnStyle }}>View</button>
              {canEditActivity(a) && <button onClick={() => startEdit(a)} data-tour={idx === 0 ? 'activity-row-edit-btn' : undefined} style={{ ...smallSecondaryBtnStyle }}>Edit</button>}
              {canEditActivity(a) && <ChangeStatusButton currentStatus={a.status || FOLLOW_UP_STATUSES[0]} statuses={FOLLOW_UP_STATUSES} onSelect={(s) => changeStatus(a, s)} tourId={idx === 0 ? 'tender-followup-change-status-btn' : undefined} />}
              {canFeature('crm', 'inquiries_tenders', 'followups', 'print') && <button disabled={exportingMomId === a.id} onClick={() => exportMom(a)} data-tour={idx === 0 ? 'activity-row-export-mom-btn' : undefined} style={{ ...smallSecondaryBtnStyle, opacity: exportingMomId === a.id ? 0.7 : 1 }}>
                {exportingMomId === a.id ? 'Exporting…' : 'Export MoM'}
              </button>}
              {canFeature('crm', 'inquiries_tenders', 'followups', 'delete') && !!user && (user.role === 'admin' || a.created_by_id == null || a.created_by_id === user.id) && (
                <button onClick={() => setDeletingActivity(a)} data-tour={idx === 0 ? 'activity-row-delete-btn' : undefined} style={{ ...smallDangerBtnStyle }}>Delete</button>
              )}
            </div>
          </div>
        ))
      )}

      <ActivityViewDialog activity={viewingActivity} onClose={() => setViewingActivity(null)} />

      <ConfirmDialog
        open={!!deletingActivity}
        title="Delete this follow-up?"
        message="Delete this follow-up entry? This action cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setDeletingActivity(null)}
      />
    </div>
  )
}

function ChangeStatusButton({ currentStatus, statuses, onSelect, tourId }: { currentStatus: string; statuses: string[]; onSelect: (s: string) => void; tourId?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current && !ref.current.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={ref} data-tour={tourId} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...smallSecondaryBtnStyle }}>Change Status</button>
      <AnchoredMenu anchorRef={ref} menuRef={menuRef} open={open}>
          {statuses.map((s) => {
            const active = s === currentStatus
            return (
              <div
                key={s}
                onClick={active ? undefined : () => { onSelect(s); setOpen(false) }}
                style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? '#FF7A45' : '#1f1108', cursor: active ? 'default' : 'pointer', background: active ? 'rgba(255,122,69,0.1)' : 'transparent' }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'rgba(255,122,69,0.1)' : 'transparent' }}
              >
                {s}
              </div>
            )
          })}
      </AnchoredMenu>
    </div>
  )
}

type TenderTimelineEntry = {
  key: string
  kind: 'created' | 'updated' | 'deleted' | 'stage' | 'followup' | 'info' | 'email' | 'email_failed'
  title: string
  detail?: string
  by?: string
  date: string | null
}

const TENDER_TIMELINE_KIND_STYLE: Record<TenderTimelineEntry['kind'], { bg: string; text: string; label: string }> = {
  created: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a', label: 'Created' },
  updated: { bg: 'rgba(37,99,235,0.1)', text: '#1d4ed8', label: 'Updated' },
  deleted: { bg: 'rgba(220,38,38,0.1)', text: '#b91c1c', label: 'Deleted' },
  stage: { bg: 'rgba(139,92,246,0.12)', text: '#7c3aed', label: 'Stage' },
  followup: { bg: 'rgba(249,115,22,0.12)', text: '#c2410c', label: 'Follow Up' },
  info: { bg: 'rgba(99,102,241,0.12)', text: '#4338ca', label: 'Info Update' },
  email: { bg: 'rgba(13,148,136,0.12)', text: '#0f766e', label: 'Email Sent' },
  email_failed: { bg: 'rgba(220,38,38,0.1)', text: '#b91c1c', label: 'Email Failed' },
}

function auditActionKind(action: string): TenderTimelineEntry['kind'] {
  if (action === 'created') return 'created'
  if (action === 'deleted') return 'deleted'
  if (action.endsWith('_sent')) return 'email'
  if (action.endsWith('_failed')) return 'email_failed'
  return 'updated'
}

const TENDER_AUDIT_FIELD_LABELS: Record<string, string> = {
  tender_number: 'Tender No.', tender_name: 'Tender Name', tender_authority: 'Tender Authority',
  tender_portal: 'Portal', tender_type: 'Type', tender_category: 'Category', tender_value: 'Value',
  currency: 'Currency', status: 'Status', current_stage: 'Stage', current_status_note: 'Current Status', tender_details: 'Tender Details', railway_zone: 'Railway Zone',
  division: 'Division', workshop: 'Workshop', org_id: 'Customer Organization', org_contact_id: 'Contact',
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Renders a spec revision's field-level changes as "old → new" lines for the Timeline detail.
 * When only one field changed, its label is already the entry's title, so it's dropped here
 * to avoid repeating it twice; with multiple fields each line is prefixed with its label.
 */
function specRevisionDetailHtml(changes: { field: string; old: unknown; new: unknown }[]): string {
  const single = changes.length === 1
  return changes.map((c) => {
    const label = TENDER_AUDIT_FIELD_LABELS[c.field] || c.field
    const oldText = c.old == null || String(c.old).trim() === '' ? '(empty)' : String(c.old)
    const newText = c.new == null || String(c.new).trim() === '' ? '(empty)' : String(c.new)
    const prefix = single ? '' : `<strong>${escapeHtml(label)}:</strong> `
    return `<div>${prefix}<span style="color:#b91c1c;text-decoration:line-through;">${escapeHtml(oldText)}</span> → <span style="color:#166534;font-weight:600;">${escapeHtml(newText)}</span></div>`
  }).join('')
}

/**
 * Audit summaries were historically stored as free text, e.g. "Name updated: field1, field2."
 * The name is shown separately in the meta line, and the "Updated" badge already says what
 * happened — so this cleans the title down to just the field list, with field names labeled.
 */
function cleanAuditTitle(summary: string | null, actor: string | null | undefined): string | null {
  if (!summary) return summary
  let s = summary
  if (actor && s.startsWith(actor)) s = s.slice(actor.length).replace(/^\s+/, '')
  s = s.replace(/^updated:\s*/i, '').replace(/\.\s*$/, '')
  s = s.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi, (token) => TENDER_AUDIT_FIELD_LABELS[token.toLowerCase()] || token)
  if (!s) return summary
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function TimelineTab({ tenderId }: { tenderId: number }) {
  const [entries, setEntries] = useState<TenderTimelineEntry[] | null>(null)
  const seeFollowupsTl = useCan().canFeature('crm', 'inquiries_tenders', 'followups', 'view')

  useEffect(() => {
    Promise.all([
      crmApi.getTenderAudit(tenderId),
      crmApi.listTenderStages(tenderId),
      seeFollowupsTl ? crmApi.listActivities({ related_module: 'tender', related_id: tenderId }) : Promise.resolve([]),
      crmApi.getTenderSpecRevisions(tenderId),
    ]).then(([audit, stages, activities, specRevisions]) => {
      const merged: TenderTimelineEntry[] = [
        // Generic "updated" audit rows carry no diff detail — every real edit now produces
        // a proper Info Update entry (below) instead, so a bare "Updated: field" row with
        // nothing else to show is just noise. Only created/deleted are worth keeping here.
        ...audit
          .filter((a: { action: string }) => a.action !== 'updated')
          .map((a: { id: number; action: string; summary: string | null; performed_by: string; performed_at: string | null }) => ({
            key: `audit-${a.id}`,
            kind: auditActionKind(a.action),
            title: cleanAuditTitle(a.summary, a.performed_by) || `Tender ${a.action}`,
            by: a.performed_by,
            date: a.performed_at,
          })),
        ...specRevisions.map((r: SpecRevision) => ({
          key: `spec-${r.id}`,
          kind: 'info' as const,
          title: r.changes.map((c) => TENDER_AUDIT_FIELD_LABELS[c.field] || c.field).join(', '),
          detail: specRevisionDetailHtml(r.changes),
          by: r.performed_by,
          date: r.performed_at,
        })),
        ...stages.map((s: CrmStageLogEntry) => ({
          key: `stage-${s.id}`,
          kind: 'stage' as const,
          title: `Moved to stage: ${s.stage}`,
          detail: s.notes,
          by: s.entered_by_name,
          date: s.created_at || null,
        })),
        ...activities.map((a: CrmActivity) => ({
          key: `followup-${a.id}`,
          kind: 'followup' as const,
          title: a.subject || a.contact_names?.join(', ') || a.activity_type || 'Follow Up',
          detail: a.remarks,
          by: a.created_by_name,
          date: a.activity_date || a.created_at || null,
        })),
      ]
      merged.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      setEntries(merged)
    })
  }, [tenderId, seeFollowupsTl])

  if (entries === null) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (entries.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No timeline history yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e, idx) => (
        <div key={e.key} data-tour={idx === 0 ? 'tender-timeline-list' : undefined} style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: TENDER_TIMELINE_KIND_STYLE[e.kind].bg, color: TENDER_TIMELINE_KIND_STYLE[e.kind].text }}>
                {TENDER_TIMELINE_KIND_STYLE[e.kind].label}
              </span>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: 0 }}>{e.title}</p>
            </div>
            <p style={{ fontSize: 11.5, color: '#a8a29e', margin: 0, whiteSpace: 'nowrap', flexShrink: 0 }}>{e.by || 'System'} · {formatDateTime(e.date)}</p>
          </div>
          {e.detail && <RichText html={e.detail} style={{ fontSize: 12, color: '#57534e', margin: '2px 0' }} />}
        </div>
      ))}
    </div>
  )
}
