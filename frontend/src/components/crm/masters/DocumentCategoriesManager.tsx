'use client'

// Document Categories list — shown in CRM → Settings. These are the choices in
// the Category picker when uploading a Client / Internal document on an
// inquiry or tender.

import { useEffect, useState } from 'react'
import { crmApi } from '@/lib/api'
import { CrmDocumentCategory } from '@/types'
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, smallDangerBtnStyle, smallSecondaryBtnStyle } from '@/components/crm/ui'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

export default function DocumentCategoriesManager() {
  const { can } = useCan()
  const canEditList = can('crm', 'settings', 'edit')
  const [categories, setCategories] = useState<CrmDocumentCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [errorTitle, setErrorTitle] = useState('Cannot Save Document Category')
  const [pendingDelete, setPendingDelete] = useState<CrmDocumentCategory | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | string[]>('')

  const load = (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    crmApi.listDocumentCategories()
      .then(setCategories)
      .catch((err) => { setErrorTitle('Cannot Load Document Categories'); setError(extractErrorMessages(err, 'Could not load the document categories. Reload the page; if it persists, check your CRM access.')) })
      .finally(() => setLoading(false))
  }

  // First load (`loading` already starts true); deferred so the effect itself sets no state.
  useEffect(() => { Promise.resolve().then(() => load(false)) }, [])

  const startEdit = (c: CrmDocumentCategory) => {
    setEditingId(c.id)
    setLabel(c.label)
    setShowForm(true)
  }

  const cancelForm = () => { setEditingId(null); setLabel(''); setShowForm(false); setFormError('') }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    setSaving(true)
    try {
      if (editingId) await crmApi.updateDocumentCategory(editingId, { label })
      else await crmApi.createDocumentCategory({ label })
      cancelForm()
      load()
    } catch (err) {
      setFormError(extractErrorMessages(err, 'The document category was not saved. Check the name is not empty or already used, then try again.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    try {
      await crmApi.deleteDocumentCategory(id)
      load()
    } catch (err) {
      setErrorTitle('Cannot Delete Document Category')
      setError(extractErrorMessages(err, 'The document category was not deleted. Reload the page and try again; if it persists, check you have CRM Settings › Edit access.'))
    }
  }

  const editing = categories.find((c) => c.id === editingId)

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '0 0 16px' }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Document Categories</h2>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>The Category choices when uploading a Client or Internal document on an inquiry or tender.</p>
        </div>
        {canEditList && (
          <button
            onClick={() => { cancelForm(); setShowForm(true) }}
            data-tour="dc-add-btn"
            style={{ ...primaryBtnStyle, alignSelf: 'flex-start', fontWeight: 700, fontSize: 14.5, padding: '12px 24px' }}
          >
            + Add Document Category
          </button>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete document category?"
        message={`Delete "${pendingDelete?.label ?? ''}"? It disappears from the upload Category picker.${pendingDelete?.document_count ? ` The ${pendingDelete.document_count} document${pendingDelete.document_count === 1 ? '' : 's'} already filed under it keep this label.` : ''}`}
        onConfirm={() => { const row = pendingDelete; setPendingDelete(null); if (row) remove(row.id) }}
        onCancel={() => setPendingDelete(null)}
      />
      <MessageDialog
        open={Array.isArray(error) ? error.length > 0 : !!error}
        variant="error"
        title={errorTitle}
        message={error}
        onClose={() => setError('')}
      />

      {showForm && (
        <FormSheet width={520} icon={editingId ? 'edit' : 'doc'} title={editingId ? 'Edit Document Category' : 'Add Document Category'} subtitle="A Category choice when uploading a Client or Internal document on an inquiry or tender." onClose={cancelForm} busy={saving}
          footer={<>
            <button type="button" onClick={cancelForm} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="submit" form="dc-form" data-tour="dc-save" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name={editingId ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Category'}
            </button>
          </>}>
          <form id="dc-form" onSubmit={save} style={{ padding: '20px 24px' }}>
            <SheetError error={formError} />
            <SheetSection icon="doc" title="Document Category Details">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          <div data-tour="dc-label" style={{ flex: '1 1 100%' }}>
            <label style={sheetLabel}>Category Name <Req /></label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={100} autoFocus style={sheetInput} />
          </div>
          {editing && editing.document_count > 0 && (
            <p style={{ fontSize: 12, color: SHEET.MUTED, margin: 0 }}>
              Renaming also re-labels the {editing.document_count} document{editing.document_count === 1 ? '' : 's'} already filed under &quot;{editing.label}&quot;.
            </p>
          )}
              </div>
            </SheetSection>
          </form>
        </FormSheet>
      )}

      <div data-tour="dc-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
            <thead>
              <tr>
                {['Category', 'Documents', ''].map((h) => (
                  <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 700, color: TEXT.secondary }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} style={{ padding: 20, textAlign: 'center', color: TEXT.secondary }}>Loading…</td></tr>
              ) : categories.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: 20, textAlign: 'center', color: TEXT.secondary }}>No document categories yet. Uploads will be filed as &quot;Other&quot; until you add one.</td></tr>
              ) : (
                categories.map((c, rowIdx) => (
                  <tr key={c.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{c.label}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, color: TEXT.secondary }}>{c.document_count}</td>
                    <td style={{ padding: '10px 14px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      {canEditList && <button onClick={() => startEdit(c)} data-tour={rowIdx === 0 ? 'dc-row-edit-btn' : undefined} style={{ ...smallSecondaryBtnStyle }}>Edit</button>}
                      {canEditList && <button onClick={() => setPendingDelete(c)} data-tour={rowIdx === 0 ? 'dc-row-delete-btn' : undefined} style={{ ...smallDangerBtnStyle }}>Delete</button>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
