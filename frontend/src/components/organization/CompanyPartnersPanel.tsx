'use client'

import { useEffect, useState } from 'react'
import { organizationApi, usersApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { DirectoryUser } from '@/types'
import { TEXT, BRAND, BORDER } from '@/lib/theme'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import TeamMemberPicker from '@/components/rnd/TeamMemberPicker'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { useCan } from '@/lib/permissions'

type Partner = { id: number; name: string; email: string; designation?: string | null; is_active: boolean }

/**
 * The company's Partners — portal users (synced from Azure) who are the top
 * approval level: last step of the legacy PO approval chain, management
 * escalation for overdue PM milestones, P2P MIS access, and the default
 * signatory on letters and certificates. This is the only place partners are
 * set, so top-level authority is granted in exactly one place.
 */
export default function CompanyPartnersPanel({ sectionStyle }: { sectionStyle: React.CSSProperties }) {
  const { canFeature } = useCan()
  const [partners, setPartners] = useState<Partner[]>([])
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    organizationApi.listCompanyPartners()
      .then(setPartners)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load partners.').join(' ')))
      .finally(() => setLoading(false))
  }, [])

  const startEdit = () => {
    setError('')
    setDraft(partners.map((p) => p.id))
    setEditing(true)
    if (!users.length) {
      usersApi.directory()
        .then(setUsers)
        .catch((err) => setError(extractErrorMessages(err, 'Could not load the user list.').join(' ')))
    }
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      setPartners(await organizationApi.setCompanyPartners(draft))
      setEditing(false)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save partners.').join(' '))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={sectionStyle} data-tour="org-info-partners-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 12, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', margin: 0 }}>Partners</h2>
        {canFeature('organization', 'info', 'partners', 'edit') && (
          <button type="button" data-tour="org-info-partners-manage" onClick={startEdit} style={secondaryBtnStyle}>{partners.length ? 'Manage partners' : '+ Add partners'}</button>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: TEXT.secondary, margin: '0 0 14px', lineHeight: 1.5 }}>
        Partners are the company&apos;s top approval level: final approvers on legacy purchase orders, escalation contacts for overdue PM milestones,
        and the default signatory on letters and certificates. Pick them from the users synced from Azure.
      </p>

      {error && !editing && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '0 0 10px' }}>{error}</p>}

      {editing && (
        <FormSheet width={580} tour="org-info-partners-form" icon="users" title="Manage Partners" subtitle="The company's top approval level — pick them from the users synced from Azure." onClose={() => setEditing(false)} busy={saving}
          footer={<>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="button" onClick={save} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save partners'}</button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {error && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>
            )}
            <SheetSection icon="users" title="Partners">
              <label style={sheetLabel}>Partner users</label>
              <TeamMemberPicker users={users} value={draft} onChange={setDraft} />
              {draft.length === 0 ? (
                <p style={{ fontSize: 12, color: '#b45309', margin: '8px 0 0' }}>
                  With no partners, nobody can give the final approval on legacy purchase orders still waiting for a Partner.
                </p>
              ) : (
                <p style={sheetHint}>Partners give the final approval on legacy purchase orders, receive escalations, and are the default signatory on letters and certificates.</p>
              )}
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : partners.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>No partners set yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {partners.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.5)', border: `1px solid ${BORDER.normal}`, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>{p.name}</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(244,113,59,0.1)', color: BRAND.primary }}>PARTNER</span>
              {!p.is_active && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(220,38,38,0.1)', color: '#b91c1c' }}>INACTIVE</span>}
              <span style={{ fontSize: 12.5, color: TEXT.secondary }}>{[p.designation, p.email].filter(Boolean).join(' · ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
