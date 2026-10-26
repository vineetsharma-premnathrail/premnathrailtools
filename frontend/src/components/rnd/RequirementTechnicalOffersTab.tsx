'use client'

// R&D's Technical Offer on a requirement — the formal answer to CRM's
// Technical Offer Request. Maker-checker:
//   "Create Technical Offer" (R&D heads, and people with R&D › Requirements › Technical Offer team › Create)
//   creates it from the requirement and opens the letterhead Word template →
//   the creator writes it in Word → "Send to R&D Head" freezes it → the R&D
//   head approves it to the BD team (CRM can then quote it) or returns it for
//   changes. After that it never changes: a creator "Asks for revision", and
//   once the R&D head approves, a new revision (…-R1) opens for editing.
// `embedded` renders it inside the "Latest Technical Offer Request" card.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { rndApi, managedDocumentsApi } from '@/lib/api'
import { RndMyAccess, RndTechnicalOffer } from '@/types'
import { TEXT, BORDER, GLASS, SHADOWS } from '@/lib/theme'
import { formatDate, formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import ManagedDocumentPanel, { openRecordInWord } from '@/components/shared/ManagedDocumentPanel'
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, smallBtnSize, pillStyle } from '@/components/shared/ui'
import { useCan } from '@/lib/permissions'

const ENTITY = 'rnd_technical_offer'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const embeddedStyle: React.CSSProperties = { marginTop: 12, paddingTop: 12, borderTop: '1px dashed rgba(0,0,0,0.1)' }
const smallBtn = (base: React.CSSProperties): React.CSSProperties => ({ ...base, ...smallBtnSize })
const note = (hex: string): React.CSSProperties => ({ fontSize: 12.5, color: TEXT.body, margin: '10px 0 0', padding: '8px 12px', borderRadius: 8, background: `${hex}12`, border: `1px solid ${hex}33` })

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', submitted: 'Awaiting R&D head', released: 'Sent to BD', superseded: 'Superseded' }
const STATUS_HEX: Record<string, string> = { draft: '#D97706', submitted: '#2563EB', released: '#16A34A', superseded: '#78716C' }

type ReasonKind = 'revise' | 'request' | 'return' | 'decline'
const REASON_SHEET: Record<ReasonKind, { title: string; subtitle: string; label: string; button: string; hint: string; placeholder: string }> = {
  revise: { title: 'Revise', subtitle: 'Opens a new draft revision copied from this offer.', label: 'Why is it being revised?', button: 'Create revision', hint: 'The new revision replaces this one for new quotations once it is approved to the BD team.', placeholder: 'e.g. Customer changed the gauge to MG' },
  request: { title: 'Ask for revision of', subtitle: 'The R&D head approves or declines. Once approved, a new revision opens for you to edit.', label: 'What must change, and why?', button: 'Ask R&D head', hint: 'This offer stays as sent to BD until the revision is approved.', placeholder: 'e.g. Customer asked for 25 t axle load' },
  return: { title: 'Return for changes', subtitle: 'Sends it back to draft so the creator can correct it.', label: 'What must be changed?', button: 'Return to draft', hint: 'The creator is notified and sees this on the offer.', placeholder: 'e.g. Add the deviation on wheel diameter' },
  decline: { title: 'Decline revision of', subtitle: 'The offer stays as sent to BD.', label: 'Why is the revision declined?', button: 'Decline', hint: 'The requester is notified with this reason.', placeholder: 'e.g. Already covered by clause 4.2' },
}

