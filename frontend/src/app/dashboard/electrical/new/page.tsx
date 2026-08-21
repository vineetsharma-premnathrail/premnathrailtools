'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { electricalApi, p2pApi } from '@/lib/api'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function NewElectricalWorkOrderPage() {
  const { isAuthorized, isLoading } = useRequireApp('electrical')
  const router = useRouter()

  const [projects, setProjects] = useState<{ id: number; label: string }[]>([])
  const [projectId, setProjectId] = useState('')
  const [equipmentTag, setEquipmentTag] = useState('')
  const [voltageSystem, setVoltageSystem] = useState('')
  const [faultType, setFaultType] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [expectedCompletionDate, setExpectedCompletionDate] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    p2pApi.listProjects().then(setProjects).catch(() => {})
  }, [isAuthorized])

  const handleSubmit = async () => {
    setError('')
    if (!projectId) { setError('Select a project.'); return }
    setSubmitting(true)
    try {
      const wo = await electricalApi.create({
        project_id: Number(projectId),
        equipment_tag: equipmentTag || undefined,
        voltage_system: voltageSystem || undefined,
        fault_type: faultType || undefined,
        description: description || undefined,
        priority,
        expected_completion_date: expectedCompletionDate || undefined,
      })
      router.push(`/dashboard/electrical/${wo.id}`)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Failed to create work order.')
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ width: '100%', maxWidth: 780 }}>
      <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
        Electrical Module
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Work Order</h1>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Work Order Details</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          <div>
            <label style={labelStyle}>Project *</label>
            <SearchableSelect
              value={projectId}
              onChange={setProjectId}
              options={projects.map((p) => ({ value: String(p.id), label: p.label }))}
              placeholder="Search project…"
            />
          </div>
          <div>
            <label style={labelStyle}>Equipment / Panel Tag</label>
            <input style={inputStyle} value={equipmentTag} onChange={(e) => setEquipmentTag(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Voltage System</label>
            <input style={inputStyle} value={voltageSystem} onChange={(e) => setVoltageSystem(e.target.value)} placeholder="e.g. 415V 3-phase" />
          </div>
          <div>
            <label style={labelStyle}>Fault Type</label>
            <input style={inputStyle} value={faultType} onChange={(e) => setFaultType(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Priority</label>
            <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Expected Completion Date</label>
            <DateField value={expectedCompletionDate} onChange={setExpectedCompletionDate} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.back()} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Creating…' : 'Create Work Order'}
        </button>
      </div>
    </div>
  )
}
