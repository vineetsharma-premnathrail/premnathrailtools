'use client'

// R&D's Technical Offer on a requirement — the formal answer to CRM's
// Technical Offer Request. "New Technical Offer" (R&D heads, and members ticked
// in R&D › Settings) creates it from the requirement and opens the
// letterhead Word template in Word Online, where it is written. The R&D head sends it to the BD team
// it; only then can CRM pick it in a quotation's "Technical Offer" field.
// A released offer is frozen — changes are a new revision (…-R1), which
// supersedes the earlier one once released.

import { useEffect, useState } from 'react'
import { rndApi } from '@/lib/api'
import { RndMyAccess, RndTechnicalOffer } from '@/types'
import { TEXT, BORDER, GLASS, SHADOWS } from '@/lib/theme'
import { formatDate, formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import ManagedDocumentPanel, { openRecordInWord } from '@/components/shared/ManagedDocumentPanel'
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle } from '@/components/shared/ui'
import { useCan } from '@/lib/permissions'

const ENTITY = 'rnd_technical_offer'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const smallBtn = (base: React.CSSProperties): React.CSSProperties => ({ ...base, padding: '6px 14px', fontSize: 12.5 })

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', released: 'Sent to BD', superseded: 'Superseded' }
const STATUS_HEX: Record<string, string> = { draft: '#D97706', released: '#16A34A', superseded: '#78716C' }

