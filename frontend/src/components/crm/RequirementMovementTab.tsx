'use client'

import { useEffect, useState } from 'react'
import { crmApi, rndApi } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { RequirementMovement, RequirementMovementDoc } from '@/types'
import MessageDialog from '@/components/erp/MessageDialog'
import RndRequestBlock from '@/components/crm/RndRequestBlock'
import { extractErrorMessages } from '@/lib/validation'
import { primaryBtnStyle, chipBtnStyle } from '@/components/shared/ui'

const cardStyle: React.CSSProperties = {
  padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
  border: '1px solid rgba(255,255,255,.24)', boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,.08), inset 0 1px 0 rgba(255,255,255,.35)',
}
const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#a8a29e', margin: '0 0 6px' }

// Every "Send Technical Requirement to R&D" for an inquiry/tender, newest first:
// what R&D received, which documents went with it, and what changed since the
// previous send — so a re-send is never a mystery to R&D or the BD owner.
// `movements` lets R&D › Requirements pass in history it already loaded via the
// R&D endpoint — R&D users usually have no CRM access to call the CRM one.
// `sendAction` (CRM side only) puts the "Send to R&D" button right in the tab.
export interface RequirementSendAction { label: string; disabled: boolean; title: string; onClick: () => void }

// `responder` (R&D side) lets the assigned engineer — or an admin — answer the open request inline.
// `latestOnly` shows just the newest send as a card (Info / Requirement tab) and nothing when never sent.
// `latestExtra` (R&D side) goes inside that card under the request — the Technical Offer that answers it.
export default function RequirementMovementTab({ module, recordId, sentAt, movements, sendAction, responder, onChanged, latestOnly, latestExtra }: {
  module: 'inquiry' | 'tender'
  recordId: number
  sentAt?: string | null
  movements?: RequirementMovement[]
  sendAction?: RequirementSendAction
  /** R&D side. canRespond = the per-requirement "Respond to CRM" right; documents then open through the R&D access check. */
  responder?: { userId: number; isAdmin: boolean; canRespond?: boolean }
  onChanged?: () => void
  latestOnly?: boolean
  latestExtra?: React.ReactNode
}) {
  const [moves, setMoves] = useState<RequirementMovement[] | null>(movements ? [...movements].reverse() : null)
  const [error, setError] = useState<string | string[]>('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (movements) { setMoves([...movements].reverse()); return }
    const load = module === 'inquiry' ? crmApi.getInquiryRequirementMovements : crmApi.getTenderRequirementMovements
    load(recordId)
      .then((data) => setMoves([...data].reverse()))
      .catch((err) => { setMoves([]); setError(extractErrorMessages(err, 'Could not load the requirement movement history.')) })
    // sentAt changes right after a new send — reload so it shows immediately.
  }, [module, recordId, sentAt, movements, reloadKey])

  const handleResponded = () => {
    if (onChanged) onChanged()
    else setReloadKey((k) => k + 1)
  }

  const openDoc = async (doc: RequirementMovementDoc) => {
    try {
      await (responder ? rndApi.openWorkDocument(doc) : crmApi.openDocument(doc))
    } catch (err) {
      setError(extractErrorMessages(err, `Could not open "${doc.name}". It may have been deleted from the Documents tab or SharePoint.`))
    }
  }

  const shown = latestOnly ? moves?.slice(0, 1) : moves
  if (latestOnly && !moves?.length) return null

  return (
    <div data-tour="req-movement-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <MessageDialog open={!!error} variant="error" title="R&D Request" message={error} onClose={() => setError('')} />
      {sendAction && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={sendAction.onClick}
            disabled={sendAction.disabled}
            title={sendAction.title}
            data-tour="req-movement-send-btn"
            style={{ ...primaryBtnStyle, opacity: sendAction.disabled ? 0.5 : 1, cursor: sendAction.disabled ? 'not-allowed' : 'pointer' }}
          >
            {sendAction.label}
          </button>
        </div>
      )}
      {moves === null && <p style={{ fontSize: 13, color: '#78716c' }}>Loading…</p>}
      {latestOnly && <p style={{ ...sectionLabel, margin: 0 }}>Latest Technical Offer Request to R&amp;D</p>}
      {moves !== null && moves.length === 0 && !error && (
        <p style={{ fontSize: 13, color: '#a8a29e' }}>This requirement hasn&apos;t been sent to R&amp;D yet.</p>
      )}
      {shown?.map((m) => {
        const isFirst = m.sequence === 1
        const open = expanded === m.id
        return (
          <div key={`${m.id}-${m.sequence}`} style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: isFirst ? 'rgba(59,130,246,0.12)' : 'rgba(255,122,69,0.14)', color: isFirst ? '#2563eb' : '#FF7A45' }}>
                  {isFirst ? 'Initial Request' : `Re-sent #${m.sequence - 1}`}
                </span>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#1f1108', margin: 0 }}>
                  Sent to R&amp;D{m.offer_number ? ` as ${m.offer_number}` : ''}
                </p>
              </div>
              <p style={{ fontSize: 11.5, color: '#a8a29e', margin: 0, whiteSpace: 'nowrap' }}>
                {m.sent_by || 'Unknown'} · {formatDateTime(m.sent_at)}
              </p>
            </div>

            {m.legacy && (
              <p style={{ fontSize: 12, color: '#78716c', margin: '8px 0 0' }}>
                Sent before requirement history was recorded — the exact details R&amp;D received weren&apos;t captured. Every send from now on is logged here in full.
              </p>
            )}

            {!isFirst && !m.legacy && (
              <div style={{ marginTop: 10 }}>
                <p style={sectionLabel}>Changed since previous send</p>
                {m.changes.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: '#78716c', margin: 0 }}>No requirement fields changed — re-sent after other edits to the record.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {m.changes.map((c) => (
                      <div key={c.field} style={{ fontSize: 12.5, color: '#57534e' }}>
                        <strong style={{ color: '#1f1108' }}>{c.label}:</strong>{' '}
                        <span style={{ textDecoration: 'line-through', color: '#a8a29e' }}>{c.old || 'empty'}</span>
                        {' → '}
                        <span style={{ color: '#1f1108', whiteSpace: 'pre-wrap' }}>{c.new || 'empty'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {m.rnd_request && (
              <RndRequestBlock
                request={m.rnd_request}
                canRespond={!!responder && (responder.canRespond ?? true) && (responder.isAdmin || m.rnd_request.assigned_to_id == null || responder.userId === m.rnd_request.assigned_to_id)}
                onOpenDoc={openDoc}
                onResponded={handleResponded}
              />
            )}

            {latestOnly && latestExtra}

            {(m.tor_document || m.reference_documents.length > 0) && (
              <div style={{ marginTop: 10 }}>
                <p style={sectionLabel}>Documents sent</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[...(m.tor_document ? [m.tor_document] : []), ...m.reference_documents].map((d, i) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => openDoc(d)}
                      title="Open document"
                      style={chipBtnStyle(i === 0 && !!m.tor_document)}
                    >
                      📄 {d.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {m.snapshot.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : m.id)}
                  style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 600, color: '#FF7A45', cursor: 'pointer' }}
                >
                  {open ? '▾ Hide requirement as sent' : '▸ View requirement as sent'}
                </button>
                {open && (
                  <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                    {m.snapshot.map((s) => (
                      <div key={s.field} style={{ gridColumn: s.field === 'product_spec' || s.field === 'requirement_desc' || s.field === 'project_details' ? '1 / -1' : undefined }}>
                        <p style={{ ...sectionLabel, margin: '0 0 2px' }}>{s.label}</p>
                        <p style={{ fontSize: 12.5, color: s.value ? '#1f1108' : '#a8a29e', margin: 0, whiteSpace: 'pre-wrap' }}>{s.value || 'Not provided'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
