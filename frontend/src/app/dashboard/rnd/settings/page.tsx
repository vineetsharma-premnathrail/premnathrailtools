'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { RndOfferPerson, RndPerson, RndSettings } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import RndNav from '@/components/rnd/RndNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { dangerBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 6px' }
const noteStyle: React.CSSProperties = { fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px', lineHeight: 1.55 }
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer', background: GRADIENTS.primary,
  color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 6px 16px ${SHADOWS.glowOrange}`,
}

export default function RndSettingsPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const [settings, setSettings] = useState<RndSettings | null>(null)
  const [people, setPeople] = useState<RndPerson[]>([])
  const [creators, setCreators] = useState<number[]>([])
  const [viewers, setViewers] = useState<number[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const apply = (s: RndSettings) => {
    setSettings(s)
    setCreators(s.creators.map((m) => m.user_id))
    setViewers(s.viewers.map((m) => m.user_id))
  }

  useEffect(() => {
    if (!isAuthorized) return
    rndApi.getSettings()
      .then(apply)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load R&D settings. Reload the page.')))
    rndApi.people().then(setPeople).catch(() => setPeople([]))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const canEdit = !!settings?.can_edit
  const known: RndOfferPerson[] = [...(settings?.creators ?? []), ...(settings?.viewers ?? [])]
  const nameOf = (id: number) => people.find((p) => p.id === id)?.name || known.find((m) => m.user_id === id)?.name || `User #${id}`
  const headIds = new Set((settings?.heads ?? []).map((h) => h.user_id))
  const free = people.filter((p) => !headIds.has(p.id) && !creators.includes(p.id) && !viewers.includes(p.id))
    .map((p) => ({ value: String(p.id), label: p.designation ? `${p.name} — ${p.designation}` : p.name }))

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      apply(await rndApi.saveSettings({ creator_ids: creators, viewer_ids: viewers }))
      setSaved(true)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not save the Technical Offer permissions.'))
    } finally {
      setSaving(false)
    }
  }

  const list = (ids: number[], setIds: (v: number[]) => void, title: string, note: React.ReactNode, tour: string) => (
    <div data-tour={tour} style={sectionStyle}>
      <p style={sectionTitle}>{title}</p>
      <p style={noteStyle}>{note}</p>
      {ids.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 12px' }}>Nobody selected.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {ids.map((id) => {
            const info = known.find((m) => m.user_id === id)
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,0.55)' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: TEXT.heading, margin: 0 }}>{nameOf(id)}</p>
                  {info && (!info.is_active || !info.has_rnd_app) && (
                    <p style={{ fontSize: 11.5, color: '#b91c1c', margin: '2px 0 0' }}>{!info.is_active ? 'Deactivated — remove them.' : 'No longer has R&D access — remove them or grant it in Organization › Role & Permissions.'}</p>
                  )}
                </div>
                {canEdit && (
                  <button type="button" onClick={() => setIds(ids.filter((x) => x !== id))} style={{ ...dangerBtnStyle, padding: '6px 12px', fontSize: 11.5 }}>Remove</button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {canEdit && (
        <div style={{ maxWidth: 360 }}>
          <SearchableSelect
            value=""
            onChange={(v) => { if (v) setIds([...ids, Number(v)]) }}
            placeholder={free.length ? 'Select person (R&D access only)…' : 'Everyone with R&D access is already listed'}
            options={free}
          />
        </div>
      )}
    </div>
  )

  return (
    <div>
      <RndNav />
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: TEXT.heading, margin: 0 }}>R&amp;D Settings</h1>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Who can create and who can see Technical Offers.</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <p style={{ ...noteStyle, margin: '0 0 16px' }}>
        R&amp;D module access is given in <strong>Organization › Role &amp; Permissions</strong>. R&amp;D Head{' '}
        {settings && settings.heads.length > 0
          ? <>(<strong>{settings.heads.map((h) => h.name).join(', ')}</strong>) comes from the R&amp;D department in <strong>Organization › Department</strong> and can always create Technical Offers.</>
          : <>comes from the R&amp;D department in <strong>Organization › Department</strong> — none is set, so <strong>every R&amp;D user acts as head</strong> until one is.</>}
      </p>

      {list(creators, (v) => { setCreators(v); setSaved(false) }, 'Can create Technical Offers',
        <>These people can start a Technical Offer on any TOR and edit its Word document. Releasing to BD stays with the R&amp;D head.</>, 'rnd-settings-creators')}
      {list(viewers, (v) => { setViewers(v); setSaved(false) }, 'Can see Technical Offers',
        <>View only: these people see every requirement and its Technical Offers and can download them, but can&apos;t create, edit, release or revise.</>, 'rnd-settings-viewers')}

      {canEdit ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" onClick={save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
          {saved && <span style={{ fontSize: 12.5, color: '#16A34A', fontWeight: 600 }}>Saved.</span>}
        </div>
      ) : settings && <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>Only an R&amp;D head or an admin can change these.</p>}
    </div>
  )
}
