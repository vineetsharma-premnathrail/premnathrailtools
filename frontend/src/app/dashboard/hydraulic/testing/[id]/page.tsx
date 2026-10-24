'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydTest } from '@/types'
import { TEXT, DANGER, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, InfoRow, primaryBtnStyle } from '@/components/shared/ui'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import TestForm from '@/components/hydraulic/TestForm'
import HydDocumentsPanel from '@/components/hydraulic/HydDocumentsPanel'
import { SYSTEM_TYPE_LABELS, TEST_TYPE_LABELS, withUnit } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'
import { useCan } from '@/lib/permissions'
import { FormSheet, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetHint, Req, Optional } from '@/components/shared/FormSheet'

const STATUS_LABELS: Record<string, string> = { planned: 'Planned', in_progress: 'In Progress', under_review: 'Awaiting Sign-off', completed: 'Completed' }
const STATUS_HEX: Record<string, string> = { planned: '#2563EB', in_progress: '#F59E0B', under_review: '#9333EA', completed: '#16A34A' }
const RESULT_LABELS: Record<string, string> = { pending: 'Pending', pass: 'Pass', fail: 'Fail', conditional: 'Conditional' }
const RESULT_HEX: Record<string, string> = { pending: '#78716c', pass: '#16A34A', fail: '#DC2626', conditional: '#F59E0B' }
const READING_LABELS: Record<string, string> = { pass: 'Pass', fail: 'Fail', na: 'N/A' }
const READING_HEX: Record<string, string> = { pass: '#16A34A', fail: '#DC2626', na: '#78716c' }

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const primaryBtn: React.CSSProperties = { ...primaryBtnStyle, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}` }
const errorBanner: React.CSSProperties = {
  padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)',
  border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13,
}
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })
const disabledStyle = (disabled: boolean): React.CSSProperties => (disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {})

const limitText = (min?: number | null, max?: number | null) => {
  if (min != null && max != null) return `${min} – ${max}`
  if (min != null) return `≥ ${min}`
  if (max != null) return `≤ ${max}`
  return '—'
}

export default function HydTestDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('hydraulic')
  const { can, canDelete, canFeature } = useCan()
  // Testing › Approve signs a result off directly; Testing › Submit sends it
  // to a signer through the approval engine (Organization › Approval Workflows).
  const canSignOff = can('hydraulic', 'testing', 'approve')
  const canSubmitResult = can('hydraulic', 'testing', 'submit')
  // Saving / starting needs testing:edit; a re-test is a new test (testing:create).
  const canEditTest = can('hydraulic', 'testing', 'edit')
  const canRetest = canFeature('hydraulic', 'testing', 'retest', 'create')  // Raise re-test feature (default: testing:create)
  const router = useRouter()
  const params = useParams()
  const ref = params.id as string
  const { id: resolvedId, error: linkError } = useRecordId(ref)
  const testId = resolvedId ?? 0

  const [test, setTest] = useState<HydTest | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [saved, setSaved] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [completeResult, setCompleteResult] = useState('')
  const [completeRemarks, setCompleteRemarks] = useState('')
  const [completeError, setCompleteError] = useState<string | string[]>('')

  // Bumped after a decision in the approval panel to re-read the test.
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    if (!isAuthorized || !testId) return
    hydraulicApi.getTest(testId)
      .then(setTest)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load test.')))
  }, [isAuthorized, testId, reloadKey])

  const failedParams = test?.readings.filter((r) => r.result === 'fail').map((r) => r.parameter) || []

  const handleStart = async () => {
    setError(''); setSaved('')
    setBusy(true)
    try {
      setTest(await hydraulicApi.startTest(testId))
      setSaved('Test started.')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to start test.'))
    } finally {
      setBusy(false)
    }
  }

  const openComplete = () => {
    setCompleteResult(failedParams.length ? 'fail' : '')
    setCompleteRemarks(test?.remarks || '')
    setCompleteError('')
    setShowComplete(true)
  }

  const handleComplete = async () => {
    setCompleteError('')
    if (!completeResult) { setCompleteError('Pick the test result — Pass, Fail or Conditional.'); return }
    if (completeResult === 'conditional' && !completeRemarks.trim()) {
      setCompleteError('A conditional pass needs remarks saying what the condition or concession is (and who agreed it).'); return
    }
    setBusy(true)
    try {
      const remarks = completeRemarks.trim() || undefined
      const done: HydTest = canSignOff
        ? await hydraulicApi.completeTest(testId, completeResult, remarks)
        : await hydraulicApi.submitTestResult(testId, completeResult, remarks)
      setTest(done)
      setShowComplete(false)
      setSaved(done.status === 'completed'
        ? `Test completed — ${RESULT_LABELS[done.result] || done.result}.`
        : `Result (${RESULT_LABELS[done.result] || done.result}) sent for sign-off — the approvers have been notified.`)
    } catch (err) {
      setCompleteError(extractErrorMessages(err, 'Failed to complete test.'))
    } finally {
      setBusy(false)
    }
  }

  const handleRetest = async () => {
    setError('')
    setBusy(true)
    try {
      const next = await hydraulicApi.retest(testId)
      router.push(recordPath('/dashboard/hydraulic/testing', next))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise a re-test.'))
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setConfirmDelete(false)
    try {
      await hydraulicApi.deleteTest(testId)
      router.push('/dashboard/hydraulic/testing')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete test.'))
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><HydraulicNav /><InvalidRecordLink message={linkError} listHref="/dashboard/hydraulic/testing" listLabel="Back to tests" /></div>)
  if (!resolvedId) return <div><HydraulicNav /></div>

  const completed = test?.status === 'completed'
  const underReview = (test?.status as string | undefined) === 'under_review'  // shared HydTestStatus type predates the sign-off step
  // Pending central sign-off request; the result is locked while it waits.
  const approvalRequestId = (test as (HydTest & { approval_request_id?: number | null }) | null)?.approval_request_id ?? null
  const canFinish = underReview ? (canSignOff && !approvalRequestId) : (canSignOff || canSubmitResult)
  const finishLabel = canSignOff ? 'Complete Test' : 'Submit Result for Sign-off'
  const subject = test ? [
    test.system_number ? `${test.system_number}${test.system_name ? ` — ${test.system_name}` : ''}` : null,
    test.component_code ? `${test.component_code}${test.component_name ? ` — ${test.component_name}` : ''}` : null,
  ].filter(Boolean).join(' · ') : ''

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic · Test
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>{test ? `${test.test_number} — ${test.title}` : 'Test'}</h1>
          {test && (
            <div data-tour="hyd-testd-badges" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
              <span style={pill(STATUS_HEX[test.status])}>{STATUS_LABELS[test.status] || test.status}</span>
              <span style={pill(RESULT_HEX[test.result])}>{RESULT_LABELS[test.result] || test.result}</span>
              <span style={{ fontSize: 13, color: TEXT.secondary }}>{TEST_TYPE_LABELS[test.test_type] || test.test_type} · {SYSTEM_TYPE_LABELS[test.system_type] || test.system_type}</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {test && !completed && (
            <>
              {test.status === 'planned' && canEditTest && (
                <button data-tour="hyd-testd-start-btn" type="button" onClick={handleStart} disabled={busy || dirty} title={dirty ? 'Save your changes first' : undefined}
                  style={{ ...secondaryBtnStyle, ...disabledStyle(busy || dirty) }}>
                  Start Test
                </button>
              )}
              {canFinish && <button data-tour="hyd-testd-complete-btn" type="button" onClick={openComplete} disabled={busy} style={{ ...primaryBtn, ...disabledStyle(busy) }}>{finishLabel}</button>}
              {canDelete('hydraulic', 'testing', (test as { created_by_id?: number | null } | null)?.created_by_id ?? null) && <button data-tour="hyd-testd-delete-btn" type="button" onClick={() => setConfirmDelete(true)} style={{ ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }}>Delete</button>}
            </>
          )}
          {test && completed && canRetest && (
            <button data-tour="hyd-testd-retest-btn" type="button" onClick={handleRetest} disabled={busy} style={{ ...primaryBtn, ...disabledStyle(busy) }}>Raise Re-test</button>
          )}
          <button data-tour="hyd-testd-back-btn" onClick={() => router.push('/dashboard/hydraulic/testing')} type="button" style={secondaryBtnStyle}>← Back</button>
        </div>
      </div>

      {error && <div style={errorBanner}>{Array.isArray(error) ? error.join(' ') : error}</div>}
      {saved && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {saved}
        </div>
      )}

      {test && (
        <ApprovalPanel
          key={`${test.id}-${test.status}-${approvalRequestId}`}
          entityType="hyd_test"
          entityId={test.id}
          title="Result sign-off"
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}

      {test && showComplete && !completed && canFinish && (
        <FormSheet
          width={580} icon="check" iconColor="#16A34A" tour="hyd-testd-complete-form"
          title={`${canSignOff ? 'Complete' : 'Submit result of'} ${test.test_number}`}
          subtitle={canSignOff ? 'Signs the result off — the test is then locked.' : 'Sends the result to a signer — the approvers are notified.'}
          onClose={() => setShowComplete(false)} busy={busy}
          footer={<>
            <button data-tour="hyd-testd-complete-cancel-btn" type="button" onClick={() => setShowComplete(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button data-tour="hyd-testd-complete-submit-btn" type="button" onClick={handleComplete} disabled={busy || dirty || test.readings.length === 0}
              style={sheetBtn('primary', '#16A34A', busy || dirty || test.readings.length === 0)}>
              <SheetIcon name="check" size={16} />{busy ? 'Saving…' : finishLabel}
            </button>
          </>}
        >
          <div style={{ padding: '20px 24px' }}>
            {completeError && <div style={errorBanner}>{Array.isArray(completeError) ? completeError.join(' ') : completeError}</div>}
            {dirty && (
              <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: '#92400E', fontSize: 13 }}>
                You have unsaved changes on the page. Completing uses the saved readings — close this, click &quot;Save Changes&quot; first.
              </div>
            )}
            {test.readings.length === 0 && (
              <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: '#92400E', fontSize: 13 }}>
                No readings are saved yet. Record at least one reading (parameter and measured value) and save before completing.
              </div>
            )}
            <SheetSection icon="flag" title="Result">
              <div data-tour="hyd-testd-complete-result" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['pass', 'fail', 'conditional'] as const).map((r) => {
                  const disabled = r === 'pass' && failedParams.length > 0
                  const active = completeResult === r
                  return (
                    <button key={r} type="button" disabled={disabled} onClick={() => setCompleteResult(r)}
                      style={{
                        ...sheetBtn('secondary', SHEET.INK, disabled),
                        ...(active ? { background: `${RESULT_HEX[r]}1a`, color: RESULT_HEX[r], borderColor: RESULT_HEX[r] } : {}),
                      }}>
                      {RESULT_LABELS[r]}
                    </button>
                  )
                })}
              </div>
              {failedParams.length > 0 && (
                <p style={{ ...sheetHint, color: DANGER.primary }}>
                  Pass isn&apos;t available — {failedParams.length} reading(s) are outside their limits: {failedParams.join(', ')}. Mark it Failed, or Conditional with remarks explaining the concession.
                </p>
              )}
            </SheetSection>
            <SheetSection icon="chat" title="Remarks" extra={completeResult === 'conditional' ? <Req /> : <Optional />}>
              <textarea data-tour="hyd-testd-complete-remarks" style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={completeRemarks} onChange={(e) => setCompleteRemarks(e.target.value)}
                placeholder={completeResult === 'conditional' ? 'The condition or concession, and who agreed it…' : 'Optional'} aria-label="Remarks" />
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {test && !completed && !underReview && canEditTest && (
        <TestForm
          key={test.updated_at || test.id}
          title={`Edit ${test.test_number}`}
          subtitle="Conditions and readings — save before starting or completing the test."
          initial={test}
          submitLabel="Save Changes"
          onDirtyChange={setDirty}
          onSubmit={async (payload) => {
            setSaved('')
            const updated = await hydraulicApi.updateTest(testId, payload)
            setTest(updated)
            setSaved(updated.status !== test.status ? `Test saved — now ${STATUS_LABELS[updated.status] || updated.status}.` : 'Test saved.')
          }}
        />
      )}

      {test && (completed || underReview || !canEditTest) && (
        <>
          <div data-tour="hyd-testd-record" style={cardStyle}>
            <p style={sectionTitle}>Test Record</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 28px' }}>
              {([
                ['Subject', subject || '—'],
                ['Component Serial No.', test.component_serial || '—'],
                ['Test Date', formatDate(test.test_date)],
                ['Test Standard', test.test_standard || '—'],
                ['Test Pressure', withUnit(test.test_pressure_bar, 'bar')],
                ['Hold Time', withUnit(test.hold_time_min, 'min')],
                ['Test Medium', test.test_medium || '—'],
                ['Ambient / Fluid', `${withUnit(test.ambient_temp_c, '°C')} / ${withUnit(test.fluid_temp_c, '°C')}`],
                ['Tested By', test.tested_by_name || '—'],
                ['Witnessed By', test.witnessed_by || '—'],
                ['Completed By', test.completed_by_name || '—'],
                ['Completed At', formatDateTime(test.completed_at)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} style={{ flex: '0 1 220px', minWidth: 180 }}><InfoRow label={label} value={value} /></div>
              ))}
            </div>
          </div>

          <div data-tour="hyd-testd-readings" style={{ ...cardStyle, padding: 0, overflow: 'auto' }}>
            <p style={{ ...sectionTitle, padding: '20px 20px 0' }}>
              Readings ({test.readings.length}){test.failed_readings > 0 && <span style={{ color: DANGER.primary, marginLeft: 8 }}>{test.failed_readings} failed</span>}
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr>
                  {['Parameter', 'Specification', 'Limits', 'Measured', 'Result', 'Remarks'].map((h) => <th key={h} style={thStyle}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {test.readings.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No readings recorded.</td></tr>
                ) : test.readings.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{r.parameter}</td>
                    <td style={tdStyle}>{r.specification || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{limitText(r.min_value, r.max_value)}{(r.min_value != null || r.max_value != null) && r.unit ? ` ${r.unit}` : ''}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {r.measured_value != null ? `${r.measured_value}${r.unit ? ` ${r.unit}` : ''}` : ''}
                      {r.measured_value != null && r.measured_text ? ' · ' : ''}
                      {r.measured_text || (r.measured_value == null ? '—' : '')}
                    </td>
                    <td style={tdStyle}><span style={pill(READING_HEX[r.result])}>{READING_LABELS[r.result] || r.result}</span></td>
                    <td style={tdStyle}>{r.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(test.observations || test.remarks) && (
            <div style={cardStyle}>
              <p style={sectionTitle}>Notes</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 28px' }}>
                {test.observations && <div style={{ flex: '1 1 300px' }}><InfoRow label="Observations" value={test.observations} /></div>}
                {test.remarks && <div style={{ flex: '1 1 300px' }}><InfoRow label="Remarks" value={test.remarks} /></div>}
              </div>
            </div>
          )}
        </>
      )}

      {test && (
        <div style={{ marginTop: completed ? 0 : 20 }}>
          <HydDocumentsPanel entityType="test" entityId={test.id} title="Test Certificates & Reports" defaultDocType="test_certificate"
            currentUserId={user?.id} isAdmin={user?.role === 'admin'}
            readOnly={completed}
            readOnlyNote="This test is completed and locked — its certificates can't be added or removed. Raise a re-test to attach a new certificate." />
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete test?"
        message={`${test?.test_number} and its readings will be removed. Only tests that aren't completed can be deleted.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
