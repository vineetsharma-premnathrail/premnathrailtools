'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { crmApi } from '@/lib/api'
import { recordVisit } from '@/lib/crmShortcuts'
import { formatDate, formatDateTime } from '@/lib/format'
import { Inquiry, Organization, OrgContact, QuotationItem, QuotationLineItem, CrmActivity, CrmDocument, CrmStageLogEntry, RndRequestAssignment, CrmTechnicalOfferOption } from '@/types'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import CrmDocumentFolder, { DocumentSearch } from '@/components/crm/CrmDocumentFolder'
import DateField from '@/components/erp/DateField'
import InquiryForm from '@/components/crm/InquiryForm'
import ActivityForm from '@/components/crm/ActivityForm'
import { RichText } from '@/components/RichTextEditor'
import ActivityViewDialog from '@/components/crm/ActivityViewDialog'
import MomExportDialog from '@/components/crm/MomExportDialog'
import TechnicalOfferPickerDialog from '@/components/crm/TechnicalOfferPickerDialog'
import RequirementDiscussionTab from '@/components/crm/RequirementDiscussionTab'
import SalesOrderHandoff from '@/components/crm/SalesOrderHandoff'
import ManagedDocumentPanel from '@/components/shared/ManagedDocumentPanel'
import QuotationStatusBar from '@/components/crm/QuotationStatusBar'
import LostReasonDialog, { LOST_STAGE, LOST_STATUS } from '@/components/crm/LostReasonDialog'
import { INQ_STAGES, inquiryStatusOptions, priorityOptions, priorityLabel, QUOTE_CONDITIONS, FOLLOW_UP_STATUSES } from '@/components/crm/constants'
import { Card, InfoRow, inputStyle, primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, ActivityPhotos, RevisionSelector, SpecInfoRow, SpecRevision, ComboBox, handleEnterAsTab, StageProgress } from '@/components/crm/ui'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { refOf } from '@/lib/recordRef'

// ?tab=discussion (from a @mention notification) opens the Discussion tab;
// ?tab=quotations (quotation approval link) opens the Quotations tab.
const tabFromUrl = (): 'Discussion' | 'Info' | 'Quotations' => {
  const t = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null
  return t === 'discussion' ? 'Discussion' : t === 'quotations' ? 'Quotations' : 'Info'
}

const TABS = ['Info', 'Discussion', 'Documents', 'Quotations', 'Follow Ups', 'Timeline'] as const

export default function InquiryDetailPanel({ inquiryId, onDeleted }: { inquiryId: number; onDeleted?: () => void }) {
  const { user } = useAuth()
  const { can, canDelete, canFeature } = useCan()
  // Inquiry › Quotations is its own feature (Organization › Roles › CRM › Inquiries & Tenders › features).
  const seeQuotations = canFeature('crm', 'inquiries_tenders', 'quotations', 'view')
  // The other sub-tabs / actions are features too (core/features/crm.py).
  const seeTab = (t: typeof TABS[number]) => t === 'Info'
    || (t === 'Quotations' && seeQuotations)
    || (t === 'Discussion' && canFeature('crm', 'inquiries_tenders', 'discussion', 'view'))
    || (t === 'Documents' && canFeature('crm', 'inquiries_tenders', 'documents', 'view'))
    || (t === 'Follow Ups' && canFeature('crm', 'inquiries_tenders', 'followups', 'view'))
    || (t === 'Timeline' && canFeature('crm', 'inquiries_tenders', 'timeline', 'view'))
  const canSendTor = canFeature('crm', 'inquiries_tenders', 'send_tor', 'create')
  const canMoveStage = canFeature('crm', 'inquiries_tenders', 'stage', 'edit')
  const router = useRouter()
  const searchParams = useSearchParams()
  const backParam = searchParams.get('back')
  const backHref = backParam && backParam.startsWith('/dashboard/') ? backParam : '/dashboard/crm/inquiries'

  const [inquiry, setInquiry] = useState<Inquiry | null>(null)
  const [org, setOrg] = useState<Organization | null>(null)
  const [contact, setContact] = useState<OrgContact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [tab, setTab] = useState<typeof TABS[number]>(tabFromUrl)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pendingStage, setPendingStage] = useState<string | null>(null)
  const [lostStatusPending, setLostStatusPending] = useState(false)
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
      const data = await crmApi.getInquiry(inquiryId)
      setInquiry(data)
      recordVisit({ kind: 'inquiry', id: data.id, ref: refOf(data), title: data.universal_id, sub: data.product || data.current_stage })
      crmApi.getOrganization(data.org_id).then((o: Organization) => {
        setOrg(o)
        recordVisit({ kind: 'inquiry', id: data.id, ref: refOf(data), title: data.universal_id, sub: [o.name, data.product].filter(Boolean).join(' · ') })
      }).catch(() => {})
      if (data.org_contact_id) {
        crmApi.listOrgContacts(data.org_id).then((contacts: OrgContact[]) => {
          setContact(contacts.find((c) => c.id === data.org_contact_id) || null)
        }).catch(() => {})
      } else {
        setContact(null)
      }
      crmApi.getInquirySpecRevisions(inquiryId, true).then(setRevisions).catch(() => setRevisions([]))
    } catch (err) {
      setError(extractErrorMessages(err, 'Inquiry not found.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Deferred so the effect itself sets no state.
    if (inquiryId) Promise.resolve().then(() => { setTab(tabFromUrl()); setEditing(false); load() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inquiryId])

  // No discussion until the Technical Requirement has been sent to R&D.
  useEffect(() => {
    if (tab === 'Discussion' && inquiry && !inquiry.technical_offer_sent_at) Promise.resolve().then(() => setTab('Info'))
  }, [tab, inquiry])

  // Creator-or-admin (backend rule) AND Inquiries & Tenders › Edit in the Permission Matrix.
  const canModify = !!inquiry && !!user && (user.role === 'admin' || inquiry.created_by_id === user.id) && can('crm', 'inquiries_tenders', 'edit')
  const canDeleteRecord = !!inquiry && canDelete('crm', 'inquiries_tenders', inquiry.created_by_id ?? null)
  const isAdmin = user?.role === 'admin'
  const movingBack = !!pendingStage && !!inquiry && INQ_STAGES.indexOf(pendingStage) < INQ_STAGES.indexOf(inquiry.current_stage)

  const patch = async (payload: Record<string, unknown>) => {
    if (!inquiry) return
    try {
      setInquiry(await crmApi.updateInquiry(inquiry.id, payload))
      crmApi.getInquirySpecRevisions(inquiry.id, true).then(setRevisions).catch(() => {})
    } catch (err) {
      setError(extractErrorMessages(err, 'Update failed.'))
    }
  }

  // Status/Priority are quick lead-info toggles, not a requirement change — keep
  // updated_at as it was so they don't re-arm the "Send Technical Requirement"
  // button (that button only cares about the requirement details changing).
  const patchLeadInfo = async (payload: Record<string, unknown>) => {
    if (!inquiry) return
    try {
      const prevUpdatedAt = inquiry.updated_at
      const updated = await crmApi.updateInquiry(inquiry.id, payload)
      setInquiry({ ...updated, updated_at: prevUpdatedAt })
    } catch (err) {
      setError(extractErrorMessages(err, 'Update failed.'))
    }
  }

  const handleDelete = async () => {
    if (!inquiry) return
    try {
      await crmApi.deleteInquiry(inquiry.id)
      if (onDeleted) onDeleted()
      else router.push('/dashboard/crm/inquiries')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete inquiry.'))
    }
  }

  // Enabled the first time, and again any time the inquiry is edited after the last
  // request was sent — greyed out otherwise so R&D isn't emailed duplicate requests
  // for an unchanged requirement.
  const torActive = !!inquiry && (
    !inquiry.technical_offer_sent_at ||
    (!!inquiry.updated_at && new Date(inquiry.updated_at) > new Date(inquiry.technical_offer_sent_at))
  )

  // The PDF has no requirement details to print until these are filled — block
  // sending an effectively-empty document to R&D rather than emailing a blank one.
  const missingRequirementDetails = !!inquiry && (
    !inquiry.product ||
    !(inquiry.product_spec || inquiry.requirement_desc)
  )

  const openTorPicker = () => {
    if (missingRequirementDetails) {
      setTorError('Please fill Product and at least one of Specification/Requirement Description (click Edit) before sending the Technical Requirement to R&D — otherwise R&D gets a document with no requirement details.')
      return
    }
    setTorError('')
    setShowTorPicker(true)
  }

  const sendTechnicalOfferRequest = async (documentIds: number[], assignment: RndRequestAssignment) => {
    if (!inquiry || !torActive || missingRequirementDetails) return
    setSendingTOR(true)
    setTorError('')
    try {
      setInquiry(await crmApi.createInquiryTechnicalOfferRequest(inquiry.id, documentIds, assignment))
      setShowTorPicker(false)
      setTab('Info')
    } catch (err) {
      setTorError(extractErrorMessages(err, 'Failed to send Technical Requirement to R&D.'))
    } finally {
      setSendingTOR(false)
    }
  }

  if (loading) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (error && !inquiry) return <p style={{ fontSize: 13, color: '#b91c1c' }}>{error}</p>
  if (!inquiry) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#FF7A45' }}>{inquiry.universal_id}</span>
            {inquiry.created_at && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#a8a29e' }}>{new Date(inquiry.created_at).toLocaleDateString('en-GB')}</span>
            )}
            <span style={{ fontSize: 11, color: '#d6d3d1' }}>·</span>
            <span title={`Status: ${inquiry.status}`} style={{ fontSize: 11, fontWeight: 600, color: '#78716c' }}>{inquiry.status}</span>
            <span style={{ fontSize: 11, color: '#d6d3d1' }}>·</span>
            <span title={`Priority: ${inquiry.priority}`} style={{ fontSize: 11, fontWeight: 600, color: '#78716c' }}>{inquiry.priority}</span>
            <span style={{ fontSize: 11, color: '#d6d3d1' }}>·</span>
            <span title={`Stage: ${inquiry.current_stage}`} style={{ fontSize: 11, fontWeight: 600, color: '#78716c' }}>{inquiry.current_stage}</span>
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1f1108', margin: 0 }}>{org?.name || 'Inquiry'}</h1>
        </div>
        {!editing && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button onClick={() => router.push(backHref)} type="button" data-tour="inq-back-btn" style={secondaryBtnStyle}>
                ← Back
              </button>
              {/* Sending needs Inquiries & Tenders › Send Technical Requirement (TOR) to R&D › Create. */}
              {canSendTor && <button
                onClick={openTorPicker}
                disabled={!torActive || sendingTOR}
                data-tour="inq-tor-btn"
                title={
                  !torActive
                    ? `Already sent as ${inquiry.technical_offer_number} — edit the inquiry to send again.`
                    : missingRequirementDetails
                    ? 'Fill Product and a Specification/Requirement Description before sending — the PDF would otherwise be empty.'
                    : 'Emails R&D the Customer Organization, Project, and Product Requirement details as a PDF.'
                }
                style={{ ...secondaryBtnStyle, opacity: !torActive || sendingTOR ? 0.5 : 1, cursor: !torActive || sendingTOR ? 'not-allowed' : 'pointer' }}
              >
                {sendingTOR ? 'Sending…' : 'Send Technical Requirement to R&D'}
              </button>}
              <SalesOrderHandoff source="inquiry" record={inquiry} tourId="inq-create-so-btn" />
              {canModify && <button onClick={() => { setEditing(true); setTab('Info') }} data-tour="inq-edit-btn" style={secondaryBtnStyle}>Edit</button>}
              {canDeleteRecord && <button onClick={() => setShowDeleteConfirm(true)} data-tour="inq-delete-btn" style={dangerBtnStyle}>Delete</button>}
            </div>
            {inquiry.technical_offer_number && (
              <span style={{ fontSize: 11, color: '#78716c' }}>
                {torActive ? 'Previously sent as ' : 'Sent as '}<strong>{inquiry.technical_offer_number}</strong>
                {inquiry.technical_offer_sent_at && ` on ${formatDateTime(inquiry.technical_offer_sent_at)}`}
              </span>
            )}
          </div>
        )}
        {editing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, background: 'rgba(255,122,69,0.12)', color: '#FF7A45' }}>
              ✎ Editing Inquiry
            </span>
            <button onClick={() => setEditing(false)} type="button" style={secondaryBtnStyle}>Cancel</button>
          </div>
        )}
      </div>

      <MessageDialog open={!!torError} variant="error" title="Send Technical Requirement Failed" message={torError} onClose={() => setTorError('')} />
      <MessageDialog open={!!error} variant="error" title="Something Went Wrong" message={error} onClose={() => setError('')} />

      <StageProgress stage={inquiry.current_stage} stages={INQ_STAGES} canModify={canModify && canMoveStage} allowBackward={isAdmin} onRequestChange={setPendingStage} tourId="inq-stage-progress" />


      <div className="hide-scrollbar" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 20, padding: 4, borderRadius: 999, background: 'rgba(0,0,0,0.05)', overflowX: 'auto', overflowY: 'visible' }}>
        {TABS.filter((t) => (t !== 'Discussion' || !!inquiry.technical_offer_sent_at) && seeTab(t)).map((t) => (
          <div key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => setTab(t)}
              data-tour={`inquiry-tab-${t}`}
              style={{
                padding: '9px 16px', border: 'none', borderRadius: 999, whiteSpace: 'nowrap',
                background: tab === t ? '#fff' : 'transparent',
                boxShadow: tab === t ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
                color: tab === t ? '#FF7A45' : '#78716c', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6, transition: 'background .15s, box-shadow .15s, color .15s',
              }}
            >
              {t}
              {t === 'Info' && tab === t && revisions.length > 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(255,122,69,0.15)', color: '#FF7A45' }}>
                  {revisions.length}
                </span>
              )}
            </button>
            {t === 'Info' && tab === t && !editing && revisions.length > 0 && (
              <RevisionSelector revisions={revisions} selectedId={selectedRevId} onSelect={setSelectedRevId} tourId="inq-revision-selector" />
            )}
          </div>
        ))}
      </div>

      {(tab === 'Info' || !seeTab(tab)) && editing && (
        <InquiryForm
          initial={inquiry}
          submitLabel="Save Changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (payload) => {
            await patch(payload)
            setEditing(false)
          }}
        />
      )}
      {(tab === 'Info' || !seeTab(tab)) && !editing && (
        <InfoTab inquiry={inquiry} org={org} contact={contact} revisions={revisions} selectedRevId={selectedRevId} canModify={canModify}
          onChangeLeadInfo={(p) => (p.status === LOST_STATUS && !inquiry.lost_reason_code ? setLostStatusPending(true) : patchLeadInfo(p))} />
      )}
      {tab === 'Quotations' && seeQuotations && <QuotationsTab inquiryId={inquiry.id} org={org} contact={contact} inquiry={inquiry} />}
      {tab === 'Discussion' && seeTab('Discussion') && inquiry.technical_offer_sent_at && <RequirementDiscussionTab source="inquiry" recordId={inquiry.id} side="crm" />}
      {tab === 'Documents' && seeTab('Documents') && <DocumentsTab inquiry={inquiry} canModify={canModify && canFeature('crm', 'inquiries_tenders', 'documents', 'create')} isAdmin={isAdmin} />}
      {tab === 'Follow Ups' && seeTab('Follow Ups') && <ActivitiesTab inquiry={inquiry} org={org} />}
      {tab === 'Timeline' && seeTab('Timeline') && <TimelineTab inquiryId={inquiry.id} />}

      <TechnicalOfferPickerDialog
        open={showTorPicker}
        relatedModule="inquiry"
        relatedId={inquiry.id}
        sending={sendingTOR}
        onSend={sendTechnicalOfferRequest}
        onCancel={() => setShowTorPicker(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this inquiry?"
        message={`Delete inquiry ${inquiry.universal_id}? This action cannot be undone.`}
        onConfirm={() => { setShowDeleteConfirm(false); handleDelete() }}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Stages only move forward; going back is an admin correction and needs a reason. */}
      <LostReasonDialog
        open={lostStatusPending}
        onConfirm={(d) => { setLostStatusPending(false); patchLeadInfo({ status: LOST_STATUS, ...d }) }}
        onCancel={() => setLostStatusPending(false)}
      />
      <LostReasonDialog
        open={pendingStage === LOST_STAGE && !movingBack}
        initial={{ lost_reason_code: inquiry.lost_reason_code || '', lost_to_competitor: inquiry.lost_to_competitor, lost_remarks: inquiry.lost_remarks }}
        onConfirm={(d) => { setPendingStage(null); patch({ current_stage: LOST_STAGE, ...d }) }}
        onCancel={() => setPendingStage(null)}
      />
      <ConfirmDialog
        open={!!pendingStage && !movingBack && pendingStage !== LOST_STAGE}
        title="Update Stage"
        danger={false}
        confirmLabel="Update Stage"
        message={pendingStage ? `Move this inquiry from "${inquiry.current_stage}" to "${pendingStage}"? Stages only move forward — once moved, it cannot be undone except by an admin.` : ''}
        onConfirm={() => { const s = pendingStage; setPendingStage(null); if (s) patch({ current_stage: s }) }}
        onCancel={() => setPendingStage(null)}
      />
      <ReasonSheet
        open={!!pendingStage && movingBack}
        title="Move Stage Back"
        message={pendingStage ? `Move this inquiry back from "${inquiry.current_stage}" to "${pendingStage}"? This reverses the pipeline — the reason is kept on the timeline.` : ''}
        placeholder="e.g. Customer re-opened the requirement after the PO was withdrawn"
        label="Reason for moving the stage back"
        hint="Admin correction — the reason is kept on the inquiry's timeline."
        confirmLabel="Move Back"
        requireValue
        requiredMessage="Enter the reason for moving the stage back — it is required and is kept on the record."
        onConfirm={(reason) => { const s = pendingStage; setPendingStage(null); if (s) patch({ current_stage: s, stage_reason: reason.trim() }) }}
        onCancel={() => setPendingStage(null)}
      />
    </div>
  )
}

const infoGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px 16px' }
const leadLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 4px' }

const LOST_REASON_LABELS: Record<string, string> = {
  price: 'Price too high', technical: 'Technical / specification', delivery: 'Delivery period', budget_dropped: 'Budget dropped',
  competitor: 'Lost to competitor', no_response: 'No response', other: 'Other',
}

function InfoTab({ inquiry, org, contact, revisions, selectedRevId, canModify, onChangeLeadInfo }: { inquiry: Inquiry; org: Organization | null; contact: OrgContact | null; revisions: SpecRevision[]; selectedRevId: number | null; canModify: boolean; onChangeLeadInfo: (payload: Record<string, unknown>) => void }) {
  const selectedRev = revisions.find((r) => r.id === selectedRevId) || null
  const changeFor = (field: string) => selectedRev?.changes.find((c) => c.field === field)
  const { canFeature } = useCan()
  const seeCustomer = canFeature('crm', 'inquiries_tenders', 'customer_contact', 'view')
  const seePrices = canFeature('crm', 'inquiries_tenders', 'prices', 'view')

  return (
    <div data-tour="inq-info-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {selectedRev && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(244,113,59,0.06)', border: '1px solid rgba(244,113,59,0.18)' }}>
          <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: '#FF7A45', margin: '0 0 6px' }}>
            What changed in this revision
          </p>
          {selectedRev.changes.length === 0 ? (
            <p style={{ fontSize: 12.5, color: '#78716c', margin: 0 }}>No changes recorded for this revision.</p>
          ) : (
            <div
              style={{ fontSize: 12.5, color: '#57534e', display: 'flex', flexDirection: 'column', gap: 3 }}
              dangerouslySetInnerHTML={{ __html: specRevisionDetailHtml(selectedRev.changes) }}
            />
          )}
        </div>
      )}
      <Card title="Current Status">
        <p data-tour="inq-info-current-status" style={{ fontSize: 13, color: '#1f1108', margin: 0, whiteSpace: 'pre-wrap' }}>{inquiry.current_status_note || 'Not provided'}</p>
      </Card>
      {/* Organization (wide) + Lead Info (narrow) side by side, same height;
          fields sit on a grid so the columns line up row to row. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}>
        {seeCustomer && <div style={{ display: 'flex', flexDirection: 'column', flex: '2 1 480px', minWidth: 0 }}>
          <Card title="Customer Organization" style={{ flex: 1 }}>
            <InfoRow label="Name" value={org?.name || 'Not provided'} />
            <div style={infoGrid}>
              <InfoRow label="GST Number" value={org?.gst_number || 'Not provided'} />
              <InfoRow label="Type" value={org?.org_type || 'Not provided'} />
              <InfoRow label="City" value={org?.city || 'Not provided'} />
              <InfoRow label="State" value={org?.state || 'Not provided'} />
            </div>
            <InfoRow label="Address" value={org?.address || 'Not provided'} />
            <div style={{ paddingTop: 12, marginTop: 2, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#1f1108', margin: '0 0 10px' }}>Contact Person</p>
              <div style={infoGrid}>
                <InfoRow label="Name" value={contact?.name || 'Not provided'} />
                <InfoRow label="Mobile" value={contact?.mobile || 'Not provided'} />
                <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}><InfoRow label="Email" value={contact?.email || 'Not provided'} /></div>
                <InfoRow label="Department" value={contact?.department || 'Not provided'} />
              </div>
            </div>
          </Card>
        </div>}
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 300px', minWidth: 0 }}>
          <Card title="Lead Info" style={{ flex: 1 }}>
            <div>
              <p style={leadLabel}>Status</p>
              {canModify ? (
                <select data-tour="inq-info-status" value={inquiry.status} onChange={(e) => onChangeLeadInfo({ status: e.target.value })} style={{ ...inputStyle, padding: '6px 10px', fontSize: 12.5, width: '100%' }}>
                  {inquiryStatusOptions(inquiry.status).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : <p style={{ fontSize: 13, color: '#1f1108', margin: 0 }}>{inquiry.status || 'Not provided'}</p>}
            </div>
            <div>
              <p style={leadLabel}>Customer Requirement Priority</p>
              {canModify ? (
                <select data-tour="inq-info-priority" value={inquiry.priority} onChange={(e) => onChangeLeadInfo({ priority: e.target.value })} style={{ ...inputStyle, padding: '6px 10px', fontSize: 12.5, width: '100%' }}>
                  {priorityOptions(inquiry.priority).map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
                </select>
              ) : <p style={{ fontSize: 13, color: '#1f1108', margin: 0 }}>{inquiry.priority || 'Not provided'}</p>}
            </div>
            <div style={{ ...infoGrid, gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <InfoRow label="Lead Source" value={inquiry.lead_source || 'Not provided'} />
              <InfoRow label="BD Owner" value={inquiry.bd_owner || 'Not provided'} />
              {seePrices && <InfoRow label="Expected Value" value={inquiry.expected_value != null ? `₹${Number(inquiry.expected_value).toLocaleString('en-IN')}` : 'Not provided'} />}
              <InfoRow label="Win Probability" value={inquiry.probability != null ? `${inquiry.probability}%` : 'Not provided'} />
              <InfoRow label="Expected Order" value={inquiry.expected_order_date ? formatDate(inquiry.expected_order_date) : 'Not provided'} />
              {inquiry.lost_reason_code && <InfoRow label="Lost Reason" value={`${LOST_REASON_LABELS[inquiry.lost_reason_code] || inquiry.lost_reason_code}${inquiry.lost_to_competitor ? ` — ${inquiry.lost_to_competitor}` : ''}${inquiry.lost_remarks ? ` (${inquiry.lost_remarks})` : ''}`} />}
              <InfoRow label="Created On" value={inquiry.created_at ? formatDate(inquiry.created_at) : 'Not provided'} />
            </div>
          </Card>
        </div>
      </div>
      <Card title="Product Requirement">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ flex: '1 1 180px', minWidth: 160, maxWidth: 280 }}><SpecInfoRow label="Product" value={inquiry.product || 'Not provided'} change={changeFor('product')} /></div>
          <div style={{ flex: '0 1 150px', minWidth: 120 }}><SpecInfoRow label="Category" value={inquiry.product_category || 'Not provided'} change={changeFor('product_category')} /></div>
          <div style={{ flex: '0 1 90px', minWidth: 80 }}><SpecInfoRow label="Quantity" value={inquiry.quantity != null ? String(inquiry.quantity) : 'Not provided'} change={changeFor('quantity')} /></div>
          <div style={{ flex: '0 1 140px', minWidth: 120 }}><SpecInfoRow label="Required Delivery" value={inquiry.required_delivery_date || 'Not provided'} change={changeFor('required_delivery_date')} /></div>
          <div style={{ flex: '1 1 160px', minWidth: 140, maxWidth: 260 }}><SpecInfoRow label="Delivery Location" value={inquiry.delivery_location || 'Not provided'} change={changeFor('delivery_location')} /></div>
          <div style={{ flex: '0 1 130px', minWidth: 110 }}><SpecInfoRow label="Inspection Req." value={inquiry.inspection_req || 'Not provided'} change={changeFor('inspection_req')} /></div>
          <div style={{ flex: '0 1 130px', minWidth: 110 }}><SpecInfoRow label="Warranty Req." value={inquiry.warranty_req || 'Not provided'} change={changeFor('warranty_req')} /></div>
        </div>
        <SpecInfoRow label="Specification" value={inquiry.product_spec || 'Not provided'} change={changeFor('product_spec')} />
        {(inquiry.additional_items || []).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: 0 }}>Additional Products</p>
            {inquiry.additional_items!.map((it) => (
              <div key={it.id} style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 150px', minWidth: 130, maxWidth: 260 }}><InfoRow label="Product" value={it.product || 'Not provided'} /></div>
                <div style={{ flex: '0 1 140px', minWidth: 110 }}><InfoRow label="Category" value={it.product_category || 'Not provided'} /></div>
                <div style={{ flex: '0 1 90px', minWidth: 80 }}><InfoRow label="Quantity" value={it.quantity != null ? String(it.quantity) : 'Not provided'} /></div>
                {it.product_spec && <div style={{ flex: '2 1 200px', minWidth: 160 }}><InfoRow label="Specification" value={it.product_spec} /></div>}
              </div>
            ))}
          </div>
        )}
        <SpecInfoRow label="Requirement Summary" value={inquiry.requirement_desc || 'Not provided'} change={changeFor('requirement_desc')} />
        <SpecInfoRow label="Project Details" value={inquiry.project_details || 'Not provided'} change={changeFor('project_details')} />
      </Card>
    </div>
  )
}

const emptyLineItem = { description: '', model_number: '', details: '', quantity: '', unit_price: '', gst_percent: '', subtotal: '', total: '' }

// A valid Delivery Time must carry a unit, not just a bare number — "7" is ambiguous,
// "7 days" isn't. Accepts day/week/month/hour in singular or plural, any case, with
// any words in between the number and the unit (e.g. "120 working days").
const DELIVERY_TIME_PATTERN = /\d+.*\b(day|days|week|weeks|month|months|hour|hours|hrs?)\b/i

type QuotationItemErrors = { description?: string; quantity?: string; unit_price?: string; gst_percent?: string }
type QuotationFormErrors = {
  client_name?: string
  quotation_type?: string
  quote_date?: string
  items?: string
  itemErrors?: Record<number, QuotationItemErrors>
  delivery_time?: string
  valid_until?: string
  discount?: string
  quote_conditions?: string
  payment_terms?: string
  price?: string
  lump_sum_gst_percent?: string
}

// Default quote validity: 30 days from the quote date (yyyy-mm-dd in, yyyy-mm-dd out).
const QUOTE_VALIDITY_DAYS = 30
const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const fieldErrorTextStyle: React.CSSProperties = { fontSize: 11, color: '#ef4444', fontWeight: 600, margin: '4px 0 0' }
const errInputStyle = (hasError: boolean): React.CSSProperties => (hasError ? { borderColor: '#f87171' } : {})
const fmtAmount = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Quotation prices are visible with Prices & margins, or to whoever creates /
 *  edits / approves quotations (same rule as crm/access.py sees_quotation_prices). */
const seesQuotationPrices = (canFeature: ReturnType<typeof useCan>['canFeature']) =>
  canFeature('crm', 'inquiries_tenders', 'prices', 'view')
  || canFeature('crm', 'inquiries_tenders', 'quotations', 'create')
  || canFeature('crm', 'inquiries_tenders', 'quotations', 'edit')
  || canFeature('crm', 'inquiries_tenders', 'quotations', 'approve')

/** Labelled field in the sheet style (keeps the tour target on the wrapper). */
function SF({ label, tourId, children }: { label: React.ReactNode; tourId?: string; children: React.ReactNode }) {
  return (
    <div {...(tourId ? { 'data-tour': tourId } : {})}>
      <label style={sheetLabel}>{label}</label>
      {children}
    </div>
  )
}

function QuotationsTab({ inquiryId, org, contact, inquiry }: { inquiryId: number; org: Organization | null; contact: OrgContact | null; inquiry: Inquiry }) {
  const { canFeature } = useCan()
  const { user: me } = useAuth()
  // Inquiry owner or admin (backend rule) AND Inquiries & Tenders › Quotations › Create / Edit.
  const ownerOrAdmin = !!me && (me.role === 'admin' || inquiry.created_by_id === me.id)
  const canModify = ownerOrAdmin && canFeature('crm', 'inquiries_tenders', 'quotations', 'edit')
  const canCreateQuote = ownerOrAdmin && canFeature('crm', 'inquiries_tenders', 'quotations', 'create')
  const seeQuotePrices = seesQuotationPrices(canFeature)
  const { user } = useAuth()
  const [quotations, setQuotations] = useState<QuotationItem[]>([])
  const [showForm, setShowForm] = useState(false)
  // Revise opens the same full form, filled with this quotation; saving records a revision.
  const [revisingQuot, setRevisingQuot] = useState<QuotationItem | null>(null)
  const todayIso = new Date().toISOString().slice(0, 10)
  // R&D's released Technical Offers for this inquiry — the quotation quotes against one of them.
  const [technicalOffers, setTechnicalOffers] = useState<CrmTechnicalOfferOption[]>([])
  const currentOffer = technicalOffers.find((o) => o.status === 'released')
  const emptyForm = {
    quotation_type: 'Domestic', gst_type: 'CGST_SGST', quote_date: todayIso, client_name: org?.name || '', client_contact_name: contact?.name || '',
    client_contact_email: contact?.email || '', client_contact_phone: contact?.mobile || '',
    technical_offer_id: currentOffer ? String(currentOffer.id) : '',
    valid_until: addDaysIso(todayIso, QUOTE_VALIDITY_DAYS), delivery_time: '', payment_terms: '', notes: '',
    discount: '', discount_type: 'percent', quote_conditions: '', quote_conditions_custom: '',
    // 'lumpsum' = official Commercial Offer: items are a Particulars list, one Total Price + GST for the whole offer.
    pricing_mode: 'itemwise', price: '', lump_sum_gst_percent: '18',
  }
  const [form, setForm] = useState(emptyForm)
  const [items, setItems] = useState([{ ...emptyLineItem }])
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const [pdfError, setPdfError] = useState<string | string[]>('')
  const [formError, setFormError] = useState<string | string[]>('')
  const [fieldErrors, setFieldErrors] = useState<QuotationFormErrors>({})
  const [attemptedSave, setAttemptedSave] = useState(false)
  const [productError, setProductError] = useState('')
  const [productNotice, setProductNotice] = useState('')
  const [dupItemError, setDupItemError] = useState('')
  const [products, setProducts] = useState<{ id: number; name: string; category?: string | null; model_number?: string | null; unit_price?: number | null; default_price?: number | null }[]>([])
  const [paymentTerms, setPaymentTerms] = useState<{ id: number; label: string; description?: string | null }[]>([])
  const [quotRevisions, setQuotRevisions] = useState<Record<number, SpecRevision[]>>({})
  const [selectedQuotRev, setSelectedQuotRev] = useState<Record<number, number | null>>({})
  const [saving, setSaving] = useState(false)
  const [tabError, setTabError] = useState<{ title: string; message: string | string[] } | null>(null)
  const load = () => {
    crmApi.listQuotations(inquiryId).then((data: QuotationItem[]) => {
      setQuotations(data)
      data.filter((q) => q.revision_number > 0).forEach((q) => {
        crmApi.getQuotationRevisions(inquiryId, q.id)
          .then((revs) => setQuotRevisions((m) => ({ ...m, [q.id]: revs })))
          .catch((err) => setTabError({ title: 'Cannot Load Revision History', message: extractErrorMessages(err, `Could not load the revision history of ${q.quot_number || 'this quotation'}. Refresh the page; if it persists, check your connection.`) }))
      })
    }).catch((err) => setTabError({ title: 'Cannot Load Quotations', message: extractErrorMessages(err, 'Could not load the quotations for this inquiry. Refresh the page; if it persists, check your connection.') }))
  }
  // Status (draft → approval → sent → accepted / lost) is driven by QuotationStatusBar,
  // not by a free-text customer-response select.
  useEffect(() => { load() }, [inquiryId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    crmApi.listProducts().then(setProducts).catch(() => {})
    crmApi.listPaymentTerms().then(setPaymentTerms).catch(() => {})
  }, [])
  useEffect(() => {
    crmApi.listInquiryTechnicalOffers(inquiryId).then(setTechnicalOffers)
      .catch((err) => setTabError({ title: 'Cannot Load Technical Offers', message: extractErrorMessages(err, "Could not load R&D's Technical Offers for this inquiry. Refresh the page; if it persists, check your connection.") }))
  }, [inquiryId])
  const openTechnicalOfferPdf = async (offer: CrmTechnicalOfferOption) => {
    const tab = window.open('', '_blank')
    try {
      const url = URL.createObjectURL(await crmApi.technicalOfferPdf(inquiryId, offer.id))
      if (tab) tab.location.href = url
      else window.open(url, '_blank')
    } catch (err) {
      tab?.close()
      setTabError({ title: 'Cannot Open Technical Offer', message: extractErrorMessages(err, `Could not open ${offer.offer_number}.`) })
    }
  }

  const applyProductToRow = (idx: number, product: { name: string; model_number?: string | null; default_price?: number | null }) => {
    setDupItemError('')
    const nameKey = product.name.trim().toLowerCase()
    const modelKey = (product.model_number || '').trim().toLowerCase()
    const dupExists = items.some((row, i) =>
      i !== idx && row.description.trim().toLowerCase() === nameKey && (row.model_number || '').trim().toLowerCase() === modelKey
    )
    if (dupExists) {
      setDupItemError('This item with the same model number is already added — change the model number or edit the existing line instead.')
      return
    }
    setItems((rows) => rows.map((row, i) => i === idx ? {
      ...row,
      description: product.name,
      model_number: product.model_number || '',
      unit_price: product.default_price != null ? String(product.default_price) : row.unit_price,
    } : row))
  }

  // Saves whatever the user already typed into that row's Description/Model No. fields as a
  // new Product — no separate popup, since the row's own inputs already hold the values.
  // Model No. is optional; when left blank the product just won't have one until edited later.
  const createProductFromRow = async (idx: number, typedName: string) => {
    const row = items[idx]
    const name = typedName.trim()
    if (!name) return
    setProductError('')
    let created
    try {
      created = await crmApi.createProduct({
        name,
        model_number: row.model_number.trim() || undefined,
        default_price: row.unit_price ? Number(row.unit_price) : undefined,
      })
    } catch (err) {
      setProductError(extractErrorMessages(err, `Product "${name}" was not added to the product list. Check the name/model number and try again.`).join(' '))
      return
    }
    setProducts((p) => [...p, created])
    updateItemRow(idx, 'description', created.name)
    setProductNotice(created.model_number
      ? `New product "${created.name}" (Model No. ${created.model_number}) added to the product list.`
      : `New product "${created.name}" added to the product list.`)
  }

  // Saves whatever the user already typed into the Payment Terms field as a new Payment Term —
  // no separate popup, the typed text becomes both the label and the terms text.
  const createPaymentTermFromField = async (typedText: string) => {
    const text = typedText.trim()
    if (!text) return
    let created
    try {
      created = await crmApi.createPaymentTerm({ label: text, description: text })
    } catch (err) {
      setTabError({ title: 'Cannot Add Payment Term', message: extractErrorMessages(err, `Payment term "${text}" was not added to the list. Try again, or ask an admin to add it under CRM settings.`) })
      return
    }
    setPaymentTerms((p) => [...p, created])
    setForm((f) => ({ ...f, payment_terms: created.description || created.label }))
  }

  useEffect(() => {
    if (showForm) return
    // Deferred so the effect itself sets no state.
    Promise.resolve().then(() => setForm((f) => ({
      ...f,
      client_name: f.client_name || org?.name || '',
      client_contact_name: f.client_contact_name || contact?.name || '',
      client_contact_email: f.client_contact_email || contact?.email || '',
      client_contact_phone: f.client_contact_phone || contact?.mobile || '',
    })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, contact])

  const downloadPdf = async (q: QuotationItem) => {
    setDownloadingId(q.id)
    setPdfError('')
    try {
      const blob = await crmApi.downloadQuotationPdf(inquiryId, q.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${q.quot_number || `Quotation-${q.id}`}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setPdfError(extractErrorMessages(err, 'PDF generation failed.'))
    } finally {
      setDownloadingId(null)
    }
  }

  const cancelForm = () => {
    setProductError('')
    setDupItemError('')
    setProductNotice('')
    setForm(emptyForm)
    setItems([{ ...emptyLineItem }])
    setFormError('')
    setFieldErrors({})
    setAttemptedSave(false)
    setShowForm(false)
    setRevisingQuot(null)
  }

  const startRevise = (q: QuotationItem) => {
    const conditions = q.quote_conditions || ''
    const known = !conditions || (QUOTE_CONDITIONS as readonly string[]).includes(conditions)
    setForm({
      quotation_type: q.quotation_type || 'Domestic', gst_type: q.gst_type || 'CGST_SGST', quote_date: q.quote_date || todayIso,
      client_name: q.client_name || '', client_contact_name: q.client_contact_name || '',
      client_contact_email: q.client_contact_email || '', client_contact_phone: q.client_contact_phone || '',
      technical_offer_id: q.technical_offer_id ? String(q.technical_offer_id) : '',
      valid_until: q.valid_until || '', delivery_time: q.delivery_time || '', payment_terms: q.payment_terms || '', notes: q.notes || '',
      discount: q.discount != null ? String(q.discount) : '', discount_type: q.discount_type || 'percent',
      quote_conditions: known ? conditions : 'Other/Custom', quote_conditions_custom: known ? '' : conditions,
      pricing_mode: q.pricing_mode || 'itemwise', price: q.price != null ? String(q.price) : '',
      lump_sum_gst_percent: q.lump_sum_gst_percent != null ? String(q.lump_sum_gst_percent) : '18',
    })
    const str = (v?: number | null) => (v != null ? String(v) : '')
    setItems(q.items.length ? q.items.map((it) => ({
      description: it.description || '', model_number: it.model_number || '', details: it.details || '',
      quantity: str(it.quantity), unit_price: str(it.unit_price), gst_percent: str(it.gst_percent), subtotal: str(it.subtotal), total: str(it.total),
    })) : [{ ...emptyLineItem }])
    setFormError('')
    setFieldErrors({})
    setAttemptedSave(false)
    setRevisingQuot(q)
    setShowForm(true)
  }

  const addItemRow = () => setItems((rows) => [...rows, { ...emptyLineItem }])
  const removeItemRow = (idx: number) => setItems((rows) => rows.filter((_, i) => i !== idx))
  const updateItemRow = (idx: number, field: keyof typeof emptyLineItem, value: string) =>
    setItems((rows) => rows.map((row, i) => {
      if (i !== idx) return row
      const updated = { ...row, [field]: value }
      if (field === 'quantity' || field === 'unit_price' || field === 'gst_percent') {
        const qty = Number(updated.quantity) || 0
        const price = Number(updated.unit_price) || 0
        const gst = form.quotation_type === 'Export' ? 0 : Number(updated.gst_percent) || 0
        const subtotal = qty * price
        const total = subtotal + subtotal * (gst / 100)
        updated.subtotal = subtotal ? String(Number(subtotal.toFixed(2))) : ''
        updated.total = subtotal ? String(Number(total.toFixed(2))) : ''
      }
      return updated
    }))
  const isLumpSum = form.pricing_mode === 'lumpsum'
  const isExport = form.quotation_type === 'Export'
  const currencySymbol = isExport ? '$' : '₹'
  const lumpSumTotal = (Number(form.price) || 0) * (1 + (form.quotation_type === 'Export' ? 0 : Number(form.lump_sum_gst_percent) || 0) / 100)
  const itemsTotal = isLumpSum ? lumpSumTotal : items.reduce((sum, it) => sum + (Number(it.total) || 0), 0)
  const discountAmount = form.discount && !isLumpSum
    ? (form.discount_type === 'percent' ? itemsTotal * (Number(form.discount) / 100) : Number(form.discount))
    : 0
  const grandTotal = itemsTotal - discountAmount

  useEffect(() => {
    // Deferred so the effect itself sets no state.
    Promise.resolve().then(() => setItems((rows) => rows.map((row) => {
      const qty = Number(row.quantity) || 0
      const price = Number(row.unit_price) || 0
      const gst = form.quotation_type === 'Export' ? 0 : Number(row.gst_percent) || 0
      const subtotal = qty * price
      const total = subtotal + subtotal * (gst / 100)
      return { ...row, subtotal: subtotal ? String(Number(subtotal.toFixed(2))) : row.subtotal, total: subtotal ? String(Number(total.toFixed(2))) : row.total }
    })))
  }, [form.quotation_type])

  // Only rows the user actually touched are validated/sent — a blank extra row from
  // "+ Add Line Item" that was never filled in is silently dropped, not an error.
  const isItemRowEmpty = (it: typeof emptyLineItem) =>
    !it.description.trim() && !it.model_number.trim() && !it.details.trim() && !it.quantity && !it.unit_price && !it.gst_percent

  const validate = (): QuotationFormErrors => {
    const errs: QuotationFormErrors = {}
    if (!form.client_name.trim()) errs.client_name = 'Customer/Client is required.'
    if (!form.quotation_type) errs.quotation_type = 'Quotation Type is required.'
    if (!form.quote_date) errs.quote_date = 'Date of Quote is required.'

    const itemErrors: Record<number, QuotationItemErrors> = {}
    let anyFilledItem = false
    items.forEach((it, idx) => {
      if (isItemRowEmpty(it)) return
      anyFilledItem = true
      const rowErrs: QuotationItemErrors = {}
      if (!it.description.trim()) rowErrs.description = 'Item Name is required.'
      if (it.quantity && Number(it.quantity) <= 0) rowErrs.quantity = 'Quantity must be more than 0 — enter a positive number or leave it blank.'
      if (!isLumpSum && it.unit_price && Number(it.unit_price) < 0) rowErrs.unit_price = 'Price/Unit cannot be negative — enter 0 or more, or leave it blank.'
      if (!isLumpSum && !isExport && it.gst_percent && (Number(it.gst_percent) < 0 || Number(it.gst_percent) > 100)) rowErrs.gst_percent = 'GST % must be between 0 and 100 — fix it or leave it blank.'
      if (Object.keys(rowErrs).length) itemErrors[idx] = rowErrs
    })
    if (!anyFilledItem) errs.items = 'Add at least one line item.'
    else if (Object.keys(itemErrors).length) errs.itemErrors = itemErrors

    if (isLumpSum) {
      if (!form.price || !(Number(form.price) > 0)) errs.price = 'Total Price is required for a lump-sum offer — enter the price for the whole offer, or switch Pricing to Item-wise.'
      if (!isExport && form.lump_sum_gst_percent !== '' && (Number(form.lump_sum_gst_percent) < 0 || Number(form.lump_sum_gst_percent) > 100)) errs.lump_sum_gst_percent = 'GST % must be between 0 and 100.'
    }

    if (!form.delivery_time.trim()) errs.delivery_time = 'Delivery Time is required.'
    else if (!DELIVERY_TIME_PATTERN.test(form.delivery_time.trim())) errs.delivery_time = 'Include a unit, e.g. "7 days" or "2 weeks".'

    if (!form.valid_until) errs.valid_until = 'Quote Validity Date is required.'
    else if (form.quote_date && form.valid_until < form.quote_date) {
      errs.valid_until = `Quote Validity Date (${form.valid_until}) is before the Date of Quote (${form.quote_date}). Set it on or after the quote date.`
    }

    if (form.discount !== '' && !isLumpSum) {
      const d = Number(form.discount)
      if (Number.isNaN(d) || d < 0) errs.discount = 'Discount cannot be negative. Enter 0 or more, or leave it blank.'
      else if (form.discount_type === 'percent' && d > 100) errs.discount = `Discount is ${d}% — a percent discount cannot exceed 100%. Enter 100 or less, or switch the type to a flat amount.`
      else if (form.discount_type === 'flat' && d > itemsTotal) errs.discount = `Flat discount (${d}) is more than the line items total (${itemsTotal.toFixed(2)}). Reduce the discount.`
    }

    const conditionsValue = form.quote_conditions === 'Other/Custom' ? form.quote_conditions_custom : form.quote_conditions
    if (!isLumpSum && !conditionsValue.trim()) errs.quote_conditions = 'Quote Conditions is required.'

    if (!form.payment_terms.trim()) errs.payment_terms = 'Payment Terms is required.'

    return errs
  }

  // Once the user has tried to save once, keep re-validating live so field errors
  // clear themselves as soon as the user fixes them, instead of only at next submit.
  useEffect(() => {
    if (attemptedSave) Promise.resolve().then(() => setFieldErrors(validate()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, items, attemptedSave])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return  // a double-click must not create two quotations
    setFormError('')
    setAttemptedSave(true)
    const errs = validate()
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) {
      setFormError('Please fix the highlighted fields before saving the quotation.')
      return
    }
    const validItems = items.filter((it) => !isItemRowEmpty(it))
    const { quote_conditions_custom, ...rest } = form
    const payload: Record<string, unknown> = {
      ...rest,
      technical_offer_id: form.technical_offer_id ? Number(form.technical_offer_id) : undefined,
      discount: form.discount && !isLumpSum ? Number(form.discount) : undefined,
      discount_type: form.discount && !isLumpSum ? form.discount_type : undefined,
      price: isLumpSum ? Number(form.price) : undefined,
      lump_sum_gst_percent: isLumpSum && !isExport && form.lump_sum_gst_percent !== '' ? Number(form.lump_sum_gst_percent) : undefined,
      quote_conditions: form.quote_conditions === 'Other/Custom' ? (quote_conditions_custom || undefined) : (form.quote_conditions || undefined),
      items: validItems
        .map((it) => ({
          description: it.description || undefined,
          model_number: it.model_number || undefined,
          details: it.details.trim() || undefined,
          quantity: it.quantity ? Number(it.quantity) : undefined,
          unit_price: !isLumpSum && it.unit_price ? Number(it.unit_price) : undefined,
          gst_percent: isLumpSum || form.quotation_type === 'Export' || !it.gst_percent ? undefined : Number(it.gst_percent),
          subtotal: it.subtotal ? Number(it.subtotal) : undefined,
          total: it.total ? Number(it.total) : undefined,
        })),
    }
    // Date fields (and any other optional field left blank) must be omitted, not sent as ''
    // — the backend expects a real date or nothing, and an empty string fails validation.
    Object.keys(payload).forEach((k) => {
      if (payload[k] === '') delete payload[k]
    })
    if (revisingQuot) {
      // A revision sends every field: one left blank is cleared (null), not kept as it was.
      for (const k of ['technical_offer_id', 'client_contact_name', 'client_contact_email', 'client_contact_phone', 'discount', 'discount_type',
        'price', 'lump_sum_gst_percent', 'quote_conditions', 'notes']) {
        if (payload[k] === undefined) payload[k] = null
      }
      delete payload.customer_response
      delete payload.submitted_date
    }
    setSaving(true)
    try {
      if (revisingQuot) await crmApi.updateQuotation(inquiryId, revisingQuot.id, payload)
      else await crmApi.createQuotation(inquiryId, payload)
    } catch (err) {
      setFormError(extractErrorMessages(err, 'Failed to save quotation.'))
      return
    } finally {
      setSaving(false)
    }
    cancelForm()
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {(canCreateQuote || canModify) && (
        <div>
          {canCreateQuote && <button onClick={() => { setFormError(''); setForm(emptyForm); setItems([{ ...emptyLineItem }]); setRevisingQuot(null); setShowForm(true) }} data-tour="quotation-create-btn" style={primaryBtnStyle}>+ Create Quote</button>}
          {/* Create and Revise both open the form as a popup (FormSheet is portalled to body —
              the glass cards' backdrop-filter would clip a fixed overlay), so the saved
              quotation card is never shown side by side with an inline edit copy. */}
          {showForm && (
            <FormSheet tour="quot-form" icon={revisingQuot ? 'edit' : 'rupee'} onClose={cancelForm} busy={saving}
              title={revisingQuot ? `Edit ${revisingQuot.quot_number || 'Quotation'}` : 'New Quotation'}
              subtitle={revisingQuot
                ? `Saving updates this quotation as revision r${revisingQuot.revision_number + 1}; earlier versions stay available in its revision list.`
                : `Price offer to ${org?.name || 'the customer'} for inquiry ${inquiry.universal_id}.`}
              footer={<>
                <button type="button" onClick={cancelForm} disabled={saving} data-tour="quot-cancel-btn" style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
                <button type="submit" form="quotation-form" data-tour="quot-save" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
                  <SheetIcon name={revisingQuot ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : revisingQuot ? 'Save Changes' : 'Save Quotation'}
                </button>
              </>}>
            <form id="quotation-form" onSubmit={save} onKeyDown={handleEnterAsTab} style={{ padding: '20px 24px' }}>
              <SheetError error={formError} />
              <SheetError error={productError} />
              <SheetError error={dupItemError} />
              {productNotice && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
                  <span style={{ flex: 1 }}>{productNotice}</span>
                  <button type="button" aria-label="Dismiss" onClick={() => setProductNotice('')} style={sheetBtn('ghost', '#15803d')}><SheetIcon name="x" size={14} /></button>
                </div>
              )}
              <SheetSection icon="doc" title="Quotation">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <SF label={<>Quotation Type <Req /></>} tourId="quot-type">
                  <select value={form.quotation_type} onChange={(e) => setForm((f) => ({ ...f, quotation_type: e.target.value }))} style={{ ...sheetInput, ...errInputStyle(!!fieldErrors.quotation_type) }}>
                    <option value="Domestic">Domestic (INR)</option>
                    <option value="Export">Export (USD)</option>
                  </select>
                  {fieldErrors.quotation_type && <p style={fieldErrorTextStyle}>{fieldErrors.quotation_type}</p>}
                </SF>
                {!isExport && (
                  <SF label="GST Type" tourId="quot-gst-type">
                    <select value={form.gst_type} onChange={(e) => setForm((f) => ({ ...f, gst_type: e.target.value }))} style={sheetInput}>
                      <option value="CGST_SGST">CGST + SGST (Intra-state)</option>
                      <option value="IGST">IGST (Inter-state)</option>
                    </select>
                  </SF>
                )}
                <SF label="Pricing" tourId="quot-pricing-mode">
                  <select value={form.pricing_mode} onChange={(e) => setForm((f) => ({ ...f, pricing_mode: e.target.value }))} style={sheetInput}>
                    <option value="itemwise">Item-wise (price per line)</option>
                    <option value="lumpsum">Lump sum (one total price)</option>
                  </select>
                </SF>
                <SF label={<>Date of Quote <Req /></>} tourId="quot-date">
                  <DateField value={form.quote_date} onChange={(v) => setForm((f) => ({
                    ...f,
                    quote_date: v,
                    // Keep the 30-day default in step with the quote date unless the user set their own validity.
                    valid_until: !f.valid_until || f.valid_until === addDaysIso(f.quote_date, QUOTE_VALIDITY_DAYS) ? addDaysIso(v, QUOTE_VALIDITY_DAYS) : f.valid_until,
                  }))} style={errInputStyle(!!fieldErrors.quote_date)} />
                  {fieldErrors.quote_date && <p style={fieldErrorTextStyle}>{fieldErrors.quote_date}</p>}
                </SF>
                <div style={{ gridColumn: 'span 2' }}>
                  <SF label="Technical Offer (R&D)" tourId="quot-tor-number">
                    {technicalOffers.length === 0 ? (
                      <p style={{ fontSize: 12.5, color: '#78716c', margin: '10px 0 0' }}>No Technical Offer from R&amp;D yet — R&amp;D prepares it in R&amp;D › Requirements › Technical Offers and the R&amp;D head sends it to the BD team.</p>
                    ) : (
                      <select value={form.technical_offer_id} onChange={(e) => setForm((f) => ({ ...f, technical_offer_id: e.target.value }))} style={sheetInput}>
                        <option value="">— No technical offer —</option>
                        {technicalOffers.map((o) => (
                          <option key={o.id} value={String(o.id)}>{o.offer_number} · {o.title}{o.status === 'superseded' ? ' (superseded)' : ''}</option>
                        ))}
                      </select>
                    )}
                  </SF>
                  {(() => {
                    const picked = technicalOffers.find((o) => String(o.id) === form.technical_offer_id)
                    return picked && (
                      <p data-tour="quot-tor-date" style={{ fontSize: 12, color: '#57534e', margin: '6px 0 0' }}>
                        Technical Offer Date: <strong>{formatDate(picked.offer_date)}</strong>
                        {picked.status === 'superseded' && <span style={{ color: '#b45309' }}> · a newer revision exists</span>}
                        {' · '}<a href="#" onClick={(e) => { e.preventDefault(); openTechnicalOfferPdf(picked) }} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>Open PDF</a>
                      </p>
                    )
                  })()}
                </div>
              </div>
              </SheetSection>

              <SheetSection icon="building" title="Customer">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <SF label={<>Customer/Client <Req /></>} tourId="quot-client-name">
                  <input value={form.client_name} onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))} placeholder="e.g. Northern Railway HQ" style={{ ...sheetInput, ...errInputStyle(!!fieldErrors.client_name) }} />
                  {fieldErrors.client_name && <p style={fieldErrorTextStyle}>{fieldErrors.client_name}</p>}
                </SF>
                <SF label="Contact Person Name" tourId="quot-contact-name"><input value={form.client_contact_name} onChange={(e) => setForm((f) => ({ ...f, client_contact_name: e.target.value }))} placeholder="e.g. Rajesh Kumar" style={sheetInput} /></SF>
                <SF label="Contact Email" tourId="quot-contact-email"><input type="email" value={form.client_contact_email} onChange={(e) => setForm((f) => ({ ...f, client_contact_email: e.target.value }))} placeholder="e.g. name@company.com" style={sheetInput} /></SF>
                <SF label="Contact Phone" tourId="quot-contact-phone"><input value={form.client_contact_phone} onChange={(e) => setForm((f) => ({ ...f, client_contact_phone: e.target.value }))} placeholder="e.g. +91 98765 43210" style={sheetInput} /></SF>
              </div>
              </SheetSection>

              <SheetSection icon="list" title="Line Items" extra={<Req />}>
              <div data-tour="quot-line-items">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: items.length > 4 ? 340 : undefined, overflowY: items.length > 4 ? 'auto' : undefined, paddingRight: items.length > 4 ? 6 : undefined }}>
                  {items.map((row, idx) => {
                    const rowErr = fieldErrors.itemErrors?.[idx]
                    return (
                    <div key={idx}>
                      <div style={{ display: 'grid', gridTemplateColumns: isLumpSum ? '2fr 1.2fr 0.7fr auto' : isExport ? '2fr 1.2fr 0.7fr 0.9fr 0.9fr auto' : '2fr 1.2fr 0.7fr 0.9fr 0.7fr 0.9fr auto', gap: 6, alignItems: 'center' }}>
                        <div {...(idx === 0 ? { 'data-tour': 'quot-item-name' } : {})}>
                          <ComboBox
                            value={row.description}
                            onChange={(v) => updateItemRow(idx, 'description', v)}
                            onPick={(o) => { const p = products.find((pr) => String(pr.id) === o.key); if (p) applyProductToRow(idx, p) }}
                            onCreateNew={(query) => createProductFromRow(idx, query)}
                            createLabel="New Product"
                            options={products.map((p) => ({ key: String(p.id), label: p.name, sublabel: p.model_number || undefined }))}
                            placeholder="Item Name — type or pick a product"
                          />
                        </div>
                        <input {...(idx === 0 ? { 'data-tour': 'quot-item-model' } : {})} value={row.model_number} onChange={(e) => updateItemRow(idx, 'model_number', e.target.value)} placeholder="Model No. (if applicable)" style={sheetInput} />
                        <input {...(idx === 0 ? { 'data-tour': 'quot-item-qty' } : {})} type="number" value={row.quantity} onChange={(e) => updateItemRow(idx, 'quantity', e.target.value)} placeholder="Qty" style={{ ...sheetInput, ...errInputStyle(!!rowErr?.quantity) }} />
                        {!isLumpSum && <>
                        <input {...(idx === 0 ? { 'data-tour': 'quot-item-price' } : {})} type="number" value={row.unit_price} onChange={(e) => updateItemRow(idx, 'unit_price', e.target.value)} placeholder={`Price/unit (${currencySymbol})`} style={{ ...sheetInput, ...errInputStyle(!!rowErr?.unit_price) }} />
                        {!isExport && <input {...(idx === 0 ? { 'data-tour': 'quot-item-gst' } : {})} type="number" value={row.gst_percent} onChange={(e) => updateItemRow(idx, 'gst_percent', e.target.value)} placeholder="GST %" style={{ ...sheetInput, ...errInputStyle(!!rowErr?.gst_percent) }} />}
                        <input {...(idx === 0 ? { 'data-tour': 'quot-item-subtotal' } : {})} type="number" value={row.subtotal} readOnly placeholder="Subtotal" style={{ ...sheetInput, background: 'rgba(0,0,0,0.04)', color: '#57534e' }} />
                        </>}
                        <button type="button" onClick={() => removeItemRow(idx)} aria-label="Remove line item" style={sheetBtn('ghost', '#DC2626')}><SheetIcon name="trash" size={16} /></button>
                      </div>
                      <textarea
                        {...(idx === 0 ? { 'data-tour': 'quot-item-details' } : {})}
                        value={row.details}
                        onChange={(e) => updateItemRow(idx, 'details', e.target.value)}
                        rows={row.details.includes('\n') ? 3 : 1}
                        placeholder="Details (optional) — printed under the item, one per line, e.g. Total 1 year warranty"
                        style={{ ...sheetInput, marginTop: 4, fontSize: 12, resize: 'vertical', minHeight: 32 }}
                      />
                      {rowErr && (
                        <p style={fieldErrorTextStyle}>
                          {[rowErr.description, rowErr.quantity, rowErr.unit_price, rowErr.gst_percent].filter(Boolean).join(' ')}
                        </p>
                      )}
                    </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={addItemRow} style={sheetBtn('secondary', SHEET.INK)}><SheetIcon name="plus" size={15} />Add Line Item</button>
                </div>
                {fieldErrors.items && <p style={fieldErrorTextStyle}>{fieldErrors.items}</p>}
                {isLumpSum && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
                    <SF label={<>Total Price ({currencySymbol}) <Req /></>} tourId="quot-lump-sum-price">
                      <input type="number" min={0} value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} placeholder="Price for the whole offer, before GST" style={{ ...sheetInput, ...errInputStyle(!!fieldErrors.price) }} />
                      {fieldErrors.price && <p style={fieldErrorTextStyle}>{fieldErrors.price}</p>}
                    </SF>
                    {!isExport && (
                      <SF label="GST %" tourId="quot-lump-sum-gst">
                        <input type="number" min={0} max={100} value={form.lump_sum_gst_percent} onChange={(e) => setForm((f) => ({ ...f, lump_sum_gst_percent: e.target.value }))} placeholder="e.g. 18" style={{ ...sheetInput, ...errInputStyle(!!fieldErrors.lump_sum_gst_percent) }} />
                        {fieldErrors.lump_sum_gst_percent && <p style={fieldErrorTextStyle}>{fieldErrors.lump_sum_gst_percent}</p>}
                      </SF>
                    )}
                  </div>
                )}
                {discountAmount > 0 && (
                  <p style={{ marginTop: 10, fontSize: 12.5, color: '#57534e', textAlign: 'right' }}>
                    Discount ({form.discount_type === 'percent' ? `${form.discount}%` : `${currencySymbol}${form.discount}`}): -{currencySymbol}{discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                )}
                <p style={{ marginTop: discountAmount > 0 ? 2 : 10, fontSize: 13.5, fontWeight: 700, color: '#1f1108', textAlign: 'right' }}>
                  Grand Total: {currencySymbol}{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              </SheetSection>

              <SheetSection icon="truck" title="Terms">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <SF label={<>Delivery Time <Req /></>} tourId="quot-delivery-time">
                  <input value={form.delivery_time} onChange={(e) => setForm((f) => ({ ...f, delivery_time: e.target.value }))} placeholder="e.g. 7 days or 2 weeks" style={{ ...sheetInput, ...errInputStyle(!!fieldErrors.delivery_time) }} />
                  {fieldErrors.delivery_time && <p style={fieldErrorTextStyle}>{fieldErrors.delivery_time}</p>}
                </SF>
                <SF label={<>Quote Validity Date <Req /></>} tourId="quot-valid-until">
                  <DateField value={form.valid_until} onChange={(v) => setForm((f) => ({ ...f, valid_until: v }))} style={errInputStyle(!!fieldErrors.valid_until)} />
                  {fieldErrors.valid_until && <p style={fieldErrorTextStyle}>{fieldErrors.valid_until}</p>}
                </SF>
                {!isLumpSum && <SF label="Discount" tourId="quot-discount">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="number" min={0} value={form.discount} onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))} placeholder="0" style={{ ...sheetInput, ...errInputStyle(!!fieldErrors.discount) }} />
                    <select value={form.discount_type} onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value }))} style={{ ...sheetInput, width: 90, flex: '0 0 90px' }}>
                      <option value="percent">%</option>
                      <option value="flat">{isExport ? 'USD' : 'INR'}</option>
                    </select>
                  </div>
                  {fieldErrors.discount && <p style={fieldErrorTextStyle}>{fieldErrors.discount}</p>}
                </SF>}
                <SF label={isLumpSum ? 'Quote Conditions (not printed on a Commercial Offer)' : <>Quote Conditions <Req /></>} tourId="quot-conditions">
                  <select value={form.quote_conditions} onChange={(e) => setForm((f) => ({ ...f, quote_conditions: e.target.value }))} style={{ ...sheetInput, ...errInputStyle(!!fieldErrors.quote_conditions) }}>
                    <option value="">— Select —</option>
                    {QUOTE_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {fieldErrors.quote_conditions && <p style={fieldErrorTextStyle}>{fieldErrors.quote_conditions}</p>}
                </SF>
              </div>
              {form.quote_conditions === 'Other/Custom' && (
                <SF label="Custom Quote Conditions">
                  <textarea value={form.quote_conditions_custom} onChange={(e) => setForm((f) => ({ ...f, quote_conditions_custom: e.target.value }))} rows={2} placeholder="e.g. Prices are ex-works; freight and insurance extra." style={{ ...sheetInput, resize: 'vertical', ...errInputStyle(!!fieldErrors.quote_conditions) }} />
                </SF>
              )}
              <SF label={<>Payment Terms <Req /></>} tourId="quot-payment-terms">
                <ComboBox
                  value={form.payment_terms}
                  onChange={(v) => setForm((f) => ({ ...f, payment_terms: v }))}
                  onPick={(o) => { const t = paymentTerms.find((pt) => String(pt.id) === o.key); setForm((f) => ({ ...f, payment_terms: t ? (t.description || t.label) : o.label })) }}
                  onCreateNew={(query) => createPaymentTermFromField(query)}
                  createLabel="New Payment Term"
                  options={paymentTerms.map((t) => ({ key: String(t.id), label: t.label, sublabel: t.description || undefined }))}
                  placeholder="Select from Payment Terms list or type your own"
                />
                {fieldErrors.payment_terms && <p style={fieldErrorTextStyle}>{fieldErrors.payment_terms}</p>}
              </SF>
              <SF label="Notes" tourId="quot-notes"><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Any additional remarks for this quotation (optional)" style={{ ...sheetInput, resize: 'vertical' }} /></SF>
              </div>
              </SheetSection>
            </form>
            </FormSheet>
          )}
        </div>
      )}
      {quotations.length === 0 ? (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>No quotations yet.</p>
      ) : (
        quotations.map((q, qIdx) => (
          <div key={q.id} data-tour={qIdx === 0 ? 'quot-card' : undefined} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: 0 }}>
                  {q.quot_number} · {q.quotation_type}
                </p>
                {(quotRevisions[q.id]?.length || 0) > 0 && (
                  <RevisionSelector
                    revisions={quotRevisions[q.id]}
                    selectedId={selectedQuotRev[q.id] ?? null}
                    onSelect={(id) => setSelectedQuotRev((m) => ({ ...m, [q.id]: id }))}
                  />
                )}
              </div>
              {selectedQuotRev[q.id] != null && (() => {
                const rev = quotRevisions[q.id]?.find((r) => r.id === selectedQuotRev[q.id])
                if (!rev) return null
                return (
                  <div style={{ marginBottom: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,122,69,0.06)', border: '1px dashed rgba(255,122,69,0.3)' }}>
                    {rev.changes.map((c, i) => (
                      <p key={i} style={{ fontSize: 12, margin: i === 0 ? 0 : '2px 0 0', whiteSpace: 'pre-line' }}>
                        <strong>{quotationRevisionFieldLabel(c.field)}:</strong>{' '}
                        <span style={{ color: '#b91c1c', textDecoration: 'line-through' }}>{c.old == null || String(c.old).trim() === '' ? '(empty)' : String(c.old)}</span>
                        {' → '}
                        <span style={{ color: '#166534', fontWeight: 600 }}>{c.new == null || String(c.new).trim() === '' ? '(empty)' : String(c.new)}</span>
                      </p>
                    ))}
                  </div>
                )
              })()}
              <p style={{ fontSize: 12.5, color: '#57534e', margin: 0, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {q.client_name || '—'} · {q.delivery_time || '—'}
                {q.valid_until && ` · Valid: ${q.valid_until}`}{q.submitted_date && ` · Submitted: ${q.submitted_date}`}
                {seeQuotePrices && q.discount != null && ` · Discount: ${q.discount_type === 'flat' ? (q.quotation_type === 'Export' ? 'USD ' : 'INR ') : ''}${q.discount}${q.discount_type === 'flat' ? '' : '%'}`}
              </p>
              <QuotationStatusBar inquiryId={inquiryId} quot={q} canModify={canModify} canSubmit={ownerOrAdmin && canFeature('crm', 'inquiries_tenders', 'quotations', 'submit')} onChanged={load} tour={qIdx === 0} />
              {q.quote_conditions && <p style={{ fontSize: 12, color: '#57534e', margin: '2px 0 0' }}>Conditions: {q.quote_conditions}</p>}
              {q.client_contact_name && (
                <p style={{ fontSize: 12, color: '#57534e', margin: '2px 0 0' }}>
                  Contact: {q.client_contact_name}{q.client_contact_email && ` · ${q.client_contact_email}`}{q.client_contact_phone && ` · ${q.client_contact_phone}`}
                </p>
              )}
              {q.pricing_mode === 'lumpsum' && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  <ol style={{ margin: 0, paddingLeft: 18, color: '#1f1108' }}>
                    {q.items.map((it: QuotationLineItem) => (
                      <li key={it.id}>{it.description || '—'}{it.model_number && ` · Model - ${it.model_number}`}{it.quantity != null && ` · Qty ${it.quantity}`}{it.details && <div style={{ color: '#78716c', whiteSpace: 'pre-line' }}>{it.details}</div>}</li>
                    ))}
                  </ol>
                  {seeQuotePrices && <p style={{ margin: '6px 0 0', fontWeight: 600, color: '#1f1108' }}>
                    Total Price: {q.quotation_type === 'Export' ? '$' : '₹'}{fmtAmount(q.price)}{q.quotation_type !== 'Export' && q.lump_sum_gst_percent != null && ` + ${q.lump_sum_gst_percent}% GST`}
                  </p>}
                </div>
              )}
              {q.pricing_mode !== 'lumpsum' && q.items.length > 0 && (
                <div style={{ marginTop: 8, overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: '#78716c' }}>
                        <th style={{ textAlign: 'left', padding: '2px 10px 2px 0' }}>Description</th>
                        <th style={{ textAlign: 'left', padding: '2px 10px' }}>Model No.</th>
                        <th style={{ textAlign: 'right', padding: '2px 10px' }}>Qty</th>
                        {seeQuotePrices && <th style={{ textAlign: 'right', padding: '2px 10px' }}>Price/Unit</th>}
                        {q.quotation_type !== 'Export' && <th style={{ textAlign: 'right', padding: '2px 10px' }}>GST %</th>}
                        {seeQuotePrices && <th style={{ textAlign: 'right', padding: '2px 10px' }}>Subtotal</th>}
                        {seeQuotePrices && <th style={{ textAlign: 'right', padding: '2px 0 2px 10px' }}>Total</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {q.items.map((it: QuotationLineItem) => (
                        <tr key={it.id}>
                          <td style={{ padding: '2px 10px 2px 0' }}>{it.description || '—'}{it.details && <div style={{ color: '#78716c', whiteSpace: 'pre-line' }}>{it.details}</div>}</td>
                          <td style={{ padding: '2px 10px' }}>{it.model_number || '—'}</td>
                          <td style={{ textAlign: 'right', padding: '2px 10px' }}>{it.quantity ?? '—'}</td>
                          {seeQuotePrices && <td style={{ textAlign: 'right', padding: '2px 10px' }}>{fmtAmount(it.unit_price)}</td>}
                          {q.quotation_type !== 'Export' && <td style={{ textAlign: 'right', padding: '2px 10px' }}>{it.gst_percent ?? '—'}</td>}
                          {seeQuotePrices && <td style={{ textAlign: 'right', padding: '2px 10px' }}>{fmtAmount(it.subtotal)}</td>}
                          {seeQuotePrices && <td style={{ textAlign: 'right', padding: '2px 0 2px 10px' }}>{fmtAmount(it.total)}</td>}
                        </tr>
                      ))}
                    </tbody>
                    {seeQuotePrices && <tfoot>
                      {(() => {
                        const qItemsTotal = q.items.reduce((sum, it) => sum + (Number(it.total) || 0), 0)
                        const qDiscount = q.discount ? (q.discount_type === 'flat' ? Number(q.discount) : qItemsTotal * (Number(q.discount) / 100)) : 0
                        const span = q.quotation_type !== 'Export' ? 6 : 5
                        return (
                          <>
                            {qDiscount > 0 && (
                              <tr>
                                <td colSpan={span} style={{ textAlign: 'right', padding: '4px 10px 0 0', color: '#57534e' }}>Discount{q.discount_type === 'flat' ? '' : ` (${q.discount}%)`}</td>
                                <td style={{ textAlign: 'right', padding: '4px 0 0 10px', color: '#57534e' }}>-{fmtAmount(qDiscount)}</td>
                              </tr>
                            )}
                            <tr>
                              <td colSpan={span} style={{ textAlign: 'right', padding: '4px 10px 0 0', fontWeight: 600, color: '#1f1108' }}>Grand Total</td>
                              <td style={{ textAlign: 'right', padding: '4px 0 0 10px', fontWeight: 600, color: '#1f1108' }}>{fmtAmount(qItemsTotal - qDiscount)}</td>
                            </tr>
                          </>
                        )
                      })()}
                    </tfoot>}
                  </table>
                </div>
              )}
              {q.payment_terms && <p style={{ fontSize: 12, color: '#57534e', margin: '4px 0 0' }}>Payment: {q.payment_terms}</p>}
              {q.notes && <p style={{ fontSize: 12, color: '#57534e', margin: '2px 0 0' }}>{q.notes}</p>}
              {seeQuotePrices && <ManagedDocumentPanel entityType="crm_quotation" entityId={q.id} revision={q.revision_number} canModify={canModify && ['draft', 'submitted'].includes(q.status || 'draft')}recordLabel="quotation" downloadName={q.quot_number || `Quotation-${q.id}`} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
              {canFeature('crm', 'inquiries_tenders', 'quotations', 'print') && seeQuotePrices && <button onClick={() => downloadPdf(q)} disabled={downloadingId === q.id} data-tour={qIdx === 0 ? 'quot-download-pdf-btn' : undefined} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5, opacity: downloadingId === q.id ? 0.7 : 1 }}>
                {downloadingId === q.id ? 'Generating…' : 'Download PDF'}
              </button>}
              {/* Finalised (approved and later) quotations are locked for everyone — a new offer is + Create Quote. */}
              {canModify && ['draft', 'submitted'].includes(q.status || 'draft') && (
                <button onClick={() => startRevise(q)} data-tour={qIdx === 0 ? 'quot-revise-btn' : undefined} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5 }}>
                  Edit
                </button>
              )}
            </div>
          </div>
        ))
      )}
      <MessageDialog open={!!pdfError} variant="error" title="Download Failed" message={pdfError} onClose={() => setPdfError('')} />
      <MessageDialog open={!!tabError} variant="error" title={tabError?.title || 'Quotation Action Failed'} message={tabError?.message || ''} onClose={() => setTabError(null)} />
    </div>
  )
}

