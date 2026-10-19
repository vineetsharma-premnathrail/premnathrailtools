'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { productsApi } from '@/lib/api'
import { ProductApplication } from '@/types'
import { TEXT } from '@/lib/theme'
import ProductsNav from '@/components/products/ProductsNav'
import { primaryBtnStyle } from '@/components/shared/ui'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { ErrorBanner, PageHeader, tableWrapStyle, tdStyle, thStyle } from '@/components/products/ProductBits'
import { extractErrorMessages } from '@/lib/validation'

const EMPTY = { code: '', name: '', description: '' }
type Sheet = { id: number | null; code: string; name: string; description: string }
const linkStyle = (color: string): React.CSSProperties => ({ fontSize: 12, fontWeight: 600, color, cursor: 'pointer', marginRight: 12 })

export default function ProductApplicationsPage() {
  const { isAuthorized, isLoading } = useRequireApp('products')
  const { can } = useCan()
  const [rows, setRows] = useState<ProductApplication[]>([])
  // Add (id null) / edit popup.
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [sheetError, setSheetError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const load = useCallback(() => {
    productsApi.listApplications({ include_inactive: true }).then(setRows).catch((e) => setError(extractErrorMessages(e, 'Failed to load applications.')))
  }, [])
  useEffect(() => { if (isAuthorized) load() }, [isAuthorized, load])

  if (isLoading || !isAuthorized) return null

  const canCreate = can('sales', 'applications', 'create')
  const canEdit = can('sales', 'applications', 'edit')

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setError('')
    try {
      await fn()
      load()
      return true
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
      return false
    }
  }
  const openSheet = (v: Sheet) => { setSheetError(''); setSheet(v) }
  const saveSheet = async () => {
    if (!sheet) return
    setSheetError('')
    setSaving(true)
    try {
      if (sheet.id == null) await productsApi.createApplication({ code: sheet.code, name: sheet.name, description: sheet.description })
      else await productsApi.updateApplication(sheet.id, { name: sheet.name, description: sheet.description })
      setSheet(null)
      load()
    } catch (err) {
      setSheetError(extractErrorMessages(err, sheet.id == null ? 'Failed to add the application.' : 'Failed to save the application.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <ProductsNav />
      <PageHeader title="Applications">
        {canCreate && <button type="button" style={primaryBtnStyle} onClick={() => openSheet({ id: null, ...EMPTY })}>+ New Application</button>}
      </PageHeader>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '-8px 0 16px' }}>An application is the job a customer buys the product for. Tag products with it so Sales can find the right product for an enquiry.</p>
      <ErrorBanner error={error} />

      {sheet && (
        <FormSheet width={580} icon={sheet.id == null ? 'tag' : 'edit'} title={sheet.id == null ? 'New Application' : `Edit ${sheet.code}`}
          subtitle="The job a customer buys the product for — products are tagged with it." onClose={() => setSheet(null)} busy={saving}
          footer={<>
            <button type="button" onClick={() => setSheet(null)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="button" onClick={saveSheet} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name={sheet.id == null ? 'plus' : 'check'} size={16} />{saving ? 'Saving…' : sheet.id == null ? 'Add' : 'Save'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <ErrorBanner error={sheetError} />
            <SheetSection icon="tag" title="Application">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 150px', minWidth: 120 }}>
                  <label style={sheetLabel}>Code <Req /></label>
                  <input style={{ ...sheetInput, textTransform: 'uppercase' }} value={sheet.code} maxLength={30} disabled={sheet.id != null} onChange={(e) => setSheet({ ...sheet, code: e.target.value })} placeholder="OHE-INSP" />
                </div>
                <div style={{ flex: '1 1 260px' }}>
                  <label style={sheetLabel}>Name <Req /></label>
                  <input style={sheetInput} value={sheet.name} onChange={(e) => setSheet({ ...sheet, name: e.target.value })} placeholder="Overhead equipment (OHE) inspection" autoFocus />
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>Description <Optional /></label>
              <input style={sheetInput} value={sheet.description} onChange={(e) => setSheet({ ...sheet, description: e.target.value })} />
              {sheet.id != null && <p style={sheetHint}>The code is fixed once created.</p>}
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <div style={tableWrapStyle}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr>{['Code', 'Name', 'Description', 'Products', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No applications yet.</td></tr>}
            {rows.map((a) => {
              return (
                <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.55 }}>
                  <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{a.code}</td>
                  <td style={tdStyle}>
                    {a.name}
                  </td>
                  <td style={tdStyle}>
                    {a.description || '—'}
                  </td>
                  <td style={tdStyle}>{a.product_count}</td>
                  <td style={tdStyle}>{a.is_active ? 'Active' : 'Retired'}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    {canEdit && (
                      <>
                        <span style={linkStyle('#FF6A2A')} onClick={() => openSheet({ id: a.id, code: a.code, name: a.name, description: a.description || '' })}>Edit</span>
                        <span style={linkStyle(a.is_active ? '#DC2626' : '#16A34A')}
                          onClick={() => run(() => productsApi.updateApplication(a.id, { is_active: !a.is_active }), 'Failed to update the application.')}>
                          {a.is_active ? 'Retire' : 'Reactivate'}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
