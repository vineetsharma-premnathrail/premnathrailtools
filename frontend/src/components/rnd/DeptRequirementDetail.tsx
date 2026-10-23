'use client'

// One requirement R&D shared with this department, laid out like the R&D
// requirement page: header, status strip, tabs. Requirement = R&D's ask, the
// Technical Offer Request, customer / contact / CRM cards and the requirement
// itself (read-only, from CRM). Tasks & Departments, Documents and Discussion
// are the same tabs R&D works in — the department works on the requirement
// with R&D: every department's tasks, documents (each department decides who
// sees its files) and the discussion. Reply to R&D = the department's
// feasibility reply (once per request) and earlier requests.

import { useEffect, useState } from 'react'
import { FileText } from '@phosphor-icons/react'
import { useRouter } from 'next/navigation'
import { deptRequirementsApi, rndApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { DeptRequirementDetail as Detail, RndMyAccess, RndShareDepartment, RndShareResponse, RndWorkDocument } from '@/types'
import { TEXT, BORDER, GLASS, SHADOWS } from '@/lib/theme'
import { formatDate, formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { Chip, RESPONSE_HEX, shareBadge } from '@/components/rnd/RequirementDepartmentsTab'
import RequirementTasksTab from '@/components/rnd/RequirementTasksTab'
import RequirementDocumentsTab from '@/components/rnd/RequirementDocumentsTab'
import RequirementDiscussionTab from '@/components/crm/RequirementDiscussionTab'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, FileDropZone, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.heading, margin: '0 0 12px' }
const smallLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }
const WIDE_FIELDS = new Set(['Specification', 'Requirement Summary', 'Project Details'])

const TABS = ['Requirement', 'Tasks & Departments', 'Documents', 'Discussion', 'Reply to R&D'] as const
type Tab = typeof TABS[number]
// ?tab=tasks|documents|discussion|reply (e.g. from a notification) opens that tab.
const TAB_PARAMS: Record<string, Tab> = { tasks: 'Tasks & Departments', documents: 'Documents', discussion: 'Discussion', reply: 'Reply to R&D' }

const RESPONSES: { key: RndShareResponse; label: string; hint: string }[] = [
  { key: 'feasible', label: 'Feasible', hint: 'Can be built as asked.' },
  { key: 'feasible_with_changes', label: 'Feasible with changes', hint: 'Possible if something changes — say what.' },
  { key: 'not_feasible', label: 'Not feasible', hint: 'Cannot be built as asked — say why.' },
]

function Info({ label, value, wide }: { label: string; value: string | null | undefined; wide?: boolean }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <p style={smallLabel}>{label}</p>
      <p style={{ fontSize: 13, color: value ? TEXT.heading : TEXT.muted, margin: 0, whiteSpace: 'pre-wrap' }}>{value || 'Not provided'}</p>
    </div>
  )
}

