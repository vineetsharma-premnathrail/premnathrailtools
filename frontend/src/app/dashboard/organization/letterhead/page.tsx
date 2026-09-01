'use client'

import { useEffect, useState } from 'react'
import { useRequireAdmin } from '@/hooks/useAuth'
import { organizationApi } from '@/lib/api'
import { Company } from '@/types'
import { TEXT } from '@/lib/theme'
import OrganizationNav from '@/components/organization/OrganizationNav'
import { Field, Section, inputStyle, primaryBtnStyle } from '@/components/shared/ui'

export default function OrganizationLetterheadPage() {
  const { isAuthorized, isLoading } = useRequireAdmin()
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState('')
  const [letterheadHtml, setLetterheadHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await organizationApi.listCompanies()
      setCompanies(data)
      if (data.length && !companyId) {
        setCompanyId(String(data[0].id))
        setLetterheadHtml(data[0].letterhead_html || '')
      }
    } catch {
      setError('Failed to load companies.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthorized) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  const selectCompany = (id: string) => {
    setCompanyId(id)
    const c = companies.find((c) => String(c.id) === id)
    setLetterheadHtml(c?.letterhead_html || '')
    setSaved(false)
  }

  const save = async () => {
    if (!companyId) { setError('Select a company first.'); return }
    setError('')
    setBusy(true)
    try {
      await organizationApi.updateCompany(Number(companyId), { letterhead_html: letterheadHtml })
      setSaved(true)
      await load()
    } catch {
      setError('Failed to save letterhead.')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Organization
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Letter Head</h1>

      <OrganizationNav />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && companies.length === 0 && (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Add a company first, then come back here to set its letterhead.</p>
      )}

      {companies.length > 0 && (
        <Section title="Letterhead">
          <Field label="Company *">
            <select style={inputStyle} value={companyId} onChange={(e) => selectCompany(e.target.value)}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Letterhead HTML">
            <textarea
              style={{ ...inputStyle, minHeight: 220, fontFamily: 'monospace', resize: 'vertical' }}
              value={letterheadHtml}
              onChange={(e) => { setLetterheadHtml(e.target.value); setSaved(false) }}
              placeholder="<div style='text-align:center'>Company header HTML used on generated documents…</div>"
            />
          </Field>
          {saved && <p style={{ fontSize: 12, color: '#16a34a', margin: 0 }}>Saved.</p>}
          <button disabled={busy} onClick={save} style={{ ...primaryBtnStyle, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Saving…' : 'Save Letterhead'}
          </button>
        </Section>
      )}
    </div>
  )
}
