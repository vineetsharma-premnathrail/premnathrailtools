'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { hydraulicApi } from '@/lib/api'
import { HydCircuit } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import { secondaryBtnStyle, InfoRow } from '@/components/shared/ui'
import HydraulicNav from '@/components/hydraulic/HydraulicNav'
import CircuitForm from '@/components/hydraulic/CircuitForm'
import HydDocumentsPanel from '@/components/hydraulic/HydDocumentsPanel'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import PromptDialog from '@/components/erp/PromptDialog'
import { SYSTEM_TYPE_LABELS } from '@/components/hydraulic/labels'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate, formatDateTime } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', under_review: 'Under Review', approved: 'Approved', superseded: 'Superseded' }
const STATUS_HEX: Record<string, string> = { draft: '#78716c', under_review: '#2563EB', approved: '#16A34A', superseded: '#a8a29e' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
}
const dangerBtn: React.CSSProperties = { ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }
const pill = (hex: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' })

type PromptKind = 'approve' | 'return' | 'revise'

export default function HydCircuitDetailPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('hydraulic')
  const router = useRouter()
  const params = useParams()
  const circuitId = Number(params.id)

  const [circuit, setCircuit] = useState<HydCircuit | null>(null)
  const [docCount, setDocCount] = useState(0)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [prompt, setPrompt] = useState<PromptKind | null>(null)

  useEffect(() => {
    if (!isAuthorized || !circuitId) return
    hydraulicApi.getCircuit(circuitId)
      .then((c: HydCircuit) => { setCircuit(c); setDocCount(c.document_count); setError(''); setNotice('') })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load circuit.')))
  }, [isAuthorized, circuitId])

  const act = async (fn: () => Promise<HydCircuit>, fallback: string, done: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const updated = await fn()
      setCircuit(updated)
      setDocCount(updated.document_count)
      setNotice(done)
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setConfirmDelete(false)
    setBusy(true)
    try {
      await hydraulicApi.deleteCircuit(circuitId)
      router.push('/dashboard/hydraulic/circuits')
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to delete circuit.'))
      setBusy(false)
    }
  }

  const handlePrompt = async (value: string) => {
    const kind = prompt
    setPrompt(null)
    if (kind === 'approve') {
      await act(() => hydraulicApi.approveCircuit(circuitId, value || undefined), 'Failed to approve circuit.', 'Circuit approved — it is now the revision in force.')
    } else if (kind === 'return') {
      if (!value) { setError('Review remarks are required when returning a circuit — click "Return for Changes" again and say what needs fixing.'); return }
      await act(() => hydraulicApi.returnCircuit(circuitId, value), 'Failed to return circuit.', 'Circuit returned to draft with your remarks.')
    } else if (kind === 'revise') {
      if (!value) { setError('A change note is required to raise a new revision — click "Raise New Revision" again and describe what will change.'); return }
      setBusy(true)
      setError('')
      try {
        const next: HydCircuit = await hydraulicApi.reviseCircuit(circuitId, value)
        router.push(`/dashboard/hydraulic/circuits/${next.id}`)
      } catch (err) {
        setError(extractErrorMessages(err, 'Failed to raise a new revision.'))
      } finally {
        setBusy(false)
      }
    }
  }

  if (isLoading || !isAuthorized) return null

  const isDraft = circuit?.status === 'draft'
  const noFiles = docCount === 0

  return (
    <div>
      <HydraulicNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Hydraulic &amp; Pneumatic · Circuit
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 20px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>
              {circuit ? `${circuit.circuit_number} Rev ${circuit.revision} — ${circuit.title}` : 'Circuit'}
            </h1>
            {circuit && <span style={pill(STATUS_HEX[circuit.status])}>{STATUS_LABELS[circuit.status] || circuit.status}</span>}
          </div>
        </div>
        <button onClick={() => router.push('/dashboard/hydraulic/circuits')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}
      {notice && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', color: '#15803d', fontSize: 13 }}>
          {notice}
        </div>
      )}

      {circuit && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
            {isDraft && (
              <>
                <button type="button" disabled={busy || noFiles} onClick={() => act(() => hydraulicApi.submitCircuit(circuitId), 'Failed to submit circuit for review.', 'Submitted for review — an approver has to check it now.')}
                  style={{ ...primaryBtn, opacity: busy || noFiles ? 0.55 : 1, cursor: busy || noFiles ? 'not-allowed' : 'pointer' }}
                  title={noFiles ? 'Upload the circuit diagram first' : undefined}>
                  Submit for Review
                </button>
                <button type="button" disabled={busy} style={dangerBtn} onClick={() => setConfirmDelete(true)}>Delete</button>
                {noFiles && <span style={{ fontSize: 12.5, color: TEXT.muted }}>Upload the circuit diagram below before submitting — reviewers need a drawing to check.</span>}
              </>
            )}
            {circuit.status === 'under_review' && (
              <>
                <button type="button" disabled={busy} style={primaryBtn} onClick={() => setPrompt('approve')}>Approve</button>
                <button type="button" disabled={busy} style={dangerBtn} onClick={() => setPrompt('return')}>Return for Changes</button>
              </>
            )}
            {circuit.status === 'approved' && (
              <button type="button" disabled={busy} style={primaryBtn} onClick={() => setPrompt('revise')}>Raise New Revision</button>
            )}
            {circuit.status === 'superseded' && (
              <span style={{ fontSize: 12.5, color: TEXT.muted }}>This revision has been superseded by a later approved revision — see the revision history below.</span>
            )}
          </div>

          {isDraft && circuit.review_remarks && (
            <div style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 12, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', color: '#92400E', fontSize: 13 }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>Returned for changes</strong>
              <span style={{ whiteSpace: 'pre-wrap' }}>{circuit.review_remarks}</span>
            </div>
          )}

          <div style={{ ...sectionStyle, padding: '14px 20px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px' }}>
              <InfoRow label="Created by" value={`${circuit.created_by_name || '—'}${circuit.created_at ? ` · ${formatDateTime(circuit.created_at)}` : ''}`} />
              <InfoRow label="Submitted" value={circuit.submitted_at ? `${circuit.submitted_by_name || '—'} · ${formatDateTime(circuit.submitted_at)}` : '—'} />
              <InfoRow label="Approved" value={circuit.approved_at ? `${circuit.approved_by_name || '—'} · ${formatDateTime(circuit.approved_at)}` : '—'} />
              {!isDraft && circuit.review_remarks && <InfoRow label="Approval remarks" value={circuit.review_remarks} />}
            </div>
          </div>

          {isDraft ? (
            <CircuitForm
              key={circuit.updated_at || circuit.id}
              initial={circuit}
              submitLabel="Save Changes"
              onSubmit={async (payload) => {
                setNotice('')
                const updated: HydCircuit = await hydraulicApi.updateCircuit(circuitId, payload)
                setCircuit(updated)
                setNotice('Circuit saved.')
              }}
            />
          ) : (
            <div style={sectionStyle}>
              <p style={sectionTitle}>Circuit</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 28px' }}>
                <div style={{ flex: '1 1 240px', maxWidth: 360 }}>
                  <InfoRow label="System" value={circuit.system_number ? `${circuit.system_number} — ${circuit.system_name || ''}` : 'Not linked to a system'} />
                  {circuit.system_id && (
                    <span onClick={() => router.push(`/dashboard/hydraulic/systems/${circuit.system_id}`)} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>Open system →</span>
                  )}
                </div>
                <InfoRow label="Medium" value={SYSTEM_TYPE_LABELS[circuit.system_type] || circuit.system_type} />
                <InfoRow label="Drawing Number" value={circuit.drawing_number || '—'} />
                <InfoRow label="Symbol Standard" value={circuit.symbol_standard || '—'} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 28px', marginTop: 14 }}>
                <div style={{ flex: '1 1 300px' }}><InfoRow label="Description" value={circuit.description || '—'} /></div>
                <div style={{ flex: '1 1 300px' }}><InfoRow label="Change Note" value={circuit.change_note || '—'} /></div>
              </div>
            </div>
          )}

          <div style={{ ...sectionStyle, marginTop: isDraft ? 20 : 0 }}>
            <p style={sectionTitle}>Revision History ({circuit.revisions.length})</p>
            {circuit.revisions.length === 0 ? (
              <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No revisions recorded.</p>
            ) : [...circuit.revisions].reverse().map((r) => {
              const current = r.id === circuit.id
              return (
                <div key={r.id} onClick={() => { if (!current) router.push(`/dashboard/hydraulic/circuits/${r.id}`) }}
                  style={{
                    display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '9px 10px', fontSize: 13,
                    borderTop: `1px solid ${BORDER.light}`, cursor: current ? 'default' : 'pointer', borderRadius: 8,
                    background: current ? 'rgba(255,106,42,0.08)' : 'transparent',
                  }}>
                  <span style={{ fontWeight: 700, color: TEXT.heading, minWidth: 56 }}>Rev {r.revision}</span>
                  <span style={pill(STATUS_HEX[r.status])}>{STATUS_LABELS[r.status] || r.status}</span>
                  <span style={{ color: TEXT.muted, minWidth: 130 }}>{r.approved_at ? `Approved ${formatDate(r.approved_at)}` : 'Not approved'}</span>
                  <span style={{ flex: '1 1 200px', color: TEXT.body }}>{r.change_note || '—'}</span>
                  {current && <span style={{ fontSize: 11.5, fontWeight: 600, color: '#FF6A2A' }}>Viewing</span>}
                </div>
              )
            })}
          </div>

          <HydDocumentsPanel
            entityType="circuit"
            entityId={circuit.id}
            title="Circuit Drawings"
            defaultDocType="circuit_diagram"
            readOnly={circuit.status !== 'draft'}
            readOnlyNote="Drawings on a submitted/approved revision are controlled — raise a new revision to change them."
            currentUserId={user?.id}
            isAdmin={user?.role === 'admin'}
            onChange={setDocCount}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this draft revision?"
        message={`${circuit?.circuit_number} Rev ${circuit?.revision} and its attached drawings will be removed. Earlier approved revisions are not affected.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
      <PromptDialog
        open={prompt !== null}
        title={{ approve: 'Approve circuit?', return: 'Return for changes?', revise: 'Raise a new revision?' }[prompt || 'approve']}
        message={{
          approve: `Approving makes Rev ${circuit?.revision} the revision in force; any earlier approved revision becomes superseded. Remarks are optional.`,
          return: 'The circuit goes back to draft so the author can fix it. Say what needs changing — the author is notified with your remarks.',
          revise: `A new draft revision is created from Rev ${circuit?.revision}, which stays in force until the new one is approved. Describe what will change.`,
        }[prompt || 'approve']}
        placeholder={{ approve: 'Optional remarks…', return: 'What needs fixing…', revise: 'Change note, e.g. "Added pressure relief on cylinder B side"' }[prompt || 'approve']}
        confirmLabel={{ approve: 'Approve', return: 'Return for Changes', revise: 'Raise Revision' }[prompt || 'approve']}
        danger={prompt === 'return'}
        onConfirm={handlePrompt}
        onCancel={() => setPrompt(null)}
      />
    </div>
  )
}
