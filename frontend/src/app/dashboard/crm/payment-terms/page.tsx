'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import CrmNav from '@/components/crm/CrmNav'
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, inputStyle } from '@/components/crm/ui'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'

interface PaymentTerm {
  id: number
  label: string
  description: string | null
}

const emptyForm = { label: '', description: '' }

export default function PaymentTermsPage() {
  const { isAuthorized, isLoading } = useRequireApp('crm')
  const [terms, setTerms] = useState<PaymentTerm[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [errorTitle, setErrorTitle] = useState('Cannot Save Payment Term')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    crmApi.listPaymentTerms().then(setTerms).catch(() => { setErrorTitle('Failed to Load Payment Terms'); setError('Failed to load payment terms.') }).finally(() => setLoading(false))
  }

  useEffect(() => { if (isAuthorized) load() }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const startEdit = (t: PaymentTerm) => {
    setEditingId(t.id)
    setForm({ label: t.label, description: t.description || '' })
    setShowForm(true)
  }

  const cancelForm = () => { setEditingId(null); setForm(emptyForm); setShowForm(false) }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      if (editingId) await crmApi.updatePaymentTerm(editingId, form)
      else await crmApi.createPaymentTerm(form)
      cancelForm()
      load()
    } catch (err: any) {
      setErrorTitle('Cannot Save Payment Term')
      setError(extractErrorMessages(err, 'Failed to save payment term.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: number) => {
    try {
      await crmApi.deletePaymentTerm(id)
      load()
    } catch (err: any) {
      setErrorTitle('Cannot Delete Payment Term')
      setError(extractErrorMessages(err, 'Failed to delete payment term.'))
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px' }}>
      <CrmNav />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '16px 0' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Payment Terms List</h1>
        <button
          onClick={() => (showForm ? cancelForm() : setShowForm(true))}
          style={{ ...primaryBtnStyle, alignSelf: 'flex-start', fontWeight: 700, fontSize: 14.5, padding: '12px 24px' }}
        >
          {showForm ? 'Cancel' : '+ Add Payment Term'}
        </button>
      </div>

      <MessageDialog
        open={Array.isArray(error) ? error.length > 0 : !!error}
        variant="error"
        title={errorTitle}
        message={error}
        onClose={() => setError('')}
      />

      {showForm && (
        <form onSubmit={save} style={{ marginBottom: 20, padding: 16, borderRadius: 14, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Label</label>
            <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} required style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Description / Terms Text</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <div><button type="submit" disabled={saving} style={{ ...primaryBtnStyle, opacity: saving ? 0.7 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Payment Term'}</button></div>
        </form>
      )}

      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden' }}>
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
              terms.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{t.label}</td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>{t.description || '—'}</td>
                  <td style={{ padding: '10px 14px', display: 'flex', gap: 8 }}>
                    <button onClick={() => startEdit(t)} style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 12 }}>Edit</button>
                    <button onClick={() => remove(t.id)} style={{ ...dangerBtnStyle, padding: '4px 10px', fontSize: 12 }}>Delete</button>
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
