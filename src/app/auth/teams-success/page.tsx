'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

// This page only ever runs inside the isolated Teams auth popup opened by
// `microsoftTeams.authentication.authenticate()` on the login page. The
// popup's cookie jar is separate from the main Teams iframe, so we don't try
// to complete the session here — we just hand the one-time code back to the
// parent window via notifySuccess(); the parent exchanges it for real
// session cookies (see authApi.teamsExchange in the login page).
export default function TeamsAuthSuccessPage() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Signing in…')

  useEffect(() => {
    const code = searchParams.get('code')

    const notify = async () => {
      try {
        const { authentication, app } = await import('@microsoft/teams-js')
        await app.initialize()
        if (code) {
          authentication.notifySuccess(code)
        } else {
          authentication.notifyFailure('missing_code')
        }
      } catch {
        setStatus('This page must be opened from inside Microsoft Teams.')
      }
    }
    notify()
  }, [searchParams])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 100% 100%, #fdba8c 0%, #fde8d8 45%, #fffdfb 75%)', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <p style={{ color: '#475569', fontSize: 14, padding: '14px 24px', background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: 16, boxShadow: '0 8px 32px rgba(31,38,135,0.12)' }}>
        {status}
      </p>
    </div>
  )
}