const QUOTATION_REVISION_FIELD_LABELS: Record<string, string> = {
  quotation_type: 'Quotation Type', gst_type: 'GST Type', quote_date: 'Date of Quote', technical_offer_id: 'Technical Offer',
  client_name: 'Customer/Client', client_contact_name: 'Contact Person', client_contact_email: 'Contact Email', client_contact_phone: 'Contact Phone',
  valid_until: 'Quote Validity', pricing_mode: 'Pricing', price: 'Total Price', lump_sum_gst_percent: 'GST % (lump sum)',
  delivery_time: 'Delivery Time', payment_terms: 'Payment Terms', discount: 'Discount', discount_type: 'Discount Type',
  quote_conditions: 'Quote Conditions', notes: 'Notes', items: 'Line Items',
}

function quotationRevisionFieldLabel(field: string): string {
  // Revisions saved before full revision recorded per-line price changes as item_<id>_unit_price.
  if (field.startsWith('item_') && field.endsWith('_unit_price')) return 'Price'
  return QUOTATION_REVISION_FIELD_LABELS[field] || field
}

function DocumentsTab({ inquiry, canModify }: { inquiry: Inquiry; canModify: boolean; isAdmin: boolean }) {
  const [documents, setDocuments] = useState<CrmDocument[]>([])
  const [quotations, setQuotations] = useState<QuotationItem[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [loadError, setLoadError] = useState<string | string[]>('')
  const [docSearch, setDocSearch] = useState('')

  const load = () => crmApi.listDocuments({ related_module: 'inquiry', related_id: inquiry.id })
    .then(setDocuments)
    .catch((err) => setLoadError(extractErrorMessages(err, 'Could not load the documents of this inquiry. Reload the page; if it persists, check that you still have CRM access.')))
  useEffect(() => { load() }, [inquiry.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Quotations are generated documents: listed under Internal Documents and
  // opened as their current PDF of record (Word edits included), never a stale copy.
  const { canFeature: canFeatureDocs } = useCan()
  // Their PDF is the priced offer: needs Quotations › Print and quotation prices.
  const seeQuotationDocs = canFeatureDocs('crm', 'inquiries_tenders', 'quotations', 'view')
    && canFeatureDocs('crm', 'inquiries_tenders', 'quotations', 'print') && seesQuotationPrices(canFeatureDocs)
  useEffect(() => {
    if (!seeQuotationDocs) return
    crmApi.listQuotations(inquiry.id)
      .then(setQuotations)
      .catch((err) => setLoadError(extractErrorMessages(err, 'Could not load the quotations of this inquiry for Internal Documents. Reload the page.')))
  }, [inquiry.id, seeQuotationDocs])

  const openQuotationPdf = async (q: QuotationItem) => {
    const tab = window.open('', '_blank')
    try {
      const blob = await crmApi.downloadQuotationPdf(inquiry.id, q.id)
      const url = URL.createObjectURL(blob)
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch (err) {
      tab?.close()
      setError(extractErrorMessages(err, `Could not open quotation ${q.quot_number || q.id}. You need Inquiries & Tenders › Quotations › Print (and Prices & margins) to open quotation PDFs.`))
    }
  }

  const clientDocs = documents.filter((d) => d.folder_type === 'client')
  // Sent TOR PDFs are filed as internal; R&D's reply files are listed with them.
  const internalDocs = documents.filter((d) => d.folder_type === 'internal' || d.doc_category === 'rnd_response')

  const related = { module: 'inquiry' as const, id: inquiry.id, universalId: inquiry.universal_id, orgId: inquiry.org_id }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 }}>
      <MessageDialog open={!!error} variant="error" title="Document Error" message={error} onClose={() => setError('')} />
      <MessageDialog open={!!loadError} variant="error" title="Cannot Load Documents" message={loadError} onClose={() => setLoadError('')} />
      <DocumentSearch value={docSearch} onChange={setDocSearch} />
      <CrmDocumentFolder tourId="inq-docs-client" title="Client Documents" folderType="client" docs={clientDocs} related={related} canModify={canModify} onUploaded={load} setError={setError} query={docSearch} />
      <CrmDocumentFolder tourId="inq-docs-internal" title="Internal Documents" folderType="internal" docs={internalDocs} related={related} canModify={canModify} onUploaded={load} setError={setError} query={docSearch}
        generated={(seeQuotationDocs ? quotations : []).map((q) => ({
          key: `quotation-${q.id}`,
          name: `${q.quot_number || `Quotation-${q.id}`}.pdf`,
          category: `Quotation${q.revision_number ? ` · rev ${q.revision_number}` : ''} · generated`,
          createdAt: q.created_at,
          open: () => openQuotationPdf(q),
        }))}
      />
    </div>
  )
}

function ActivitiesTab({ inquiry, org }: { inquiry: Inquiry; org: Organization | null }) {
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

  const load = () => crmApi.listActivities({ related_module: 'inquiry', related_id: inquiry.id })
    .then(setActivities)
    .catch((err) => setLoadError(extractErrorMessages(err, 'Could not load the follow-ups of this inquiry. Reload the page; if it persists, check that you still have CRM access.')))
  useEffect(() => { load() }, [inquiry.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Editing a follow-up (and its status) is creator-or-admin on the backend.
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
      <MessageDialog open={!!momError} variant="error" title="Cannot Save Follow Up" message={momError} onClose={() => setMomError('')} />
      <MessageDialog open={!!loadError} variant="error" title="Cannot Load Follow Ups" message={loadError} onClose={() => setLoadError('')} />
      <MomExportDialog
        open={showMomExport}
        onClose={() => setShowMomExport(false)}
        orgId={inquiry.org_id}
        orgName={org?.name}
        activities={activities}
        onExportDocx={(payload) => crmApi.exportInquiryMom(inquiry.id, payload)}
        onExportPdf={(payload) => crmApi.exportInquiryMomPdf(inquiry.id, payload)}
      />
      {showForm && (
        <ActivityForm
          initial={editingActivity || { org_id: inquiry.org_id, related_module: 'inquiry', related_id: inquiry.id, universal_id: inquiry.universal_id }}
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
          <div key={a.id} data-tour={idx === 0 ? 'inq-followups-list' : undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: '0 0 2px' }}>
                {a.activity_type || 'Activity'} {a.assigned_to && <span title={`Contact Person: ${a.assigned_to}`} style={{ fontWeight: 500, color: '#78716c' }}>· {a.assigned_to}</span>}
                {a.created_at && <span title={`Created: ${new Date(a.created_at).toLocaleString('en-GB')}`} style={{ fontWeight: 500, color: '#a8a29e' }}> · {new Date(a.created_at).toLocaleString('en-GB')}</span>}
              </p>
              {(a.contact_details || []).length > 0 && (
                <p style={{ fontSize: 11.5, color: '#78716c', margin: '0 0 4px' }}>
                  {a.contact_details!.map((c, i) => (
                    <span key={i}>
                      {i > 0 && ' · '}
                      {c.name}{c.designation && ` (${c.designation})`}{c.mobile && ` · ${c.mobile}`}{c.email && ` · ${c.email}`}
                    </span>
                  ))}
                </p>
              )}
              {a.mom_items?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  {a.mom_items.map((item, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#57534e' }}>
                      <span style={{ fontWeight: 600, color: '#a8a29e' }}>{i + 1}.</span> {item.observation || '—'}
                      {item.action_plan && <span> · Action Plan: {item.action_plan}</span>}
                      <span> · Responsibility: {item.responsibility || '—'}</span>
                      <span> · Target: {item.target_date || '—'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {a.remarks ? <RichText html={a.remarks} style={{ fontSize: 12, color: '#57534e' }} /> : <p style={{ fontSize: 12, color: '#57534e', margin: 0 }}>—</p>}
                  <p style={{ fontSize: 11.5, color: '#a8a29e', margin: '2px 0 0' }}>Due: {a.next_followup || 'To Be Decided'}</p>
                  {a.action_plan && (
                    <div style={{ marginTop: 2 }}>
                      <span style={{ fontSize: 12, color: '#78716c', fontWeight: 600 }}>Action Plan: </span>
                      <RichText html={a.action_plan} style={{ fontSize: 12, color: '#78716c', display: 'inline' }} />
                    </div>
                  )}
                </>
              )}
              <ActivityPhotos attachments={a.attachments} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setViewingActivity(a)} data-tour={idx === 0 ? 'activity-row-view-btn' : undefined} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5 }}>View</button>
              {canEditActivity(a) && <button onClick={() => startEdit(a)} data-tour={idx === 0 ? 'activity-row-edit-btn' : undefined} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5 }}>Edit</button>}
              {canEditActivity(a) && <ChangeStatusButton currentStatus={a.status || FOLLOW_UP_STATUSES[0]} statuses={FOLLOW_UP_STATUSES} onSelect={(s) => changeStatus(a, s)} tourId={idx === 0 ? 'inq-followup-change-status-btn' : undefined} />}
              {canFeature('crm', 'inquiries_tenders', 'followups', 'print') && <button disabled={exportingMomId === a.id} onClick={() => exportMom(a)} data-tour={idx === 0 ? 'activity-row-export-mom-btn' : undefined} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5, opacity: exportingMomId === a.id ? 0.7 : 1 }}>
                {exportingMomId === a.id ? 'Exporting…' : 'Export MoM'}
              </button>}
              {canFeature('crm', 'inquiries_tenders', 'followups', 'delete') && !!user && (user.role === 'admin' || a.created_by_id == null || a.created_by_id === user.id) && (
                <button onClick={() => setDeletingActivity(a)} data-tour={idx === 0 ? 'activity-row-delete-btn' : undefined} style={{ ...dangerBtnStyle, padding: '6px 12px', fontSize: 11.5 }}>Delete</button>
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

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={ref} data-tour={tourId} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 11.5 }}>Change Status</button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30, minWidth: 200, maxHeight: 260, overflowY: 'auto', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 16px 36px rgba(0,0,0,0.16)', padding: 6 }}>
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
        </div>
      )}
    </div>
  )
}

