'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { rndApi } from '@/lib/api'
import { RndSettings } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import RndNav from '@/components/rnd/RndNav'
import { extractErrorMessages } from '@/lib/validation'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 6px' }
const noteStyle: React.CSSProperties = { fontSize: 13, color: TEXT.body, margin: 0, lineHeight: 1.6 }

// Who may create / see Technical Offers is no longer a list here: it is the
// permission R&D › Requirements › "Technical Offer team (every requirement)"
// (View / Create) in Organization › Role & Permissions — on a role, or as one
// user's extra permission.
export default function RndSettingsPage() {
  const { isAuthorized, isLoading } = useRequireApp('rnd')
  const [settings, setSettings] = useState<RndSettings | null>(null)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    rndApi.getSettings()
      .then(setSettings)
      .catch((err) => setError(extractErrorMessages(err, 'Could not load R&D settings. Reload the page.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <RndNav />
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>R&amp;D Module</p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>R&amp;D Settings</h1>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Who heads R&amp;D and who works on Technical Offers — both are set elsewhere; this page explains where.</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div data-tour="rnd-settings-head" style={sectionStyle}>
        <p style={sectionTitle}>R&amp;D Head</p>
        <p style={noteStyle}>
          {settings && settings.heads.length > 0
            ? <><strong>{settings.heads.map((h) => h.name).join(', ')}</strong> — from the R&amp;D department in <strong>Organization › Department</strong>. The head receives new requirements, can always create Technical Offers and releases them to BD.</>
            : <>No R&amp;D head is set in <strong>Organization › Department</strong>, so <strong>every R&amp;D user acts as head</strong> until one is.</>}
        </p>
      </div>

      <div data-tour="rnd-settings-offer-team" style={sectionStyle}>
        <p style={sectionTitle}>Technical Offer team</p>
        <p style={noteStyle}>
          Who can create or see Technical Offers is given in <strong>Organization › Role &amp; Permissions</strong> →
          R&amp;D → Requirements → <strong>Technical Offer team (every requirement)</strong>: <strong>View</strong> = see every requirement and its offers,
          <strong> Create</strong> = also start and edit offers. Tick it on a role, or for one person as their extra permission.
        </p>
      </div>
    </div>
  )
}
