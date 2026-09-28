'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi, usersApi } from '@/lib/api'
import { DirectoryUser, QualityCapaActionType } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import QualityNav from '@/components/quality/QualityNav'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function NewQualityCapaPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()

  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])

  const [actionType, setActionType] = useState<QualityCapaActionType>('corrective')
  const [ncrId, setNcrId] = useState('')
  const [title, setTitle] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [actionPlan, setActionPlan] = useState('')
  const [responsibleUserId, setResponsibleUserId] = useState('')
  const [dueDate, setDueDate] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    usersApi.directory()
      .then((data) => setDirectoryUsers(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load users.')))
  }, [isAuthorized])

  const handleSubmit = async () => {
    setError('')
    if (!title.trim()) { setError('Title is required.'); return }

    setSubmitting(true)
    try {
      const capa = await qualityApi.createCapa({
        action_type: actionType,
        ncr_id: ncrId.trim() ? Number(ncrId.trim()) : undefined,
        title: title.trim(),
        root_cause: rootCause.trim() || undefined,
        action_plan: actionPlan.trim() || undefined,
        responsible_user_id: responsibleUserId ? Number(responsibleUserId) : undefined,
        due_date: dueDate || undefined,
      })
      router.push(`/dashboard/quality/capa/${capa.id}`)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to create CAPA.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ width: '100%' }}>
      <QualityNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Quality Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New CAPA</h1>
        </div>
        <button onClick={() => router.push('/dashboard/quality/capa')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>CAPA Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Action Type *</label>
            <select style={inputStyle} value={actionType} onChange={(e) => setActionType(e.target.value as QualityCapaActionType)}>
              <option value="corrective">Corrective</option>
              <option value="preventive">Preventive</option>
            </select>
          </div>
          <div style={{ flex: '0 1 140px', minWidth: 120 }}>
            <label style={labelStyle}>NCR ID</label>
            <input type="number" style={inputStyle} value={ncrId} onChange={(e) => setNcrId(e.target.value)} placeholder="Optional" />
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 240px', minWidth: 220 }}>
            <label style={labelStyle}>Responsible User</label>
            <SearchableSelect
              value={responsibleUserId}
              onChange={setResponsibleUserId}
              options={directoryUsers.map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` }))}
              placeholder="Search user…"
            />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <label style={labelStyle}>Due Date</label>
            <DateField value={dueDate} onChange={setDueDate} />
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Root Cause</label>
          <textarea style={{ ...inputStyle, minHeight: 70 }} value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Action Plan</label>
          <textarea style={{ ...inputStyle, minHeight: 90 }} value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/dashboard/quality/capa')} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Saving…' : 'Save CAPA'}
        </button>
      </div>
    </div>
  )
}
