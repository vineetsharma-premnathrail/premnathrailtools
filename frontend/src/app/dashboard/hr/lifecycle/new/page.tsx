'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrLifecycleEventType, HrLifecycleMeta } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { Field, secondaryBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import HrNav from '@/components/hr/HrNav'
import EventFields, { EMPTY_EVENT_FORM, EventFormState, formToPayload } from '@/components/hr/lifecycle/EventFields'

const TYPES: { value: HrLifecycleEventType; label: string; hint: string; hex: string }[] = [
  { value: 'joining', label: 'Joining', hint: 'New hire or rehire — onboarding checklist', hex: '#16A34A' },
  { value: 'confirmation', label: 'Confirmation', hint: 'Probation completed → confirmed', hex: '#0891B2' },
  { value: 'transfer', label: 'Transfer', hint: 'Department, plant or manager change', hex: '#2563EB' },
  { value: 'promotion', label: 'Promotion', hint: 'New designation or grade', hex: '#7C3AED' },
  { value: 'exit', label: 'Exit', hint: 'Resignation, termination… — offboarding', hex: '#DC2626' },
]

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const h3: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }

function NewEventInner() {
  const { isAuthorized, isLoading, user } = useRequireApp('hr')
  const router = useRouter()
  const search = useSearchParams()

  const initialType = (TYPES.find((t) => t.value === search.get('type'))?.value || 'joining') as HrLifecycleEventType
  const [type, setType] = useState<HrLifecycleEventType>(initialType)
  const [meta, setMeta] = useState<HrLifecycleMeta | null>(null)
  const [metaError, setMetaError] = useState<string[]>([])
  const [subjectMode, setSubjectMode] = useState<'candidate' | 'user'>(search.get('user_id') ? 'user' : 'candidate')
  const [userId, setUserId] = useState(search.get('user_id') || '')
  const [form, setForm] = useState<EventFormState>(EMPTY_EVENT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (!isAuthorized) return
    const includeId = Number(search.get('user_id')) || undefined
    hrApi.getLifecycleMeta(includeId ? { include_user_id: includeId } : {}).then(setMeta).catch((err) => setMetaError(extractErrorMessages(err, 'Could not load the form lists.')))
  }, [isAuthorized, search])

  const userOptions = useMemo(
    () => (meta?.users || []).filter((u) => u.id !== user?.id).map((u) => ({ value: String(u.id), label: `${u.name} — ${u.email}` })),
    [meta, user],
  )
  const picked = meta?.users.find((u) => String(u.id) === userId)
  const needsUser = type !== 'joining' || subjectMode === 'user'

  const submit = async (status: 'draft' | 'in_progress') => {
    setError([])
    if (needsUser && !userId) { setError(['Pick the employee this event is for.']); return }
    if (type === 'joining' && subjectMode === 'candidate' && !form.candidate_name.trim()) {
      setError(["Enter the new joiner's name."]); return
    }
    if (type === 'joining' && subjectMode === 'candidate' && form.candidate_email.trim() && !/^\S+@\S+\.\S+$/.test(form.candidate_email.trim())) {
      setError(["The work email doesn't look right — check it, or leave it blank and link the portal user later."]); return
    }
    if (type === 'exit' && !form.last_working_day) { setError(['Enter the last working day.']); return }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { ...formToPayload(type, form), event_type: type, status }
      if (needsUser) payload.user_id = Number(userId)
      if (type === 'joining' && subjectMode === 'user') { payload.candidate_name = null; payload.candidate_email = null }
      const ev = await hrApi.createLifecycleEvent(payload)
      router.push(`/dashboard/hr/lifecycle/${ev.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not create the lifecycle event.'))
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <HrNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            HR &amp; Administration · Lifecycle
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>New Lifecycle Event</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>The checklist is copied from the templates in HR &gt; Masters &gt; Checklist Templates.</p>
        </div>
        <button onClick={() => router.push('/dashboard/hr/lifecycle')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {(error.length > 0 || metaError.length > 0) && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {[...metaError, ...error].join(' ')}
        </div>
      )}

      <div style={sectionStyle}>
        <h3 style={h3}>Event type</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {TYPES.map((t) => {
            const active = t.value === type
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                style={{
                  flex: '1 1 170px', maxWidth: 240, textAlign: 'left', padding: '12px 14px', borderRadius: 14, cursor: 'pointer',
                  border: active ? `1.5px solid ${t.hex}` : `1px solid ${BORDER.normal}`,
                  background: active ? `${t.hex}12` : 'rgba(255,255,255,0.7)',
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 700, color: active ? t.hex : TEXT.heading }}>{t.label}</div>
                <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 2 }}>{t.hint}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div style={sectionStyle}>
        <h3 style={h3}>{type === 'joining' ? 'New joiner' : 'Employee'}</h3>
        {type === 'joining' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {([['candidate', 'Not in the portal yet'], ['user', 'Already has a portal account']] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSubjectMode(k)}
                style={{
                  fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 9999, cursor: 'pointer',
                  border: subjectMode === k ? '1px solid #FF6A2A' : '1px solid rgba(0,0,0,0.1)',
                  background: subjectMode === k ? 'rgba(255,106,42,0.1)' : 'rgba(255,255,255,0.7)',
                  color: subjectMode === k ? '#e0521a' : '#57534e',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {type === 'joining' && subjectMode === 'candidate' ? (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
                <Field label="Full name *">
                  <input style={inputStyle} value={form.candidate_name} onChange={(e) => setForm({ ...form, candidate_name: e.target.value })} placeholder="As on the offer letter" />
                </Field>
              </div>
              <div style={{ flex: '1 1 260px', maxWidth: 340 }}>
                <Field label="Work email">
                  <input style={inputStyle} value={form.candidate_email} onChange={(e) => setForm({ ...form, candidate_email: e.target.value })} placeholder="name@premnathrail.com" />
                </Field>
              </div>
            </div>
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '10px 0 0' }}>
              Once IT creates the Microsoft account and the joiner signs in once, use <b>Link user</b> on the event — the portal user is found by this email.
            </p>
          </>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 300px', maxWidth: 420 }}>
              <Field label="Employee *">
                <SearchableSelect value={userId} onChange={setUserId} options={userOptions} placeholder={meta ? 'Search by name or email…' : 'Loading…'} />
              </Field>
            </div>
            {picked && (
              <p style={{ flex: '1 1 240px', fontSize: 12.5, color: TEXT.muted, margin: '0 0 10px' }}>
                Currently: {[picked.designation, picked.department].filter(Boolean).join(' · ') || 'no designation or department on record'}
              </p>
            )}
          </div>
        )}
      </div>

      <div style={sectionStyle}>
        <h3 style={h3}>Details</h3>
        {meta ? (
          <EventFields type={type} form={form} setForm={setForm} meta={meta} subjectUserId={needsUser && userId ? Number(userId) : null} />
        ) : (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{metaError.length ? 'The form lists could not be loaded.' : 'Loading…'}</p>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" disabled={saving || !meta} onClick={() => submit('draft')} style={secondaryBtnStyle}>Save as draft</button>
        <button
          type="button"
          disabled={saving || !meta}
          onClick={() => submit('in_progress')}
          style={{
            padding: '11px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'wait' : 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
            opacity: saving || !meta ? 0.7 : 1,
          }}
        >
          {saving ? 'Creating…' : 'Create & start checklist'}
        </button>
      </div>
    </div>
  )
}

export default function HrLifecycleNewPage() {
  return (
    <Suspense fallback={null}>
      <NewEventInner />
    </Suspense>
  )
}