export default function RequirementTechnicalOffersTab({ source, recordId, access, embedded }: { source: 'inquiry' | 'tender'; recordId: number; access: RndMyAccess; embedded?: boolean }) {
  const [offers, setOffers] = useState<RndTechnicalOffer[] | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [docKey, setDocKey] = useState(0)
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'release' | 'submit' | 'delete' | 'approve_revision'; offer: RndTechnicalOffer } | null>(null)
  const [reasonFor, setReasonFor] = useState<{ kind: ReasonKind; offer: RndTechnicalOffer } | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | string[]>('')
  const [reasonBusy, setReasonBusy] = useState(false)
  useEscapeKey(!!reasonFor && !reasonBusy, () => setReasonFor(null))

  // Preparing: R&D heads + Technical Offer team › Create (Role & Permissions); approving: the R&D head.
  // On top, the role's R&D › Requirements › Technical Offers grants (create / edit / delete / approve).
  const { canFeature } = useCan()
  const isHead = !!access.is_head
  const canPrepare = !!access.create_technical_offer
  const canCreate = canPrepare && canFeature('rnd', 'requirements', 'technical_offers', 'create')
  const canEdit = canPrepare && canFeature('rnd', 'requirements', 'technical_offers', 'edit')
  const canDeleteDraft = canPrepare && canFeature('rnd', 'requirements', 'technical_offers', 'delete')
  const canApprove = isHead && canFeature('rnd', 'requirements', 'technical_offers', 'approve')

  const load = () => rndApi.listTechnicalOffers(source, recordId)
    .then((rows) => { setOffers(rows); setExpanded((cur) => cur ?? rows[0]?.id ?? null) })
    .catch((err) => { setOffers([]); setError(extractErrorMessages(err, 'Could not load the Technical Offers. Refresh the page; if it persists, check your connection.')) })
  useEffect(() => { load() }, [source, recordId]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (offerId: number | null, action: () => Promise<unknown>, fallback: string) => {
    setError('')
    setBusy(offerId)
    try {
      await action()
      await load()
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    } finally {
      setBusy(null)
    }
  }

  // Create from the requirement and open its letterhead Word template straight away.
  const create = async () => {
    setError('')
    setCreating(true)
    const tab = window.open('', '_blank')
    try {
      const offer = await rndApi.createTechnicalOffer(source, recordId)
      setExpanded(offer.id)
      await load()
      if (offer.word_error) {
        tab?.close()
        setError(`${offer.offer_number} was created, but its Word template wasn't: ${offer.word_error}`)
        return
      }
      try {
        await openRecordInWord(ENTITY, offer.id, tab)
        setTimeout(() => setDocKey((k) => k + 1), 1500)
      } catch (err) {
        setError(`${offer.offer_number} was created, but Word didn't open: ${extractErrorMessages(err, 'unknown error').join(' ')} Click 'Edit in Word' to try again.`)
      }
    } catch (err) {
      tab?.close()
      setError(extractErrorMessages(err, 'The Technical Offer was not created.'))
    } finally {
      setCreating(false)
    }
  }
  const openWord = (offer: RndTechnicalOffer) => {
    setError('')
    setBusy(offer.id)
    const tab = window.open('', '_blank')
    openRecordInWord(ENTITY, offer.id, tab)
      .then(() => setTimeout(() => setDocKey((k) => k + 1), 1500))
      .catch((err) => setError(`Could not open ${offer.offer_number} in Word: ${extractErrorMessages(err, 'unknown error').join(' ')}`))
      .finally(() => setBusy(null))
  }

  const submitReason = async () => {
    if (!reasonFor) return
    const { kind, offer } = reasonFor
    const text = reason.trim()
    if (!text) { setReasonError('Write the reason first.'); return }
    setReasonBusy(true)
    setReasonError('')
    setBusy(offer.id)
    try {
      const r = kind === 'revise' ? await rndApi.reviseTechnicalOffer(offer.id, text)
        : kind === 'request' ? await rndApi.requestTechnicalOfferRevision(offer.id, text)
        : kind === 'return' ? await rndApi.returnTechnicalOffer(offer.id, text)
        : await rndApi.decideTechnicalOfferRevision(offer.id, false, text)
      setExpanded(r.id)
      await load()
      setReasonFor(null)
    } catch (err) {
      setReasonError(extractErrorMessages(err, `${offer.offer_number}: the request did not go through.`))
    } finally {
      setReasonBusy(false)
      setBusy(null)
    }
  }
  const askReason = (kind: ReasonKind, offer: RndTechnicalOffer) => { setReason(''); setReasonError(''); setReasonFor({ kind, offer }) }

  const downloadDocx = (offer: RndTechnicalOffer) => run(offer.id, async () => {
    const blob = await managedDocumentsApi.downloadDocx(ENTITY, offer.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${offer.offer_number}.docx`
    a.click()
    URL.revokeObjectURL(url)
  }, `Could not download ${offer.offer_number}. Make sure it was opened in Word at least once, then try again.`)

  const all = offers || []
  const latest = all[0]
  // Embedded in the TOR card: the current offer only (history stays one click away).
  const shown = embedded ? all.slice(0, 1) : all

  const dialogs = (
    <>
      <ConfirmDialog
        open={!!confirm}
        title={!confirm ? '' : confirm.kind === 'release' ? `Approve ${confirm.offer.offer_number} and send it to the BD team?`
          : confirm.kind === 'submit' ? `Send ${confirm.offer.offer_number} to the R&D head?`
          : confirm.kind === 'approve_revision' ? `Approve the revision of ${confirm.offer.offer_number}?`
          : `Delete ${confirm.offer.offer_number}?`}
        message={!confirm ? '' : confirm.kind === 'release'
          ? `The BD team is notified and can quote against it. It is locked from now on.${all.some((x) => x.status === 'released') ? ' The offer sent earlier becomes Superseded.' : ''}`
          : confirm.kind === 'submit' ? 'It is locked while the R&D head reviews it. The head approves it to the BD team or returns it to you for changes.'
          : confirm.kind === 'approve_revision' ? `A new draft revision opens for ${confirm.offer.revision_request?.requested_by || 'the requester'} to edit. ${confirm.offer.offer_number} stays with BD until the new revision is approved.`
          : 'The draft and its details are removed. This cannot be undone.'}
        confirmLabel={!confirm ? '' : confirm.kind === 'release' ? 'Approve & Send' : confirm.kind === 'submit' ? 'Send to R&D Head' : confirm.kind === 'approve_revision' ? 'Approve revision' : 'Delete'}
        danger={confirm?.kind === 'delete'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          if (!c) return
          if (c.kind === 'release') run(c.offer.id, () => rndApi.releaseTechnicalOffer(c.offer.id), `${c.offer.offer_number} was not sent to the BD team.`)
          else if (c.kind === 'submit') run(c.offer.id, () => rndApi.submitTechnicalOffer(c.offer.id), `${c.offer.offer_number} was not sent to the R&D head.`)
          else if (c.kind === 'approve_revision') run(c.offer.id, async () => { const r = await rndApi.decideTechnicalOfferRevision(c.offer.id, true); setExpanded(r.id) }, `The revision of ${c.offer.offer_number} was not approved.`)
          else run(c.offer.id, () => rndApi.deleteTechnicalOffer(c.offer.id), `${c.offer.offer_number} was not deleted.`)
        }}
      />
      {reasonFor && (() => {
        const cfg = REASON_SHEET[reasonFor.kind]
        const title = reasonFor.kind === 'return' ? `${cfg.title} — ${reasonFor.offer.offer_number}` : `${cfg.title} ${reasonFor.offer.offer_number}`
        return (
          <FormSheet tour="rnd-req-to-reason" width={580} icon="history" title={title} subtitle={cfg.subtitle}
            onClose={() => setReasonFor(null)} busy={reasonBusy}
            footer={<>
              <button type="button" onClick={() => setReasonFor(null)} disabled={reasonBusy} style={sheetBtn('secondary', SHEET.INK, reasonBusy)}>Cancel</button>
              <button type="button" disabled={reasonBusy || !reason.trim()} onClick={submitReason} style={sheetBtn('primary', SHEET.BLUE, reasonBusy || !reason.trim())}>
                <SheetIcon name="history" size={16} />{reasonBusy ? 'Saving…' : cfg.button}
              </button>
            </>}>
            <div style={{ padding: '20px 24px' }}>
              {reasonError && (
                <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                  {Array.isArray(reasonError) ? reasonError.join(' ') : reasonError}
                </div>
              )}
              <SheetSection icon="edit" title="Reason">
                <label style={sheetLabel}>{cfg.label} <Req /></label>
                <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder={cfg.placeholder} />
                <p style={sheetHint}>{cfg.hint}</p>
              </SheetSection>
            </div>
          </FormSheet>
        )
      })()}
    </>
  )

  // Embedded in the TOR card: just one button. Before an offer exists it creates one and
  // opens the letterhead template in Word; after that it opens a menu (edit / download / send …).
  if (embedded) {
    if (offers === null) return null
    const o = latest
    if (!o && !canCreate) return null
    const items: { label: string; onClick: () => void; danger?: boolean; tour?: string }[] = []
    if (o) {
      const isDraft = o.status === 'draft'
      const isLatestReleased = o.status === 'released'
      const rr = o.revision_request
      if (isDraft && canEdit) items.push({ label: 'Edit in Word', onClick: () => openWord(o) })
      items.push({ label: 'Download .docx', onClick: () => downloadDocx(o) })
      if (isDraft && canApprove) items.push({ label: 'Approve & Send to BD', tour: 'rnd-req-to-release', onClick: () => setConfirm({ kind: 'release', offer: o }) })
      if (isDraft && !isHead && canEdit) items.push({ label: 'Send to R&D Head', tour: 'rnd-req-to-submit', onClick: () => setConfirm({ kind: 'submit', offer: o }) })
      if (o.status === 'submitted' && canApprove) {
        items.push({ label: 'Approve & Send to BD', onClick: () => setConfirm({ kind: 'release', offer: o }) })
        items.push({ label: 'Return for changes', onClick: () => askReason('return', o) })
      }
      if (isLatestReleased && rr && canApprove) {
        items.push({ label: 'Approve revision', onClick: () => setConfirm({ kind: 'approve_revision', offer: o }) })
        items.push({ label: 'Decline revision', onClick: () => askReason('decline', o) })
      }
      if (isLatestReleased && !rr && isHead && canCreate) items.push({ label: 'Revise', onClick: () => askReason('revise', o) })
      if (isLatestReleased && !rr && !isHead && canCreate) items.push({ label: 'Ask for revision', tour: 'rnd-req-to-ask-revision', onClick: () => askReason('request', o) })
      if (isDraft && canDeleteDraft) items.push({ label: 'Delete draft', danger: true, onClick: () => setConfirm({ kind: 'delete', offer: o }) })
    }
    const hex = o ? STATUS_HEX[o.status] : SHEET.BLUE
    return (
      <div data-tour="rnd-req-technical-offers" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        {o ? (
          <button type="button" disabled={busy === o.id}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { top: r.bottom + 6, right: window.innerWidth - r.right }) }}
            style={sheetBtn('primary', SHEET.BLUE, busy === o.id)}>
            <SheetIcon name="doc" size={15} />
            {busy === o.id ? 'Working…' : <>Technical Offer {o.offer_number}</>}
            <span style={{ ...pillStyle(hex), fontSize: 10.5, padding: '2px 8px', background: '#fff', marginLeft: 4 }}>{STATUS_LABELS[o.status] || o.status}</span>
            <span style={{ fontSize: 10, marginLeft: 2 }}>▾</span>
          </button>
        ) : (
          <button data-tour="rnd-req-to-new" type="button" disabled={creating} onClick={create} style={sheetBtn('primary', SHEET.BLUE, creating)}>
            <SheetIcon name="doc" size={15} />{creating ? 'Opening Word…' : 'Create Technical Offer'}
          </button>
        )}
        {o?.status === 'draft' && o.returned_reason && <p style={{ ...note('#D97706'), margin: 0 }}><strong>Returned by the R&amp;D head:</strong> {o.returned_reason}</p>}
        {o?.revision_request && o.status === 'released' && (
          <p style={{ ...note('#7C3AED'), margin: 0 }}><strong>Revision asked by {o.revision_request.requested_by}:</strong> {o.revision_request.reason}</p>
        )}
        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13, alignSelf: 'stretch' }}>
            {Array.isArray(error) ? error.join(' ') : error}
          </div>
        )}
        {menu && o && createPortal(
          <>
            <div onClick={() => setMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
            <div style={{ position: 'fixed', top: menu.top, right: menu.right, zIndex: 9999, minWidth: 220, padding: 6, borderRadius: 12, background: '#fff', border: `1px solid ${BORDER.light}`, boxShadow: '0 12px 32px rgba(0,0,0,0.16)' }}>
              {items.map((it) => (
                <button key={it.label} data-tour={it.tour} type="button" onClick={() => { setMenu(null); it.onClick() }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: it.danger ? '#b91c1c' : TEXT.heading }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.05)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
                  {it.label}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
        {dialogs}
      </div>
    )
  }

  return (
    <div data-tour="rnd-req-technical-offers" style={embedded ? embeddedStyle : sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ flex: '1 1 380px' }}>
          <p style={{ fontSize: embedded ? 11 : 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: embedded ? '#a8a29e' : TEXT.secondary, margin: '0 0 4px' }}>
            Technical Offer
          </p>
          {(!embedded || all.length === 0) && (
            <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
              R&amp;D&apos;s answer to this request, written in Word on the Premnath letterhead. Send it to the R&amp;D head; once approved it goes to the BD team and is locked —
              changes after that need an approved revision.
            </p>
          )}
        </div>
        {canCreate && offers !== null && all.length === 0 && (
          <button data-tour="rnd-req-to-new" type="button" disabled={creating} onClick={create} style={sheetBtn('primary', SHEET.BLUE, creating)}>
            <SheetIcon name="doc" size={15} />{creating ? 'Opening Word…' : 'Create Technical Offer'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {offers === null ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : all.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
          No Technical Offer yet.{!canPrepare && ' The R&D head, or people given the Technical Offer team permission in Organization › Role & Permissions, create it.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map((o) => {
            const hex = STATUS_HEX[o.status]
            const open = embedded || expanded === o.id
            const isDraft = o.status === 'draft'
            const isLatestReleased = o.status === 'released' && latest?.id === o.id
            const rr = o.revision_request
            return (
              <div key={o.id} style={{ borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,0.55)' }}>
                <div onClick={embedded ? undefined : () => setExpanded(open ? null : o.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: embedded ? 'default' : 'pointer', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading }}>{o.offer_number}</span>
                  <span style={pillStyle(hex)}>{STATUS_LABELS[o.status] || o.status}</span>
                  {o.status !== 'draft' && <span title="Locked — no edits" style={{ fontSize: 12 }}>🔒</span>}
                  <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 200px', minWidth: 0 }}>{o.title}</span>
                  <span style={{ fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>
                    Dated {formatDate(o.offer_date)}
                    {o.released_at ? ` · approved by ${o.released_by} on ${formatDateTime(o.released_at)}`
                      : o.status === 'submitted' && o.submitted_at ? ` · sent by ${o.submitted_by} on ${formatDateTime(o.submitted_at)}` : ` · by ${o.created_by}`}
                  </span>
                  {!embedded && <span style={{ fontSize: 12, color: TEXT.muted }}>{open ? '▲' : '▼'}</span>}
                </div>

                {open && (
                  <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${BORDER.light}` }}>
                    {o.revision_reason && <p style={{ fontSize: 12.5, color: TEXT.body, margin: '10px 0 0' }}><strong>Revision reason:</strong> {o.revision_reason}</p>}
                    {o.quoted_in.length > 0 && <p style={{ fontSize: 12.5, color: TEXT.body, margin: '10px 0 0' }}><strong>Quoted in:</strong> {o.quoted_in.join(', ')}</p>}
                    {isDraft && o.returned_reason && <p style={note('#D97706')}><strong>Returned by the R&amp;D head:</strong> {o.returned_reason}</p>}
                    {o.status === 'submitted' && <p style={note('#2563EB')}>Locked — waiting for the R&amp;D head to approve it to the BD team{isHead ? '' : ', or return it for changes'}.</p>}
                    {isLatestReleased && rr && (
                      <p style={note('#7C3AED')}><strong>Revision asked by {rr.requested_by}</strong>{rr.requested_at ? ` on ${formatDateTime(rr.requested_at)}` : ''}: {rr.reason}
                        {!isHead && <> — waiting for the R&amp;D head.</>}</p>
                    )}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                      {isDraft && canEdit && (
                        <button type="button" disabled={busy === o.id} onClick={() => openWord(o)} style={smallBtn(secondaryBtnStyle)}>{busy === o.id ? 'Opening…' : 'Edit in Word'}</button>
                      )}
                      {isDraft && canApprove && (
                        <button data-tour="rnd-req-to-release" type="button" disabled={busy === o.id} onClick={() => setConfirm({ kind: 'release', offer: o })} style={smallBtn(primaryBtnStyle)}>Approve &amp; Send to BD</button>
                      )}
                      {isDraft && !isHead && canEdit && (
                        <button data-tour="rnd-req-to-submit" type="button" disabled={busy === o.id} onClick={() => setConfirm({ kind: 'submit', offer: o })} style={smallBtn(primaryBtnStyle)}>Send to R&amp;D Head</button>
                      )}
                      {o.status === 'submitted' && canApprove && (<>
                        <button type="button" disabled={busy === o.id} onClick={() => setConfirm({ kind: 'release', offer: o })} style={smallBtn(primaryBtnStyle)}>Approve &amp; Send to BD</button>
                        <button type="button" disabled={busy === o.id} onClick={() => askReason('return', o)} style={smallBtn(secondaryBtnStyle)}>Return for changes</button>
                      </>)}
                      {isDraft && canDeleteDraft && (
                        <button type="button" disabled={busy === o.id} onClick={() => setConfirm({ kind: 'delete', offer: o })} style={smallBtn(dangerBtnStyle)}>Delete draft</button>
                      )}
                      {isLatestReleased && rr && canApprove && (<>
                        <button type="button" disabled={busy === o.id} onClick={() => setConfirm({ kind: 'approve_revision', offer: o })} style={smallBtn(primaryBtnStyle)}>Approve revision</button>
                        <button type="button" disabled={busy === o.id} onClick={() => askReason('decline', o)} style={smallBtn(secondaryBtnStyle)}>Decline</button>
                      </>)}
                      {isLatestReleased && !rr && isHead && canCreate && (
                        <button type="button" disabled={busy === o.id} onClick={() => askReason('revise', o)} style={smallBtn(secondaryBtnStyle)}>Revise</button>
                      )}
                      {isLatestReleased && !rr && !isHead && canCreate && (
                        <button data-tour="rnd-req-to-ask-revision" type="button" disabled={busy === o.id} onClick={() => askReason('request', o)} style={smallBtn(secondaryBtnStyle)}>Ask for revision</button>
                      )}
                    </div>

                    <ManagedDocumentPanel key={`${o.id}-${docKey}`} entityType={ENTITY} entityId={o.id} revision={0}
                      canModify={isDraft && canEdit} recordLabel="technical offer" downloadName={o.offer_number} />
                  </div>
                )}
              </div>
            )
          })}
          {embedded && all.length > 1 && (
            <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>Earlier revisions: {all.slice(1).map((o) => `${o.offer_number} (${STATUS_LABELS[o.status] || o.status})`).join(', ')}.</p>
          )}
        </div>
      )}

      {dialogs}
    </div>
  )
}