type TimelineEntry = {
  key: string
  kind: 'created' | 'updated' | 'deleted' | 'stage' | 'followup' | 'quotation' | 'info' | 'email' | 'email_failed'
  title: string
  detail?: string
  by?: string
  date: string | null
}

const TIMELINE_KIND_STYLE: Record<TimelineEntry['kind'], { bg: string; text: string; label: string }> = {
  created: { bg: 'rgba(34,197,94,0.12)', text: '#16a34a', label: 'Created' },
  updated: { bg: 'rgba(37,99,235,0.1)', text: '#1d4ed8', label: 'Updated' },
  deleted: { bg: 'rgba(220,38,38,0.1)', text: '#b91c1c', label: 'Deleted' },
  stage: { bg: 'rgba(139,92,246,0.12)', text: '#7c3aed', label: 'Stage' },
  followup: { bg: 'rgba(249,115,22,0.12)', text: '#c2410c', label: 'Follow Up' },
  quotation: { bg: 'rgba(234,179,8,0.14)', text: '#a16207', label: 'Quotation' },
  info: { bg: 'rgba(99,102,241,0.12)', text: '#4338ca', label: 'Info Update' },
  email: { bg: 'rgba(13,148,136,0.12)', text: '#0f766e', label: 'Email Sent' },
  email_failed: { bg: 'rgba(220,38,38,0.1)', text: '#b91c1c', label: 'Email Failed' },
}

