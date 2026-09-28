'use client'

import { useRef, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/crm/ui'
import { BRAND, TEXT, GLASS, SHADOWS } from '@/lib/theme'

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

export default function BulkImportPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('crm')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  if (isLoading || !isAuthorized) return null

  if (user?.role !== 'admin') {
    return (
      <div>
        <CrmNav />
        <p style={{ fontSize: 14, color: TEXT.muted }}>Bulk import is restricted to admins.</p>
      </div>
    )
  }

  const downloadTemplate = async () => {
    const blob = await crmApi.downloadBulkImportTemplate()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'crm_bulk_import_template.csv'
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const upload = async () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    setResult(null)
    try {
      const data = await crmApi.bulkImport(file)
      setResult(data)
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(message || 'Import failed — check the file and try again.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setFileName('')
    }
  }

  return (
    <div>
      <CrmNav />
      <h2 style={{ fontSize: 18, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>Bulk Import</h2>
      <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 8px', maxWidth: 760 }}>
        One CSV file covers everything — Organizations, Contacts, Inquiries and Follow-ups together. Each row is one
        follow-up, carrying its organization/contact/inquiry details alongside it:
      </p>
      <ul style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 20px', paddingLeft: 20, maxWidth: 760 }}>
        <li>Repeat the same <strong>org_name</strong> across rows to attach multiple contacts/inquiries to the same organization — it's only created once, on the first row that mentions it.</li>
        <li>Use a different <strong>contact_mobile</strong> under the same org_name to add another contact under that organization; repeat an existing contact_mobile to reuse that contact for another inquiry.</li>
        <li>Give each inquiry your own <strong>inquiry_ref</strong> (any text you choose, e.g. an old ticket number). The first row with a ref creates the inquiry with that row's product as its primary product.</li>
        <li>A <strong>later row reusing the same inquiry_ref</strong>: if it fills in <strong>product</strong>, that's added as another product on that same inquiry (for multi-product inquiries); if it fills in any <strong>followup_*</strong> column, that's recorded as another follow-up. A row can do either, both, or neither.</li>
        <li>Only <strong>org_name</strong> is required on every row — everything else is filled in only the first time it's needed.</li>
        <li>Safe to re-upload: if an organization, contact, or inquiry already exists (matched by name/mobile/inquiry_ref), it's <strong>updated in place</strong> with any new details in the row instead of creating a duplicate.</li>
      </ul>

      <div style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20, maxWidth: 760,
      }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" data-tour="bulk-import-template-btn" style={secondaryBtnStyle} onClick={downloadTemplate}>Download CSV Template</button>
          <input
            ref={fileInputRef}
            data-tour="bulk-import-file-input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
            style={{ fontSize: 13 }}
          />
          <button type="button" data-tour="bulk-import-submit-btn" style={{ ...primaryBtnStyle, opacity: fileName && !uploading ? 1 : 0.5 }} disabled={!fileName || uploading} onClick={upload}>
            {uploading ? 'Importing…' : 'Import'}
          </button>
        </div>

        {error && <p style={{ fontSize: 13, color: '#dc2626', marginTop: 12 }}>{error}</p>}

        {result && (
          <div data-tour="bulk-import-results" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ fontSize: 13 }}>Rows in file: <strong>{result.total_rows}</strong></span>
              <span style={{ fontSize: 13, color: '#16a34a' }}>Organizations: <strong>{result.organizations_created} new</strong>{result.organizations_updated > 0 && <>, <strong>{result.organizations_updated} updated</strong></>}</span>
              <span style={{ fontSize: 13, color: '#16a34a' }}>Contacts: <strong>{result.contacts_created} new</strong>{result.contacts_updated > 0 && <>, <strong>{result.contacts_updated} updated</strong></>}</span>
              <span style={{ fontSize: 13, color: '#16a34a' }}>Inquiries: <strong>{result.inquiries_created} new</strong>{result.inquiries_updated > 0 && <>, <strong>{result.inquiries_updated} updated</strong></>}</span>
              <span style={{ fontSize: 13, color: '#16a34a' }}>Product lines added: <strong>{result.product_lines_added}</strong></span>
              <span style={{ fontSize: 13, color: '#16a34a' }}>Follow-ups: <strong>{result.followups_created}</strong></span>
              <span style={{ fontSize: 13, color: result.rows_skipped ? '#dc2626' : TEXT.muted }}>Rows skipped: <strong>{result.rows_skipped}</strong></span>
            </div>

            {result.errors.length > 0 && (
              <div style={{ maxHeight: 260, overflow: 'auto', border: `1px solid ${BRAND.primary}22`, borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: `${BRAND.primary}0d` }}>
                      <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, fontWeight: 700, color: TEXT.muted }}>Row</th>
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
                {result.more_errors_not_shown > 0 && (
                  <p style={{ fontSize: 12, color: TEXT.muted, padding: '6px 10px', margin: 0 }}>
                    +{result.more_errors_not_shown} more error(s) not shown.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
