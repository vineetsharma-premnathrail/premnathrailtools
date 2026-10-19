'use client'

// "New Technical Offer": asks only which TOR (Technical Offer Request from
// CRM) it answers, creates the offer from that requirement and opens its
// letterhead Word template in Word Online — the offer is written there, not
// in a form. A TOR that already has an offer just opens that requirement.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { rndApi } from '@/lib/api'
import { recordPath } from '@/lib/recordRef'
import { RndTorOption } from '@/types'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { extractErrorMessages } from '@/lib/validation'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { openRecordInWord } from '@/components/shared/ManagedDocumentPanel'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const STATUS_LABELS: Record<string, string> = { draft: 'draft', released: 'released', superseded: 'superseded' }

// Mounted only while open, so every opening starts clean.
export default function NewTechnicalOfferDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <Dialog onClose={onClose} /> : null
}

function Dialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [options, setOptions] = useState<RndTorOption[] | null>(null)
  const [picked, setPicked] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeKey(!busy, onClose)

  useEffect(() => {
    rndApi.technicalOfferTorOptions()
      .then(setOptions)
      .catch((err) => { setOptions([]); setError(extractErrorMessages(err, 'Could not load the TORs sent from CRM. Refresh the page.').join(' ')) })
  }, [])

  const key = (o: RndTorOption) => `${o.source}:${o.record_id}`
  const tor = options?.find((o) => key(o) === picked)
  const href = tor ? `${recordPath(`/dashboard/rnd/requirements/${tor.source}`, tor, 'record_id')}?tab=technical-offers` : ''

  const create = async () => {
    if (!tor) { setError('Pick the TOR this Technical Offer answers.'); return }
    if (tor.offer_number) { router.push(href); onClose(); return }
    setBusy(true)
    setError('')
    // Open the tab now — a tab opened after the request returns is blocked as a pop-up.
    const tab = window.open('', '_blank')
    let offer
    try {
      offer = await rndApi.createTechnicalOffer(tor.source, tor.record_id)
    } catch (err) {
      tab?.close()
      setError(extractErrorMessages(err, 'The Technical Offer was not created.').join(' '))
      setBusy(false)
      return
    }
    try {
      if (offer.word_error) {
        tab?.close()
        setOptions((cur) => (cur || []).map((o) => (key(o) === picked ? { ...o, offer_number: offer.offer_number, offer_status: offer.status } : o)))
        setError(`${offer.offer_number} was created, but its Word template wasn't: ${offer.word_error}`)
        return
      }
      await openRecordInWord('rnd_technical_offer', offer.id, tab)
      router.push(href)
      onClose()
    } catch (err) {
      // The offer exists — let them open it and retry Word from its page.
      setOptions((cur) => (cur || []).map((o) => (key(o) === picked ? { ...o, offer_number: offer.offer_number, offer_status: offer.status } : o)))
      setError(`${offer.offer_number} was created, but Word didn't open: ${extractErrorMessages(err, 'unknown error').join(' ')} Open it and click 'Save & Edit in Word' to try again.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet tour="rnd-new-technical-offer" width={580} icon="doc" title="New Technical Offer" subtitle="Answers a TOR sent from CRM — written in Word on the letterhead." onClose={onClose} busy={busy}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={create} disabled={busy || !tor} style={sheetBtn('primary', SHEET.BLUE, busy || !tor)}>
          <SheetIcon name={tor?.offer_number ? 'right' : 'doc'} size={16} />
          {busy ? 'Opening Word…' : tor?.offer_number ? `Open ${tor.offer_number}` : 'Create & Edit in Word'}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        )}
        <SheetSection icon="link" title="Technical Offer Request">
          <label style={sheetLabel}>TOR No. <Req /></label>
          <SearchableSelect
            value={picked}
            onChange={(v) => { setPicked(v); setError('') }}
            disabled={busy || options === null}
            placeholder={options === null ? 'Loading…' : options.length ? 'Search TOR no., inquiry/tender ID, product or customer…' : 'No TORs have been sent from CRM yet'}
            options={(options || []).map((o) => ({
              value: key(o),
              label: [o.tor_number || o.universal_id, o.title, o.org_name, o.offer_number ? `has ${o.offer_number} (${STATUS_LABELS[o.offer_status || ''] || o.offer_status})` : null].filter(Boolean).join(' — '),
            }))}
          />
          <p style={sheetHint}>
            The offer opens as a Word template on the letterhead — customer, subject and the requirement&apos;s scope are filled in; write the rest in Word.
          </p>
          {tor?.offer_number && (
            <p style={{ fontSize: 12.5, color: '#B45309', margin: '10px 0 0' }}>
              This TOR already has Technical Offer {tor.offer_number} ({STATUS_LABELS[tor.offer_status || ''] || tor.offer_status}).
              {tor.offer_status === 'draft' ? ' Open it and continue the draft.' : ' Open it and use “Revise” to make the next revision.'}
            </p>
          )}
        </SheetSection>
      </div>
    </FormSheet>
  )
}
