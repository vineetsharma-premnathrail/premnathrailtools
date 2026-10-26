'use client'

// Import button on the Organizations and Inquiries & Tenders lists (replaces
// the old Bulk Import tab). One CSV covers organizations, contacts, inquiries
// and follow-ups together — see /crm/bulk-import. Admin only (the API checks).

import { useRef, useState } from 'react'
import { crmApi } from '@/lib/api'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { BRAND, TEXT, GLASS } from '@/lib/theme'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { extractErrorMessages } from '@/lib/validation'
import { RowCount } from '@/components/shared/ui'

interface ImportResult {
  total_rows: number
  organizations_created: number
  organizations_updated: number
  contacts_created: number
  contacts_updated: number
  inquiries_created: number
  inquiries_updated: number
  product_lines_added: number
  followups_created: number
  rows_skipped: number
  errors: { row: number; message: string }[]
  more_errors_not_shown: number
}

export default function CrmImportDialog({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const close = () => { if (!uploading) onClose() }
  useEscapeKey(true, close)

  const downloadTemplate = async () => {
    try {
      const blob = await crmApi.downloadBulkImportTemplate()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'crm_bulk_import_template.csv'
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not download the template — try again.').join(' '))
    }
  }

  const upload = async () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    setResult(null)
    try {
      setResult(await crmApi.bulkImport(file))
      onImported?.()
    } catch (err) {
      setError(extractErrorMessages(err, 'Import failed — check the file and try again.').join(' '))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setFileName('')
    }
  }

  return (
    <FormSheet width={result ? 820 : 620} icon="upload" title="Import from CSV" subtitle="One CSV covers Customer Organizations, Contacts, Inquiries and Follow-ups together." onClose={close} busy={uploading}
      footer={<>
        <button type="button" style={sheetBtn('secondary', SHEET.INK, uploading)} onClick={close} disabled={uploading}>{result ? 'Done' : 'Cancel'}</button>
        <button type="button" style={sheetBtn('primary', SHEET.BLUE, !fileName || uploading)} disabled={!fileName || uploading} onClick={upload}>
          <SheetIcon name="upload" size={16} />{uploading ? 'Importing…' : 'Import'}
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <SheetSection icon="doc" title="How the file works">
          <ul style={{ fontSize: 12.5, color: SHEET.BODY, margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
            <li>Repeat the same <strong>org_name</strong> to add more contacts / inquiries under one customer organization (created once).</li>
            <li>A new <strong>contact_mobile</strong> under an org adds a contact; repeating one reuses that contact.</li>
            <li>Give each inquiry an <strong>inquiry_ref</strong>; later rows with the same ref add products or follow-ups to it.</li>
            <li>Only <strong>org_name</strong> is required. Safe to re-upload — existing records are updated, not duplicated.</li>
          </ul>
        </SheetSection>
        <SheetSection icon="upload" title="CSV File">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={downloadTemplate}><SheetIcon name="doc" size={15} />Download CSV Template</button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={(e) => setFileName(e.target.files?.[0]?.name || '')} style={{ ...sheetInput, flex: '1 1 240px', width: 'auto', padding: '7px 10px' }} />
          </div>
          <p style={sheetHint}>Download the template, fill it in a spreadsheet, save as CSV and pick it here.</p>
        </SheetSection>
          {result && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10, fontSize: 13 }}>
                <span>Rows in file: <strong>{result.total_rows}</strong></span>
                <span style={{ color: '#16a34a' }}>Customer Organizations: <strong>{result.organizations_created} new</strong>{result.organizations_updated > 0 && <>, <strong>{result.organizations_updated} updated</strong></>}</span>
                <span style={{ color: '#16a34a' }}>Contacts: <strong>{result.contacts_created} new</strong>{result.contacts_updated > 0 && <>, <strong>{result.contacts_updated} updated</strong></>}</span>
                <span style={{ color: '#16a34a' }}>Inquiries: <strong>{result.inquiries_created} new</strong>{result.inquiries_updated > 0 && <>, <strong>{result.inquiries_updated} updated</strong></>}</span>
                <span style={{ color: '#16a34a' }}>Product lines: <strong>{result.product_lines_added}</strong></span>
                <span style={{ color: '#16a34a' }}>Follow-ups: <strong>{result.followups_created}</strong></span>
                <span style={{ color: result.rows_skipped ? '#dc2626' : TEXT.muted }}>Rows skipped: <strong>{result.rows_skipped}</strong></span>
              </div>
              {result.errors.length > 0 && (
                <div style={{ maxHeight: 240, overflow: 'auto', border: `1px solid ${BRAND.primary}22`, borderRadius: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: `${BRAND.primary}0d` }}>
                        <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, fontWeight: 700, color: TEXT.muted }}>Row <RowCount count={result.errors.length} /></th>
                        <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, fontWeight: 700, color: TEXT.muted }}>Reason skipped</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${GLASS.border}` }}>
                          <td style={{ padding: '5px 10px', fontSize: 12.5 }}>{e.row}</td>
                          <td style={{ padding: '5px 10px', fontSize: 12.5, color: '#dc2626' }}>{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.more_errors_not_shown > 0 && <p style={{ fontSize: 12, color: TEXT.muted, padding: '6px 10px', margin: 0 }}>+{result.more_errors_not_shown} more error(s) not shown.</p>}
                </div>
              )}
            </div>
          )}

      </div>
    </FormSheet>
  )
}
