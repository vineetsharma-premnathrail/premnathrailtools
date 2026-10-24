'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hrApi } from '@/lib/api'
import { HrLifecycleEventType, HrLifecycleMeta } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { smallSecondaryBtnStyle } from '@/components/shared/ui'
import HrNav from '@/components/hr/HrNav'
import EventFields, { EMPTY_EVENT_FORM, EventFormState, formToPayload } from '@/components/hr/lifecycle/EventFields'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'

const TYPES: { value: HrLifecycleEventType; label: string; hint: string; hex: string }[] = [
  { value: 'joining', label: 'Joining', hint: 'New hire or rehire — onboarding checklist', hex: '#16A34A' },
  { value: 'confirmation', label: 'Confirmation', hint: 'Probation completed → confirmed', hex: '#0891B2' },
  { value: 'transfer', label: 'Transfer', hint: 'Department, plant or manager change', hex: '#2563EB' },
  { value: 'promotion', label: 'Promotion', hint: 'New designation or grade', hex: '#7C3AED' },
  { value: 'exit', label: 'Exit', hint: 'Resignation, termination… — offboarding', hex: '#DC2626' },
]

function NewEventInner() {
  const { isAuthorized, isLoading, user } = useRequireApp('hr')
  const router = useRouter()
  const search = useSearchParams()

  const initialType = (TYPES.find((t) => t.value === search.get('type'))?.value || 'joining') as HrLifecycleEventType
  const [type, setType] = useState<HrLifecycleEventType>(initialType)
  const [meta, setMeta] = useState<HrLifecycleMeta | null>(null)
  const [metaError, setMetaError] = useState<string[]>([])
  const [subjectMode, setSubjectMode] = useState<'candidate' | 'user'>(search.get('user_id') ? 'user' : 'candidate')
  // ?user_id= carries a signed record ref (lib/recordRef.ts).
  const { id: presetUserId, error: userLinkError, loading: userLinkLoading } = useRecordId(search.get('user_id'))
  const [userId, setUserId] = useState('')
  useEffect(() => { if (presetUserId) setUserId(String(presetUserId)) }, [presetUserId])
  const [form, setForm] = useState<EventFormState>(EMPTY_EVENT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    if (!isAuthorized || userLinkLoading) return
    const includeId = presetUserId || undefined
    hrApi.getLifecycleMeta(includeId ? { include_user_id: includeId } : {}).then(setMeta).catch((err) => setMetaError(extractErrorMessages(err, 'Could not load the form lists.')))
  }, [isAuthorized, presetUserId, userLinkLoading])

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
      router.push(recordPath('/dashboard/hr/lifecycle', ev))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not create the lifecycle event.'))
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (userLinkError) return (<div><HrNav /><InvalidRecordLink message={userLinkError} listHref="/dashboard/hr/lifecycle" listLabel="Back to lifecycle" /></div>)
  if (userLinkLoading) return <div><HrNav /></div>

  const activeType = TYPES.find((t) => t.value === type) || TYPES[0]

  return (
    <div>
      <FormPage nav={<HrNav />} tour="hr-lcn-form" icon="flag" iconColor={activeType.hex} title="New Lifecycle Event"
        subtitle="The checklist is copied from the templates in HR > Masters > Checklist Templates."
        onBack={() => router.push('/dashboard/hr/lifecycle')} backTour="hr-lcn-back"
        footer={<>
          <button type="button" style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving} onClick={() => router.push('/dashboard/hr/lifecycle')}>Cancel</button>
          <button type="button" data-tour="hr-lcn-draft-btn" disabled={saving || !meta} onClick={() => submit('draft')} style={sheetBtn('secondary', SHEET.INK, saving || !meta)}><SheetIcon name="doc" size={15} />Save as draft</button>
          <button type="button" data-tour="hr-lcn-start-btn" disabled={saving || !meta} onClick={() => submit('in_progress')} style={sheetBtn('primary', SHEET.BLUE, saving || !meta)}>
            <SheetIcon name="check" size={16} />{saving ? 'Creating…' : 'Create & start checklist'}
          </button>
        </>}>
        <SheetColumns
          left={<>
            {(error.length > 0 || metaError.length > 0) && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {[...metaError, ...error].join(' ')}
              </div>
            )}

            <SheetSection icon="flag" title="Event Type">
              <div data-tour="hr-lcn-type" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {TYPES.map((t) => {
                  const active = t.value === type
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setType(t.value)}
                      style={{
                        flex: '1 1 150px', maxWidth: 220, textAlign: 'left', padding: '10px 12px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                        border: active ? `1.5px solid ${t.hex}` : `1px solid ${SHEET.LINE}`,
                        background: active ? `${t.hex}12` : '#fff',
                      }}
                    >
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: active ? t.hex : SHEET.INK }}>{t.label}</div>
                      <div style={{ fontSize: 11.5, color: SHEET.MUTED, marginTop: 2 }}>{t.hint}</div>
                    </button>
                  )
                })}
              </div>
            </SheetSection>

            <SheetSection icon="user" title={type === 'joining' ? 'New Joiner' : 'Employee'}>
              {type === 'joining' && (
                <div data-tour="hr-lcn-subject-mode" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  {([['candidate', 'Not in the portal yet'], ['user', 'Already has a portal account']] as const).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setSubjectMode(k)}
                      style={{
                        ...smallSecondaryBtnStyle, borderRadius: 9999, fontFamily: 'inherit',
                        border: subjectMode === k ? `1px solid ${SHEET.BLUE}` : `1px solid ${SHEET.LINE}`,
                        background: subjectMode === k ? '#eff6ff' : '#fff',
                        color: subjectMode === k ? SHEET.BLUE : SHEET.BODY,
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
                    <div data-tour="hr-lcn-candidate-name" style={{ flex: '1 1 240px', maxWidth: 340 }}>
                      <label style={sheetLabel}>Full name <Req /></label>
                      <input style={sheetInput} value={form.candidate_name} onChange={(e) => setForm({ ...form, candidate_name: e.target.value })} placeholder="As on the offer letter" />
                    </div>
                    <div data-tour="hr-lcn-candidate-email" style={{ flex: '1 1 260px', maxWidth: 340 }}>
                      <label style={sheetLabel}>Work email</label>
                      <input style={sheetInput} value={form.candidate_email} onChange={(e) => setForm({ ...form, candidate_email: e.target.value })} placeholder="name@premnathrail.com" />
                    </div>
                  </div>
                  <p style={sheetHint}>
                    Once IT creates the Microsoft account and the joiner signs in once, use <b>Link user</b> on the event — the portal user is found by this email.
                  </p>
                </>
              ) : (
                <div data-tour="hr-lcn-employee" style={{ maxWidth: 420 }}>
                  <label style={sheetLabel}>Employee <Req /></label>
                  <SearchableSelect value={userId} onChange={setUserId} options={userOptions} placeholder={meta ? 'Search by name or email…' : 'Loading…'} />
                </div>
              )}
            </SheetSection>

            <SheetSection icon="list" title="Details">
              {meta ? (
                <EventFields type={type} form={form} setForm={setForm} meta={meta} subjectUserId={needsUser && userId ? Number(userId) : null} />
              ) : (
                <p style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>{metaError.length ? 'The form lists could not be loaded.' : 'Loading…'}</p>
              )}
            </SheetSection>
          </>}
          right={<>
            <SheetSection icon="flag" title="Summary" color={activeType.hex}>
              <div style={{ fontSize: 13, color: SHEET.BODY, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div><span style={{ color: SHEET.MUTED }}>Type: </span><b style={{ color: activeType.hex }}>{activeType.label}</b> — {activeType.hint}</div>
                <div>
                  <span style={{ color: SHEET.MUTED }}>{type === 'joining' && subjectMode === 'candidate' ? 'Joiner: ' : 'Employee: '}</span>
                  <b style={{ color: SHEET.INK }}>{type === 'joining' && subjectMode === 'candidate' ? (form.candidate_name.trim() || '—') : (picked?.name || '—')}</b>
                </div>
                {picked && needsUser && (
                  <div><span style={{ color: SHEET.MUTED }}>Currently: </span>{[picked.designation, picked.department].filter(Boolean).join(' · ') || 'no designation or department on record'}</div>
                )}
              </div>
            </SheetSection>
            <SheetSection icon="list" title="What Happens Next">
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: SHEET.MUTED, lineHeight: 1.6 }}>
                <li><b>Create &amp; start checklist</b> copies the {activeType.label.toLowerCase()} checklist and notifies each task owner.</li>
                <li><b>Save as draft</b> keeps the event without starting the checklist.</li>
              </ul>
            </SheetSection>
          </>}
        />
      </FormPage>
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
