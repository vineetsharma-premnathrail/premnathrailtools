'use client'

// Payment Terms list — shown in CRM → Settings (was its own Masters page).

import { useEffect, useState } from 'react'
import { crmApi } from '@/lib/api'
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, smallDangerBtnStyle, smallSecondaryBtnStyle } from '@/components/crm/ui'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import MessageDialog from '@/components/erp/MessageDialog'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'

interface PaymentTerm {
  created_by_id?: number | null
  id: number
  label: string
  description: string | null
}

const emptyForm = { label: '', description: '' }

export default function PaymentTermsManager() {
  // Settings › Edit adds/edits/removes list entries; removing also needs to be your own entry (or admin).
  const { user, can } = useCan()
  const canEditList = can('crm', 'settings', 'edit')
  const canRemove = (createdById?: number | null) => canEditList && (user?.role === 'admin' || (createdById != null && createdById === user?.id))
  const [terms, setTerms] = useState<PaymentTerm[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [errorTitle, setErrorTitle] = useState('Cannot Save Payment Term')
  const [pendingDelete, setPendingDelete] = useState<PaymentTerm | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | string[]>('')

  const load = (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    crmApi.listPaymentTerms().then(setTerms).catch((err) => { setErrorTitle('Cannot Load Payment Terms'); setError(extractErrorMessages(err, 'Could not load the payment terms. Reload the page; if it persists, check your CRM access.')) }).finally(() => setLoading(false))
  }

  // First load (`loading` already starts true); deferred so the effect itself sets no state.
   
  useEffect(() => { Promise.resolve().then(() => load(false)) }, [])

  const startEdit = (t: PaymentTerm) => {
    setEditingId(t.id)
    setForm({ label: t.label, description: t.description || '' })
    setShowForm(true)
  }

  const cancelForm = () => { setEditingId(null); setForm(emptyForm); setShowForm(false); setFormError('') }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    setSaving(true)
    try {
      if (editingId) await crmApi.updatePaymentTerm(editingId, form)
      else await crmApi.createPaymentTerm(form)
      cancelForm()
      load()
    } catch (err) {
      setFormError(extractErrorMessages(err, 'Failed to save payment term.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    try {
      await crmApi.deletePaymentTerm(id)
      load()
    } catch (err) {
      setErrorTitle('Cannot Delete Payment Term')
      setError(extractErrorMessages(err, 'The payment term was not deleted. Reload the page and try again; if it persists, check your CRM access.'))
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '0 0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Payment Terms</h2>
        </div>
        {canEditList && (
        <button
          onClick={() => { cancelForm(); setShowForm(true) }}
          data-tour="pt-add-btn"
          style={{ ...primaryBtnStyle, alignSelf: 'flex-start', fontWeight: 700, fontSize: 14.5, padding: '12px 24px' }}
        >
          + Add Payment Term
        </button>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete payment term?"
        message={`Delete payment term "${pendingDelete?.label ?? ''}"? It disappears from the quotation pickers and cannot be undone.`}
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
        <FormSheet width={580} icon={editingId ? 'edit' : 'rupee'} title={editingId ? 'Edit Payment Term' : 'Add Payment Term'} subtitle="Offered in the quotation Payment Terms picker." onClose={cancelForm} busy={saving}
          footer={<>
            <button type="button" onClick={cancelForm} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="submit" form="pt-form" data-tour="pt-save" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name={editingId ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Payment Term'}
            </button>
          </>}>
          <form id="pt-form" onSubmit={save} style={{ padding: '20px 24px' }}>
            <SheetError error={formError} />
            <SheetSection icon="rupee" title="Payment Term Details">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          <div data-tour="pt-label">
            <label style={sheetLabel}>Label <Req /></label>
            <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} required style={sheetInput} />
          </div>
          <div data-tour="pt-description">
            <label style={sheetLabel}>Description / Terms Text</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} style={{ ...sheetInput, resize: 'vertical' }} />
          </div>
              </div>
            </SheetSection>
          </form>
        </FormSheet>
      )}

      <div data-tour="pt-table" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              {['Label', 'Description', ''].map((h) => (
                <th key={h} style={{ position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 700, color: TEXT.secondary }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} style={{ padding: 20, textAlign: 'center', color: TEXT.secondary }}>Loading…</td></tr>
            ) : terms.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: 20, textAlign: 'center', color: TEXT.secondary }}>No payment terms yet.</td></tr>
            ) : (
              terms.map((t, rowIdx) => (
                <tr key={t.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{t.label}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{t.description || '—'}</td>
                  <td style={{ padding: '10px 14px', display: 'flex', gap: 8 }}>
                    {canRemove(t.created_by_id) && <button onClick={() => startEdit(t)} data-tour={rowIdx === 0 ? 'pt-row-edit-btn' : undefined} style={{ ...smallSecondaryBtnStyle }}>Edit</button>}
                    {canRemove(t.created_by_id) && <button onClick={() => setPendingDelete(t)} data-tour={rowIdx === 0 ? 'pt-row-delete-btn' : undefined} style={{ ...smallDangerBtnStyle }}>Delete</button>}
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
