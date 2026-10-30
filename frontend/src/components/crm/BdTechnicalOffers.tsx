'use client'

// Technical Offers tab on an inquiry / tender: the offers BD can quote — released by R&D, or
// uploaded here by BD itself ("Uploaded by BD, not reviewed by R&D"). A BD offer needs no R&D
// requirement, is quotable at once, and can be deleted only while no quotation uses it.

import { useEffect, useState } from 'react'
import { crmApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { formatDate, formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import TechnicalOfferUploadSheet from '@/components/rnd/TechnicalOfferUploadSheet'
import { SheetIcon, sheetBtn, SHEET } from '@/components/shared/FormSheet'
import { Pill, TableScroll, RowCount, thStyle, tdStyle, smallSecondaryBtnStyle, smallDangerBtnStyle } from '@/components/shared/ui'
import type { CrmOfferV2 } from '@/types/rndIntake'

const fmtSize = (n?: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

export default function BdTechnicalOffers({ kind, recordId }: { kind: 'inquiry' | 'tender'; recordId: number }) {
  const { canFeature } = useCan()
  const canUpload = canFeature('crm', 'inquiries_tenders', 'technical_offer', 'create')
  const canRemove = canFeature('crm', 'inquiries_tenders', 'technical_offer', 'delete')
  const [offers, setOffers] = useState<CrmOfferV2[] | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<CrmOfferV2 | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const load = () => crmApi.listTechnicalOffers(kind, recordId)
    .then((rows) => setOffers([...rows].sort((a, b) => a.offer_number.localeCompare(b.offer_number, undefined, { numeric: true }))))
    .catch((err) => { setOffers([]); setError(extractErrorMessages(err, 'Could not load the Technical Offers. Refresh the page; if it persists, check your CRM › Inquiries & Tenders › Technical Offers permission.')) })
  useEffect(() => { load() }, [kind, recordId]) // eslint-disable-line react-hooks/exhaustive-deps

  const download = async (o: CrmOfferV2) => {
    setBusy(o.id)
    setError('')
    try {
      const blob = await crmApi.technicalOfferFile(kind, recordId, o.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = o.file_name || `${o.offer_number}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(extractErrorMessages(err, `Could not download ${o.offer_number}. Refresh the page and try again.`))
    } finally { setBusy(null) }
  }

  const remove = async (o: CrmOfferV2) => {
    setDeleting(null)
    setBusy(o.id)
    setError('')
    try { await crmApi.deleteBdTechnicalOffer(o.id); await load() } catch (err) {
      // e.g. "Used by quotation QT-… — remove it from the quotation first."
      setError(extractErrorMessages(err, `${o.offer_number} was not deleted.`))
    } finally { setBusy(null) }
  }

  return (
    <div data-tour="crm-bd-offers">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <p style={{ fontSize: 12.5, color: '#78716c', margin: 0, maxWidth: 640 }}>
          Offers you can quote: the ones R&amp;D released, and the ones BD uploaded here. A BD offer is quotable at once and shows “Uploaded by BD, not reviewed by R&amp;D” on the quotation.
        </p>
        {canUpload && (
          <button data-tour="crm-bd-offer-upload-btn" type="button" onClick={() => setUploading(true)} style={sheetBtn('primary', SHEET.BLUE)}>
            <SheetIcon name="upload" size={15} />Upload Technical Offer
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <TableScroll minWidth={860}>
        <table data-tour="crm-bd-offers-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Offer no.<RowCount count={offers?.length ?? 0} /></th><th style={thStyle}>Title</th><th style={thStyle}>From</th>
              <th style={thStyle}>Offer date</th><th style={thStyle}>File</th><th style={thStyle}>Used in quotation</th><th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {offers === null ? (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#78716c', padding: 20 }}>Loading…</td></tr>
            ) : offers.length === 0 ? (
              <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#78716c', padding: 20 }}>
                No Technical Offer yet.{canUpload ? ' Upload one, or wait for R&D to release theirs.' : ' R&D releases theirs here once it is ready.'}
              </td></tr>
            ) : offers.map((o) => (
              <tr key={o.id}>
                <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{o.offer_number}</td>
                <td style={tdStyle}>
                  {o.title}
                  {o.notes && <div style={{ fontSize: 12, color: '#78716c' }}>{o.notes}</div>}
                </td>
                <td style={tdStyle}>
                  <Pill label={o.origin === 'bd' ? 'BD upload' : 'R&D released'} hex={o.origin === 'bd' ? '#7C3AED' : '#16A34A'} />
                  {o.label && <div style={{ fontSize: 11.5, color: '#78716c', marginTop: 2 }}>{o.label}</div>}
                  {o.based_on_earlier_revision && <div style={{ fontSize: 11.5, color: '#9a3412', marginTop: 2 }}>Based on an earlier requirement revision</div>}
                  {o.status === 'superseded' && <div style={{ fontSize: 11.5, color: '#78716c', marginTop: 2 }}>Superseded by a newer offer</div>}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(o.offer_date)}</td>
                <td style={tdStyle}>
                  {o.file_name || '—'}{o.file_size ? <div style={{ fontSize: 12, color: '#78716c' }}>{fmtSize(o.file_size)}</div> : null}
                  {o.uploaded_by && <div style={{ fontSize: 12, color: '#78716c' }}>by {o.uploaded_by}{o.uploaded_at ? ` · ${formatDateTime(o.uploaded_at)}` : ''}</div>}
                </td>
                <td style={tdStyle}>{o.quoted_in.length ? o.quoted_in.join(', ') : '—'}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', gap: 8 }}>
                    {o.file_name && <button type="button" disabled={busy === o.id} onClick={() => download(o)} style={smallSecondaryBtnStyle}>Download</button>}
                    {o.origin === 'bd' && canRemove && (
                      <button type="button" disabled={busy === o.id || !o.can_delete} onClick={() => setDeleting(o)}
                        title={o.can_delete ? undefined : `Used by quotation ${o.quoted_in.join(', ')} — remove it from the quotation first.`} style={{ ...smallDangerBtnStyle, opacity: o.can_delete ? 1 : 0.5 }}>Delete</button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      {uploading && (
        <TechnicalOfferUploadSheet
          draftId={`crm-offer-${kind}-${recordId}`}
          subtitle={`Your own offer for this ${kind} — it needs no R&D requirement.`}
          hint="It is quotable at once and shows “Uploaded by BD, not reviewed by R&D” on the quotation. You can delete it only while no quotation uses it."
          onClose={() => setUploading(false)}
          onSubmit={async (p) => { await crmApi.uploadBdTechnicalOffer(kind, recordId, p); setUploading(false); await load() }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={deleting ? `Delete ${deleting.offer_number}?` : ''}
        message="The uploaded offer is removed. This cannot be undone."
        onConfirm={() => deleting && remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
