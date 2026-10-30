'use client'

// R&D's Technical Offer on a requirement — uploaded, never created in the portal.
// Maker-checker: R&D heads, and people with R&D › Requirements › Technical Offers ›
// Create (and Technical Offer team), upload the Word / PDF file once R&D has
// accepted the requirement → it is "Pending release" → the R&D head releases it
// to the BD team (CRM can then quote it) or returns it with a reason, and the
// uploader uploads a corrected file. A released offer never changes: a corrected
// file is a new revision (…-R1) that supersedes it once released.

import { useEffect, useState } from 'react'
import { rndApi } from '@/lib/api'
import { RndMyAccess } from '@/types'
import { TEXT, BORDER, GLASS, SHADOWS } from '@/lib/theme'
import { formatDate, formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { SheetIcon, sheetBtn, SHEET } from '@/components/shared/FormSheet'
import { pillStyle, smallPrimaryBtnStyle, smallSecondaryBtnStyle, smallDangerBtnStyle } from '@/components/shared/ui'
import { useCan } from '@/lib/permissions'
import TechnicalOfferUploadSheet from '@/components/rnd/TechnicalOfferUploadSheet'
import type { RndOfferV2 } from '@/types/rndIntake'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const note = (hex: string): React.CSSProperties => ({ fontSize: 12.5, color: TEXT.body, margin: '10px 0 0', padding: '8px 12px', borderRadius: 8, background: `${hex}12`, border: `1px solid ${hex}33` })

const STATUS_LABELS: Record<string, string> = { draft: 'Upload needed', submitted: 'Pending release', released: 'Released to BD', superseded: 'Superseded' }
const STATUS_HEX: Record<string, string> = { draft: '#D97706', submitted: '#2563EB', released: '#16A34A', superseded: '#78716C' }

const fmtSize = (n?: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const offerSort = (a: RndOfferV2, b: RndOfferV2) => a.offer_number.localeCompare(b.offer_number, undefined, { numeric: true }) || a.revision - b.revision

export default function RequirementTechnicalOffersTab({ source, recordId, access, acceptedHint }: {
  source: 'inquiry' | 'tender'
  recordId: number
  access: RndMyAccess
  /** Set while the latest revision is not accepted: the reason uploads are off ("Accept the requirement first …"). */
  acceptedHint?: string
}) {
  const [offers, setOffers] = useState<RndOfferV2[] | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [uploading, setUploading] = useState<{ reviseOf: RndOfferV2 | null } | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'release' | 'delete'; offer: RndOfferV2 } | null>(null)
  const [returning, setReturning] = useState<RndOfferV2 | null>(null)
  const [returnNote, setReturnNote] = useState('')

  const { canFeature } = useCan()
  const isHead = !!access.is_head
  const canPrepare = !!access.create_technical_offer
  const canUpload = canPrepare && canFeature('rnd', 'requirements', 'technical_offers', 'create') && !acceptedHint
  const canDeleteDraft = canPrepare && canFeature('rnd', 'requirements', 'technical_offers', 'delete')
  const canApprove = isHead && canFeature('rnd', 'requirements', 'technical_offers', 'approve')

  const load = () => rndApi.listTechnicalOffers(source, recordId)
    .then((rows) => setOffers([...rows].sort(offerSort)))
    .catch((err) => { setOffers([]); setError(extractErrorMessages(err, 'Could not load the Technical Offers. Refresh the page; if it persists, check your connection.')) })
  useEffect(() => { load() }, [source, recordId]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (offerId: number, action: () => Promise<unknown>, fallback: string) => {
    setError('')
    setBusy(offerId)
    try { await action(); await load() } catch (err) { setError(extractErrorMessages(err, fallback)) } finally { setBusy(null) }
  }

  const download = (o: RndOfferV2) => run(o.id, async () => {
    const blob = await rndApi.downloadTechnicalOfferFile(o.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = o.file_name || `${o.offer_number}.docx`
    a.click()
    URL.revokeObjectURL(url)
  }, `Could not download ${o.offer_number}. Refresh the page and try again; if it keeps failing, ask the uploader to upload the file again.`)

  const sendBack = async (reason: string) => {
    if (!returning) return
    if (reason.trim().length < 10) { setReturnNote('Enter what must be corrected (at least 10 characters) — the uploader sees it on the offer.'); return }
    setBusy(returning.id)
    try {
      await rndApi.returnTechnicalOffer(returning.id, reason.trim())
      setReturning(null)
      setReturnNote('')
      await load()
    } catch (err) {
      setReturnNote([extractErrorMessages(err, `${returning.offer_number} was not returned.`)].flat().join(' '))
    } finally { setBusy(null) }
  }

  const all = offers || []
  const hasReleased = all.some((x) => x.status === 'released')

  return (
    <div data-tour="rnd-req-technical-offers" style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ flex: '1 1 380px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 4px' }}>Technical Offer</p>
          <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
            R&amp;D&apos;s answer to this requirement — upload the final Word or PDF file. The R&amp;D head releases it to the BD team (they can then quote it) or returns it with a reason.
          </p>
        </div>
        {canPrepare && offers !== null && (
          <button data-tour="rnd-req-to-upload" type="button" disabled={!canUpload} title={acceptedHint || undefined}
            onClick={() => setUploading({ reviseOf: null })} style={sheetBtn('primary', SHEET.BLUE, !canUpload)}>
            <SheetIcon name="upload" size={15} />Upload Technical Offer
          </button>
        )}
      </div>

      {acceptedHint && <p style={note('#D97706')}>{acceptedHint}</p>}

      {error && (
        <div style={{ padding: '10px 14px', margin: '10px 0 12px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {offers === null ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : all.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '10px 0 0' }}>
          No Technical Offer uploaded yet.{!canPrepare && ' The R&D head, or people given the Technical Offer team permission in Organization › Role & Permissions, upload it.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {all.map((o) => {
            const hex = STATUS_HEX[o.status]
            const mine = busy === o.id
            const canReplace = canUpload && (o.status === 'draft' || o.status === 'submitted' || o.status === 'released')
            return (
              <div key={o.id} style={{ borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,0.55)', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading }}>{o.offer_number}</span>
                  <span style={pillStyle(hex)}>{STATUS_LABELS[o.status] || o.status}</span>
                  {o.based_on_earlier_revision && <span title="BD sent a newer revision of the requirement after this offer" style={pillStyle('#9a3412')}>Based on an earlier revision</span>}
                  <span style={{ fontSize: 13, color: TEXT.body, flex: '1 1 200px', minWidth: 0 }}>{o.title}</span>
                  <span style={{ fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap' }}>
                    Dated {formatDate(o.offer_date)} · by {o.created_by}{o.created_at ? ` · ${formatDateTime(o.created_at)}` : ''}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: '6px 0 0' }}>
                  {o.file_name ? <>{o.file_name}{(o.file?.file_size ?? o.file_size) ? ` · ${fmtSize((o.file?.file_size ?? o.file_size) as number)}` : ''}</> : 'No file attached'}
                  {o.released_at ? ` · released by ${o.released_by} on ${formatDateTime(o.released_at)}` : ''}
                </p>
                {o.notes && <p style={{ fontSize: 12.5, color: TEXT.body, margin: '6px 0 0', whiteSpace: 'pre-wrap' }}><strong>Notes:</strong> {o.notes}</p>}
                {o.quoted_in.length > 0 && <p style={{ fontSize: 12.5, color: TEXT.body, margin: '6px 0 0' }}><strong>Quoted in:</strong> {o.quoted_in.join(', ')}</p>}
                {o.returned_reason && (o.status === 'draft' || o.status === 'submitted') && (
                  <p style={note('#D97706')}><strong>{o.status === 'draft' ? 'Needs a new upload:' : 'Returned by the R&D head:'}</strong> {o.returned_reason}</p>
                )}
                {o.status === 'submitted' && !o.returned_reason && (
                  <p style={note('#2563EB')}>Waiting for the R&amp;D head to release it to the BD team{isHead ? '' : ' or return it for changes'}.</p>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  {o.file_name && <button type="button" disabled={mine} onClick={() => download(o)} style={smallSecondaryBtnStyle}>{mine ? 'Working…' : 'Download'}</button>}
                  {o.status === 'submitted' && canApprove && (<>
                    <button data-tour="rnd-req-to-release" type="button" disabled={mine} onClick={() => setConfirm({ kind: 'release', offer: o })} style={smallPrimaryBtnStyle}>Release to BD</button>
                    <button data-tour="rnd-req-to-return" type="button" disabled={mine} onClick={() => { setReturnNote(''); setReturning(o) }} style={smallSecondaryBtnStyle}>Return for changes</button>
                  </>)}
                  {canReplace && (
                    <button type="button" disabled={mine} onClick={() => setUploading({ reviseOf: o })} style={smallSecondaryBtnStyle}>
                      {o.status === 'released' ? 'Upload revision' : 'Upload corrected file'}
                    </button>
                  )}
                  {o.status === 'draft' && canDeleteDraft && (
                    <button type="button" disabled={mine} onClick={() => setConfirm({ kind: 'delete', offer: o })} style={smallDangerBtnStyle}>Delete</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {uploading && (
        <TechnicalOfferUploadSheet
          draftId={`rnd-offer-${source}-${recordId}${uploading.reviseOf ? `-r${uploading.reviseOf.id}` : ''}`}
          heading={uploading.reviseOf ? `Upload Revision of ${uploading.reviseOf.offer_number}` : 'Upload Technical Offer'}
          subtitle={uploading.reviseOf ? 'A corrected file becomes the next revision of this offer.' : 'The final Word or PDF file R&D sends to the BD team.'}
          hint={`After the upload it shows as “Pending release”. The R&D head releases it to the BD team${hasReleased ? '; an offer released earlier then becomes Superseded' : ''}, or returns it with a reason.`}
          onClose={() => setUploading(null)}
          onSubmit={async (p) => {
            await rndApi.uploadTechnicalOffer(source, recordId, { ...p, revise_of_id: uploading.reviseOf?.id })
            setUploading(null)
            await load()
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={!confirm ? '' : confirm.kind === 'release' ? `Release ${confirm.offer.offer_number} to the BD team?` : `Delete ${confirm.offer.offer_number}?`}
        message={!confirm ? '' : confirm.kind === 'release'
          ? `The BD team is notified and can quote against it. It is locked from now on.${hasReleased ? ' The offer released earlier becomes Superseded.' : ''}`
          : 'The offer record is removed. This cannot be undone.'}
        confirmLabel={confirm?.kind === 'release' ? 'Release' : 'Delete'}
        danger={confirm?.kind === 'delete'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          if (!c) return
          if (c.kind === 'release') run(c.offer.id, () => rndApi.releaseTechnicalOffer(c.offer.id), `${c.offer.offer_number} was not released to the BD team.`)
          else run(c.offer.id, () => rndApi.deleteTechnicalOffer(c.offer.id), `${c.offer.offer_number} was not deleted.`)
        }}
      />
      <PromptDialog
        open={!!returning}
        title={returning ? `Return ${returning.offer_number} for changes?` : ''}
        message={returnNote || 'Say what must be corrected (at least 10 characters). The uploader sees this on the offer and uploads a corrected file.'}
        placeholder="e.g. Add the deviation on wheel diameter and upload again"
        confirmLabel={busy === returning?.id ? 'Returning…' : 'Return'}
        requireValue
        onConfirm={sendBack}
        onCancel={() => { setReturning(null); setReturnNote('') }}
      />
    </div>
  )
}