function auditActionKind(action: string): TimelineEntry['kind'] {
  if (action === 'created') return 'created'
  if (action === 'deleted') return 'deleted'
  if (action.endsWith('_sent')) return 'email'
  if (action.endsWith('_failed')) return 'email_failed'
  return 'updated'
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
    const label = AUDIT_FIELD_LABELS[c.field] || c.field
    const oldText = c.old == null || String(c.old).trim() === '' ? '(empty)' : String(c.old)
    const newText = c.new == null || String(c.new).trim() === '' ? '(empty)' : String(c.new)
    const prefix = single ? '' : `<strong>${escapeHtml(label)}:</strong> `
    return `<div>${prefix}<span style="color:#b91c1c;text-decoration:line-through;">${escapeHtml(oldText)}</span> → <span style="color:#166534;font-weight:600;">${escapeHtml(newText)}</span></div>`
  }).join('')
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  product_category: 'Category', product: 'Product', quantity: 'Quantity',
  required_delivery_date: 'Required Delivery Date', delivery_location: 'Delivery Location',
  inspection_req: 'Inspection Requirement', warranty_req: 'Warranty Requirement', product_spec: 'Specification',
  requirement_desc: 'Requirement Summary', project_details: 'Project Details',
  railway_zone: 'Railway Zone', division: 'Division', lead_source: 'Lead Source', bd_owner: 'BD Owner',
  sales_engineer: 'Sales Engineer', status: 'Status', current_stage: 'Stage', current_status_note: 'Current Status', budget: 'Budget',
  expected_value: 'Expected Value', probability: 'Probability', expected_order_date: 'Expected Order Date',
  priority: 'Customer Requirement Priority', next_followup_date: 'Follow-up Date', followup_priority: 'Follow-up Priority',
  followup_assigned_to: 'Follow-up Assigned To', followup_remarks: 'Follow-up Remarks',
  org_id: 'Customer Organization', org_contact_id: 'Contact',
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
  s = s.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi, (token) => AUDIT_FIELD_LABELS[token.toLowerCase()] || token)
  if (!s) return summary
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function TimelineTab({ inquiryId }: { inquiryId: number }) {
  const { canFeature: canFeatureTl } = useCan()
  const seeQuotationsTl = canFeatureTl('crm', 'inquiries_tenders', 'quotations', 'view')
  const seeFollowupsTl = canFeatureTl('crm', 'inquiries_tenders', 'followups', 'view')
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null)

  useEffect(() => {
    Promise.all([
      crmApi.getInquiryAudit(inquiryId),
      crmApi.listInquiryStages(inquiryId),
      seeFollowupsTl ? crmApi.listActivities({ related_module: 'inquiry', related_id: inquiryId }) : Promise.resolve([]),
      seeQuotationsTl ? crmApi.listQuotations(inquiryId) : Promise.resolve([]),
      crmApi.getInquirySpecRevisions(inquiryId),
    ]).then(([audit, stages, activities, quotations, specRevisions]) => {
      const merged: TimelineEntry[] = [
        // Generic "updated" audit rows carry no diff detail — every real edit now produces
        // a proper Info Update entry (below) instead, so a bare "Updated: field" row with
        // nothing else to show is just noise. Only created/deleted are worth keeping here.
        ...audit
          .filter((a: { action: string }) => a.action !== 'updated')
          .map((a: { id: number; action: string; summary: string | null; performed_by: string; performed_at: string | null }) => ({
            key: `audit-${a.id}`,
            kind: auditActionKind(a.action),
            title: cleanAuditTitle(a.summary, a.performed_by) || `Inquiry ${a.action}`,
            by: a.performed_by,
            date: a.performed_at,
          })),
        ...specRevisions.map((r: SpecRevision) => ({
          key: `spec-${r.id}`,
          kind: 'info' as const,
          title: r.changes.map((c) => AUDIT_FIELD_LABELS[c.field] || c.field).join(', '),
          detail: specRevisionDetailHtml(r.changes),
          by: r.performed_by,
          date: r.performed_at,
        })),
        // "Inquiry created" is a pseudo-stage written at creation time, not a real
        // INQ_STAGES workflow stage — the audit "created" entry above already covers
        // that event, so showing it again here as a stage move is just a duplicate.
        ...stages
          .filter((s: CrmStageLogEntry) => s.stage !== 'Inquiry created')
          .map((s: CrmStageLogEntry) => ({
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
        ...quotations.map((q: QuotationItem) => ({
          key: `quotation-${q.id}`,
          kind: 'quotation' as const,
          title: `Quotation ${q.quot_number || `Rev ${q.revision_number}`} generated`,
          // q.price is blanked by the server for a user without quotation prices.
          detail: q.price != null ? `₹${q.price.toLocaleString()}${q.delivery_time ? ` · Delivery: ${q.delivery_time}` : ''}` : undefined,
          date: q.submitted_date || q.created_at || null,
        })),
      ]
      merged.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      setEntries(merged)
    })
  }, [inquiryId, seeQuotationsTl, seeFollowupsTl])

  if (entries === null) return <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>
  if (entries.length === 0) return <p style={{ fontSize: 13, color: '#a8a29e' }}>No timeline history yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e, idx) => (
        <div key={e.key} data-tour={idx === 0 ? 'inq-timeline-list' : undefined} style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: TIMELINE_KIND_STYLE[e.kind].bg, color: TIMELINE_KIND_STYLE[e.kind].text }}>
                {TIMELINE_KIND_STYLE[e.kind].label}
              </span>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: 0 }}>{e.title}</p>
            </div>
            <p style={{ fontSize: 11.5, color: '#a8a29e', margin: 0, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {e.by || 'System'} · {formatDateTime(e.date)}
            </p>
          </div>
          {e.detail && <RichText html={e.detail} style={{ fontSize: 12, color: '#57534e', margin: '2px 0' }} />}
        </div>
      ))}
    </div>
  )
}
