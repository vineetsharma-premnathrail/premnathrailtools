'use client'

import { useCallback, useEffect, useState } from 'react'
import { salesApi } from '@/lib/api'
import { SalesCrmDocument, SalesOrder } from '@/types'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { RowCount, TableScroll } from '@/components/shared/ui'
import { sectionStyle, h2Style, thStyle, tdStyle, ErrorBanner } from '@/components/sales/SalesUi'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn } from '@/components/shared/FormSheet'
import CrmDocumentPicker from '@/components/sales/CrmDocumentPicker'

/**
 * Order › Documents › "Linked from CRM": the CRM documents of the order's source
 * inquiry / tender picked for this order. Links only — opened through the order,
 * so a Sales user needs no CRM access (owner, 2026-10-27).
 */
export default function SoCrmDocuments({ so, canEdit }: { so: SalesOrder; canEdit: boolean }) {
  const [docs, setDocs] = useState<SalesCrmDocument[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    salesApi.listCrmDocumentLinks(so.id).then(setDocs)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the linked CRM documents — reload the page.')))
  }, [so.id])
  useEffect(() => { load() }, [load])

  async function open(d: SalesCrmDocument) {
    try { window.open(URL.createObjectURL(await salesApi.crmDocumentContent(so.id, d.id)), '_blank') }
    catch (err) { setError(extractErrorMessages(err, `Could not open ${d.file_name} — it may have been deleted in CRM. Reload the page.`)) }
  }

  async function save() {
    setBusy(true); setError('')
    try { setDocs(await salesApi.setCrmDocumentLinks(so.id, picked)); setPicking(false) }
    catch (err) { setError(extractErrorMessages(err, 'Could not save the linked documents — reload and pick again.')) }
    finally { setBusy(false) }
  }

  return (
    <div data-tour="sales-detail-crm-docs" style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h2 style={{ ...h2Style, margin: 0 }}>Linked from CRM{so.source_label ? ` — ${so.source_label}` : ''}</h2>
        {canEdit && (
          <button data-tour="sales-detail-crm-docs-pick" type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => { setPicked(docs.map((d) => d.id)); setError(''); setPicking(true) }}>
            <SheetIcon name="doc" size={15} />Choose CRM documents
          </button>
        )}
      </div>
      {!picking && <ErrorBanner error={error} />}
      {docs.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>
          No CRM documents linked{canEdit ? ' — use Choose CRM documents to link files of the inquiry / tender.' : '.'}
        </p>
      ) : (
        <TableScroll>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['File', 'Folder', 'Uploaded by', 'On'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={docs.length} />}</th>)}</tr></thead>
            <tbody>{docs.map((d) => (
              <tr key={d.id}>
                <td style={tdStyle}>
                  <button type="button" onClick={() => open(d)} title={`Open ${d.file_name}`}
                    style={{ background: 'none', border: 'none', padding: 0, color: '#FF6A2A', cursor: 'pointer', fontWeight: 600, overflowWrap: 'anywhere', textAlign: 'left', font: 'inherit' }}>
                    {d.file_name}
                  </button>
                </td>
                <td style={tdStyle}>{[d.folder, d.category].filter(Boolean).join(' · ')}</td>
                <td style={tdStyle}>{d.uploaded_by_name || '—'}</td>
                <td style={tdStyle}>{d.uploaded_at ? formatDate(d.uploaded_at) : '—'}</td>
              </tr>))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {picking && (
        <FormSheet tour="sales-detail-crm-docs-form" width={620} icon="doc" title="Link CRM documents" subtitle={`${so.display_number}${so.source_label ? ` · ${so.source_label}` : ''}`}
          onClose={() => setPicking(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setPicking(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" onClick={save} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}>
              <SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save links'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <ErrorBanner error={error} />
            <SheetSection icon="doc" title="Documents of the inquiry / tender">
              <CrmDocumentPicker inquiryId={so.source_inquiry_id ?? undefined} tenderId={so.source_tender_id ?? undefined} value={picked} onChange={setPicked} />
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
