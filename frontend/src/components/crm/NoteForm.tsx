'use client'

import { useEffect, useState } from 'react'
import { crmApi } from '@/lib/api'
import { CrmNote, Organization } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { Field, Section, inputStyle, primaryBtnStyle, secondaryBtnStyle } from './ui'

export default function NoteForm({
  initial,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial?: CrmNote
  submitLabel: string
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
  const editing = !!initial
  const [orgId, setOrgId] = useState(initial?.org_id ? String(initial.org_id) : '')
  const [note, setNote] = useState(initial?.note || '')
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!editing) crmApi.listOrganizations().then(setOrganizations)
  }, [editing])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = { note }
      if (!editing && orgId) payload.org_id = Number(orgId)
      await onSubmit(payload)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to save note.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <Section title="Note">
        {!editing && (
          <Field label="Organization">
            <SearchableSelect
              value={orgId}
              onChange={setOrgId}
              options={organizations.map((o) => ({ value: String(o.id), label: o.name }))}
              placeholder="Type to search organization…"
            />
          </Field>
        )}
        <Field label="Note *">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} required rows={10} placeholder="Write your note here…" style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
      </Section>

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" onClick={onCancel} style={{ ...secondaryBtnStyle, flex: 1 }}>Cancel</button>
        <button type="submit" disabled={saving} style={{ ...primaryBtnStyle, flex: 1, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