export default function RequirementTechnicalOffersTab({ source, recordId, access }: { source: 'inquiry' | 'tender'; recordId: number; access: RndMyAccess }) {
  const [offers, setOffers] = useState<RndTechnicalOffer[] | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [docKey, setDocKey] = useState(0)
  const [confirm, setConfirm] = useState<{ kind: 'release' | 'delete'; offer: RndTechnicalOffer } | null>(null)
  const [revising, setRevising] = useState<RndTechnicalOffer | null>(null)
  const [reviseReason, setReviseReason] = useState('')
  const [reviseError, setReviseError] = useState<string | string[]>('')
  const [revisingBusy, setRevisingBusy] = useState(false)
  useEscapeKey(!!revising && !revisingBusy, () => setRevising(null))

  // Preparing: R&D heads + members ticked in R&D › Settings; releasing: the R&D head.
  // On top, the role's R&D › Requirements › Technical Offers grants (create / edit / delete / approve = send to BD).
  const { canFeature } = useCan()
  const canPrepare = !!access.create_technical_offer
  const canCreate = canPrepare && canFeature('rnd', 'requirements', 'technical_offers', 'create')
  const canEdit = canPrepare && canFeature('rnd', 'requirements', 'technical_offers', 'edit')
  const canDeleteDraft = canPrepare && canFeature('rnd', 'requirements', 'technical_offers', 'delete')
  const canRelease = access.is_head && canFeature('rnd', 'requirements', 'technical_offers', 'approve')

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

  // Create from the requirement and open its Word template straight away.
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
        setError(`${offer.offer_number} was created, but Word didn't open: ${extractErrorMessages(err, 'unknown error').join(' ')} Click 'Save & Edit in Word' to try again.`)
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

  const all = offers || []
  const latest = all[0]

  return (
    <div data-tour="rnd-req-technical-offers" style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: '1 1 400px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 6px' }}>Technical Offers</p>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
            R&amp;D&apos;s technical offer to the customer for this requirement. It opens as a Word template — write it in Word, and the R&amp;D head sends it to the BD team —
            BD then picks it in the quotation. An offer sent to BD can&apos;t be edited; revise it to change anything.
          </p>
        </div>
        {canCreate && offers !== null && all.length === 0 && (
          <button data-tour="rnd-req-to-new" type="button" disabled={creating} onClick={create} style={smallBtn(primaryBtnStyle)}>{creating ? 'Opening Word…' : '+ New Technical Offer'}</button>
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
          No Technical Offer yet.{!canPrepare && ' The R&D head, or members the head allowed in R&D › Settings, create it.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {all.map((o) => {
            const hex = STATUS_HEX[o.status]
            const open = expanded === o.id
            const isDraft = o.status === 'draft'
            return (
              <div key={o.id} style={{ borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,0.55)' }}>
                <div onClick={() => setExpanded(open ? null : o.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading }}>{o.offer_number}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{STATUS_LABELS[o.status] || o.status}</span>
                  <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 200px', minWidth: 0 }}>{o.title}</span>
                  <span style={{ fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>
                    Dated {formatDate(o.offer_date)}{o.released_at ? ` · released by ${o.released_by} on ${formatDateTime(o.released_at)}` : ` · by ${o.created_by}`}
                  </span>
                  <span style={{ fontSize: 12, color: TEXT.muted }}>{open ? '▲' : '▼'}</span>
                </div>

                {open && (
                  <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${BORDER.light}` }}>
                    {o.revision_reason && <p style={{ fontSize: 12.5, color: TEXT.body, margin: '10px 0 0' }}><strong>Revision reason:</strong> {o.revision_reason}</p>}
                    {o.quoted_in.length > 0 && <p style={{ fontSize: 12.5, color: TEXT.body, margin: '10px 0 0' }}><strong>Quoted in:</strong> {o.quoted_in.join(', ')}</p>}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                      {isDraft && canEdit && (
                        <button type="button" disabled={busy === o.id} onClick={() => openWord(o)} style={smallBtn(primaryBtnStyle)}>{busy === o.id ? 'Opening…' : 'Save & Edit in Word'}</button>
                      )}
                      {isDraft && canRelease && (
                        <button data-tour="rnd-req-to-release" type="button" disabled={busy === o.id} onClick={() => setConfirm({ kind: 'release', offer: o })} style={smallBtn(primaryBtnStyle)}>Send to BD Team</button>
                      )}
                      {isDraft && canDeleteDraft && (
                        <button type="button" disabled={busy === o.id} onClick={() => setConfirm({ kind: 'delete', offer: o })} style={smallBtn(dangerBtnStyle)}>Delete draft</button>
                      )}
                      {o.status === 'released' && latest?.id === o.id && canCreate && (
                        <button type="button" disabled={busy === o.id} onClick={() => { setReviseReason(''); setReviseError(''); setRevising(o) }} style={smallBtn(secondaryBtnStyle)}>Revise</button>
                      )}
                    </div>
                    {isDraft && !access.is_head && (
                      <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>When the Word document is final, ask the R&amp;D head to send it to the BD team.</p>
                    )}

                    <ManagedDocumentPanel key={`${o.id}-${docKey}`} entityType={ENTITY} entityId={o.id} revision={0}
                      canModify={isDraft && canEdit} recordLabel="technical offer" downloadName={o.offer_number} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'release' ? `Send ${confirm.offer.offer_number} to the BD team?` : `Delete ${confirm?.offer.offer_number}?`}
        message={confirm?.kind === 'release'
          ? `The BD team is notified and can quote against it. Its Word document is frozen from now on.${all.some((x) => x.status === 'released') ? ' The offer sent earlier becomes Superseded.' : ''}`
          : 'The draft and its details are removed. This cannot be undone.'}
        confirmLabel={confirm?.kind === 'release' ? 'Send to BD Team' : 'Delete'}
        danger={confirm?.kind === 'delete'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          if (!c) return
          if (c.kind === 'release') run(c.offer.id, () => rndApi.releaseTechnicalOffer(c.offer.id), `${c.offer.offer_number} was not sent to the BD team.`)
          else run(c.offer.id, () => rndApi.deleteTechnicalOffer(c.offer.id), `${c.offer.offer_number} was not deleted.`)
        }}
      />
      {revising && (
        <FormSheet tour="rnd-req-to-revise" width={580} icon="history" title={`Revise ${revising.offer_number}`} subtitle="Creates a new draft revision from this offer."
          onClose={() => setRevising(null)} busy={revisingBusy}
          footer={<>
            <button type="button" onClick={() => setRevising(null)} disabled={revisingBusy} style={sheetBtn('secondary', SHEET.INK, revisingBusy)}>Cancel</button>
            <button type="button" disabled={revisingBusy || !reviseReason.trim()} style={sheetBtn('primary', SHEET.BLUE, revisingBusy || !reviseReason.trim())}
              onClick={async () => {
                const o = revising
                const reason = reviseReason.trim()
                if (!reason) { setReviseError('Say why it is being revised.'); return }
                setRevisingBusy(true)
                setReviseError('')
                setBusy(o.id)
                try {
                  const r = await rndApi.reviseTechnicalOffer(o.id, reason)
                  setExpanded(r.id)
                  await load()
                  setRevising(null)
                } catch (err) {
                  setReviseError(extractErrorMessages(err, `${o.offer_number} was not revised.`))
                } finally {
                  setRevisingBusy(false)
                  setBusy(null)
                }
              }}>
              <SheetIcon name="history" size={16} />{revisingBusy ? 'Saving…' : 'Create revision'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {reviseError && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {Array.isArray(reviseError) ? reviseError.join(' ') : reviseError}
              </div>
            )}
            <SheetSection icon="edit" title="Revision">
              <label style={sheetLabel}>Why is it being revised? <Req /></label>
              <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={reviseReason} onChange={(e) => setReviseReason(e.target.value)} autoFocus
                placeholder="e.g. Customer changed the gauge to MG" />
              <p style={sheetHint}>The new revision replaces this one for new quotations once the R&amp;D head sends it to the BD team.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