export default function DeptRequirementDetail({ department, departmentLabel, shareId }: { department: RndShareDepartment; departmentLabel: string; shareId: number }) {
  const router = useRouter()
  const { user } = useAuth()
  const [data, setData] = useState<Detail | null>(null)
  const [access, setAccess] = useState<RndMyAccess | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [tab, setTab] = useState<Tab>(() => (typeof window !== 'undefined' && TAB_PARAMS[new URLSearchParams(window.location.search).get('tab') || '']) || 'Requirement')
  const [response, setResponse] = useState<RndShareResponse | ''>('')
  const [remarks, setRemarks] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  // The feasibility reply is written in a FormSheet popup.
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyError, setReplyError] = useState<string | string[]>('')
  useEscapeKey(replyOpen && !sending, () => setReplyOpen(false))

  useEffect(() => {
    deptRequirementsApi.get(department, shareId)
      .then((d) => {
        setData(d)
        setError('')
        // What I may do on the requirement itself (tasks, documents, discussion).
        return rndApi.requirementMyAccess(d.share.source, d.share.record_id).then(setAccess)
          .catch((err) => setError(extractErrorMessages(err,
            'Could not load your access to the Tasks and Documents tabs — refresh the page to try again.')))
      })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load this requirement — it may no longer be shared with your department. Refresh, or go back to the Requirements list.')))
  }, [department, shareId])

  const back = <button type="button" onClick={() => router.push(`/dashboard/${department}/requirements`)} style={secondaryBtnStyle}>← Back</button>

  if (error && !data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 13, color: '#b91c1c', margin: 0, maxWidth: 640 }}>{Array.isArray(error) ? error.join(' ') : error}</p>
        {back}
      </div>
    )
  }
  if (!data) return <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>

  const { share, requirement: req } = data
  const badge = shareBadge(share)
  const remarksNeeded = response !== '' && response !== 'feasible'
  const torDocs = data.documents.filter((d) => d.group === 'crm' && d.context === 'Technical Offer Request')

  const openFile = async (d: RndWorkDocument) => {
    try { await deptRequirementsApi.openDocument(department, d) } catch (err) { setError(extractErrorMessages(err, `Could not open "${d.name}".`)) }
  }

  const send = async () => {
    if (!response) return
    setSending(true)
    setReplyError('')
    try {
      setData(await deptRequirementsApi.respond(department, shareId, response, remarks, files))
      setFiles([])
      setReplyOpen(false)
    } catch (err) {
      setReplyError(extractErrorMessages(err, 'Could not send the reply.'))
    } finally {
      setSending(false)
    }
  }
  const openReply = () => { setTab('Reply to R&D'); setReplyError(''); setReplyOpen(true) }

  const fileLink = (d: RndWorkDocument) => (
    <a key={d.id} href="#" onClick={(e) => { e.preventDefault(); openFile(d) }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 600, color: '#FF7A45', background: 'rgba(255,122,69,0.08)', border: '1px solid rgba(255,122,69,0.3)', textDecoration: 'none' }}>
      <FileText size={12} />
      {d.name}
    </a>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#FF7A45' }}>{req.offer_number}</span>
            <span style={{ fontSize: 11, color: '#d6d3d1' }}>·</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: TEXT.muted }}>{req.source === 'inquiry' ? 'Inquiry' : 'Tender'} {req.universal_id}</span>
            {req.priority && <><span style={{ fontSize: 11, color: '#d6d3d1' }}>·</span><span style={{ fontSize: 11, fontWeight: 600, color: TEXT.muted }}>{req.priority}</span></>}
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{req.title}</h1>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '4px 0 0' }}>
            {req.organization.name || 'Unknown customer'} · shared {formatDateTime(share.shared_at)}
          </p>
        </div>
        {back}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: `${badge.hex}12`, border: `1px solid ${badge.hex}40`, fontSize: 12.5, color: TEXT.heading }}>
        <span>
          Shared with <strong>{departmentLabel}</strong> by {share.shared_by || 'R&D'}
          {' · '}{share.due_date ? <>reply by <strong>{formatDate(share.due_date)}</strong></> : 'no reply-by date'}
          {data.can_respond && ' — you can reply'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Chip {...badge} />
          {data.can_respond && share.status === 'open' && (
            <button type="button" onClick={openReply} style={{ ...secondaryBtnStyle, padding: '6px 14px' }}>Reply →</button>
          )}
        </span>
      </div>

      {req.edited_after_send && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(234,88,12,0.08)', border: '1px solid rgba(234,88,12,0.25)', color: '#9a3412', fontSize: 12.5 }}>
          CRM has edited this requirement since it was last sent to R&amp;D. The Requirement tab shows the <strong>current</strong> CRM values; check with the R&amp;D head{share.shared_by ? ` (${share.shared_by})` : ''} if the changes affect your reply.
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div className="hide-scrollbar" style={{ display: 'flex', gap: 4, marginBottom: 16, padding: 4, borderRadius: 999, background: 'rgba(0,0,0,0.05)', overflowX: 'auto', width: 'fit-content', maxWidth: '100%' }}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            data-tour={`${department}-req-tab-${t}`}
            style={{
              padding: '9px 16px', border: 'none', borderRadius: 999, whiteSpace: 'nowrap',
              background: tab === t ? '#fff' : 'transparent', boxShadow: tab === t ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
              color: tab === t ? '#FF7A45' : '#78716c', fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Requirement' && (
        <>
          <div style={sectionStyle}>
            <p style={sectionTitle}>What R&amp;D needs from {departmentLabel}</p>
            <p style={{ fontSize: 13.5, color: TEXT.heading, margin: 0, whiteSpace: 'pre-wrap' }}>{share.note}</p>
            <p style={{ fontSize: 12, color: share.is_overdue ? '#DC2626' : TEXT.muted, margin: '8px 0 0' }}>
              {share.shared_by} · {formatDateTime(share.shared_at)}{share.due_date ? ` · reply by ${formatDate(share.due_date)}${share.is_overdue ? ' — overdue' : ''}` : ''}
            </p>
          </div>

          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 8px' }}>Technical Offer Request to R&amp;D</p>
          <div style={sectionStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading }}>Sent to R&amp;D as {req.offer_number || '—'}</span>
              <span style={{ fontSize: 12, color: TEXT.muted }}>{formatDateTime(req.last_sent_at)}</span>
            </div>
            <p style={{ ...smallLabel, margin: '12px 0 6px' }}>Documents sent</p>
            {torDocs.length > 0 ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{torDocs.map(fileLink)}</div>
            ) : (
              <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No Technical Offer Request file — see the Documents tab for everything shared.</p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <div style={{ ...sectionStyle, flex: '1 1 320px' }}>
              <p style={sectionTitle}>Customer</p>
              <div style={grid}>
                <Info label="Organization" value={req.organization.name} />
                <Info label="Type" value={req.organization.type} />
                <Info label="City / State" value={[req.organization.city, req.organization.state].filter(Boolean).join(', ')} />
              </div>
              {req.contact && (
                <>
                  <p style={{ ...sectionTitle, margin: '16px 0 12px' }}>Contact Person</p>
                  <div style={grid}>
                    <Info label="Name" value={req.contact.name} />
                    <Info label="Designation" value={req.contact.designation} />
                    <Info label="Department" value={req.contact.department} />
                    <Info label="Mobile" value={req.contact.mobile} />
                    <Info label="Email" value={req.contact.email} />
                  </div>
                </>
              )}
            </div>
            <div style={{ ...sectionStyle, flex: '0 1 280px' }}>
              <p style={sectionTitle}>From CRM</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Info label="BD Owner" value={req.bd_owner} />
                <Info label="CRM Status" value={req.crm_status} />
                <Info label="Priority" value={req.priority} />
              </div>
            </div>
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitle}>{req.source === 'inquiry' ? 'Product Requirement' : 'Tender Details'}</p>
            <div style={grid}>
              {req.requirement.map((f) => <Info key={f.label} label={f.label} value={f.value} wide={WIDE_FIELDS.has(f.label)} />)}
            </div>
          </div>
        </>
      )}

      {(tab === 'Tasks & Departments' || tab === 'Documents') && !access && !error && (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      )}
      {tab === 'Tasks & Departments' && access && user && (
        <RequirementTasksTab source={share.source} recordId={share.record_id} userId={user.id} access={access} />
      )}
      {tab === 'Documents' && access && <RequirementDocumentsTab source={share.source} recordId={share.record_id} access={access} />}
      {tab === 'Discussion' && <RequirementDiscussionTab source={share.source} recordId={share.record_id} side={department} />}

      {tab === 'Reply to R&D' && (
        <>
          {share.status === 'replaced' && (
            <div style={sectionStyle}>
              <p style={{ fontSize: 13, color: TEXT.body, margin: 0 }}>R&amp;D sent a newer request for this requirement on {formatDateTime(share.replaced_at)} — reply to that one from your Requirements list. This one no longer needs a reply.</p>
            </div>
          )}

          {share.status === 'responded' && (
            <div style={{ ...sectionStyle, borderLeft: `4px solid ${badge.hex}` }}>
              <p style={sectionTitle}>{departmentLabel} reply</p>
              <p style={{ fontSize: 13, color: TEXT.body, margin: 0, whiteSpace: 'pre-wrap' }}>
                <strong style={{ color: RESPONSE_HEX[share.response || ''] }}>{share.response_label}</strong> — {share.responded_by}, {formatDateTime(share.responded_at)}
                {share.response_remarks ? <><br />{share.response_remarks}</> : null}
              </p>
              {share.files.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>{share.files.map(fileLink)}</div>}
            </div>
          )}

          {share.status === 'open' && (
            <div data-tour={`${department}-req-reply`} style={sectionStyle}>
              <p style={sectionTitle}>Your feasibility reply</p>
              {!data.can_respond ? (
                <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
                  You can read this requirement but not reply. Replying needs the &lsquo;edit&rsquo; right on {departmentLabel} › Requirements — ask an admin (Organization › Role &amp; Permissions).
                </p>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <p style={{ fontSize: 13, color: TEXT.body, margin: 0 }}>
                    Tell R&amp;D whether {departmentLabel} can build this as asked{share.due_date ? <> — reply by <strong>{formatDate(share.due_date)}</strong></> : ''}.
                  </p>
                  <button type="button" onClick={openReply} style={primaryBtnStyle}>Send feasibility reply</button>
                </div>
              )}
            </div>
          )}

          {replyOpen && share.status === 'open' && data.can_respond && (
            <FormSheet tour={`${department}-req-reply-form`} width={580} icon="send" title="Feasibility Reply" subtitle={`${departmentLabel} → R&D · ${req.offer_number || req.title}`}
              onClose={() => setReplyOpen(false)} busy={sending}
              footer={<>
                <button type="button" onClick={() => setReplyOpen(false)} disabled={sending} style={sheetBtn('secondary', SHEET.INK, sending)}>Cancel</button>
                <button type="button" onClick={send} disabled={sending || !response || (remarksNeeded && !remarks.trim())}
                  style={sheetBtn('primary', SHEET.BLUE, sending || !response || (remarksNeeded && !remarks.trim()))}>
                  <SheetIcon name="send" size={16} />{sending ? 'Sending…' : 'Send reply to R&D'}
                </button>
              </>}>
              <div style={{ padding: '20px 24px' }}>
                {replyError && (
                  <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                    {Array.isArray(replyError) ? replyError.join(' ') : replyError}
                  </div>
                )}
                <SheetSection icon="check" title="Is it feasible?">
                  <label style={sheetLabel}>Answer <Req /></label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {RESPONSES.map((r) => {
                      const on = response === r.key
                      const hex = RESPONSE_HEX[r.key]
                      return (
                        <button key={r.key} type="button" onClick={() => setResponse(r.key)} title={r.hint} style={{
                          padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                          color: on ? '#fff' : hex, background: on ? hex : `${hex}12`, border: `1px solid ${on ? hex : `${hex}55`}`,
                        }}>
                          {r.label}
                        </button>
                      )
                    })}
                  </div>
                  {response && <p style={sheetHint}>{RESPONSES.find((r) => r.key === response)?.hint}</p>}
                  <label style={{ ...sheetLabel, marginTop: 14 }}>Remarks {remarksNeeded ? <Req /> : <Optional />}</label>
                  <textarea
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    rows={4}
                    placeholder={response === 'not_feasible' ? 'Why it cannot be built as asked' : response === 'feasible_with_changes' ? 'What has to change (dimension, component, rating…)' : 'Anything R&D should know (optional)'}
                    style={{ ...sheetInput, resize: 'vertical' }}
                  />
                </SheetSection>
                <SheetSection icon="clip" title="Attachments" extra={<Optional />}>
                  <FileDropZone files={files} onChange={setFiles} />
                  <p style={sheetHint}>The reply goes to the R&amp;D head and can&apos;t be edited afterwards; if something changes, R&amp;D shares the requirement again.</p>
                </SheetSection>
              </div>
            </FormSheet>
          )}

          {data.history.length > 0 && (
            <div style={sectionStyle}>
              <p style={sectionTitle}>Earlier requests on this requirement</p>
              {data.history.map((h) => (
                <div key={h.id} style={{ padding: '8px 0', borderTop: `1px solid ${BORDER.light}`, fontSize: 12.5, color: TEXT.body }}>
                  <Chip {...shareBadge(h)} /> <span style={{ color: TEXT.muted }}>{formatDateTime(h.shared_at)} · {h.shared_by}</span>
                  <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{h.note}</p>
                  {h.response_remarks && <p style={{ margin: '4px 0 0', color: TEXT.muted, whiteSpace: 'pre-wrap' }}>Reply: {h.response_remarks}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
