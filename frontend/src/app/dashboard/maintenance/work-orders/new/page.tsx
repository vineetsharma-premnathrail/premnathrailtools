'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAssetOption, MaintenanceLookups } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'
import { PRIORITY_LABELS, WO_TYPE_LABELS, localInputToIso, nowLocalInput } from '@/components/maintenance/labels'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }

export default function NewMaintenanceWorkOrderPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [assets, setAssets] = useState<MaintenanceAssetOption[]>([])
  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  const [assetId, setAssetId] = useState(searchParams.get('asset') || '')
  const [woType, setWoType] = useState('corrective')
  const [priority, setPriority] = useState('normal')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [machineDown, setMachineDown] = useState(false)
  const [downtimeStart, setDowntimeStart] = useState(nowLocalInput())
  const [assignedTo, setAssignedTo] = useState('')
  const [plannedStart, setPlannedStart] = useState('')
  const [plannedEnd, setPlannedEnd] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')
  const [tasks, setTasks] = useState<{ description: string; expected_value: string }[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    maintenanceApi.lookupAssets().then(setAssets).catch((err) => setError(extractErrorMessages(err, 'Failed to load the asset list.')))
    maintenanceApi.getLookups().then(setLookups).catch((err) => setError(extractErrorMessages(err, 'Failed to load technicians.')))
  }, [isAuthorized])

  const updateTask = (idx: number, key: 'description' | 'expected_value', value: string) =>
    setTasks((prev) => prev.map((t, i) => (i === idx ? { ...t, [key]: value } : t)))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!assetId) { setError('Pick the asset this work is on.'); return }
    if (!title.trim()) { setError('Give the work order a title.'); return }
    if (plannedStart && plannedEnd && plannedEnd < plannedStart) { setError("Planned end can't be before planned start."); return }
    const hrs = estimatedHours.trim() ? Number(estimatedHours) : null
    if (hrs != null && (Number.isNaN(hrs) || hrs < 0)) { setError('Estimated hours must be a positive number.'); return }
    const blank = tasks.findIndex((t) => !t.description.trim())
    if (blank >= 0) { setError(`Checklist line ${blank + 1} is empty — fill it in or remove it.`); return }
    const downIso = machineDown ? localInputToIso(downtimeStart) : null
    if (downIso && new Date(downIso) > new Date()) { setError("Downtime start can't be in the future."); return }
    setSaving(true)
    try {
      const wo = await maintenanceApi.createWorkOrder({
        asset_id: Number(assetId),
        wo_type: woType,
        priority,
        title: title.trim(),
        description: description.trim() || null,
        machine_down: machineDown,
        downtime_start: downIso,
        assigned_to_id: assignedTo ? Number(assignedTo) : null,
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
        estimated_hours: hrs,
        tasks: tasks.map((t, i) => ({ sequence: (i + 1) * 10, description: t.description.trim(), expected_value: t.expected_value.trim() || null })),
      })
      router.push(`/dashboard/maintenance/work-orders/${wo.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create work order.'))
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 6px' }}>New Work Order</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 20px' }}>
            For a breakdown someone reported, open their request and use &ldquo;Create Work Order&rdquo; instead, so the downtime and sign-off link up.
          </p>
        </div>
        <button onClick={() => router.push('/dashboard/maintenance/work-orders')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <form onSubmit={handleSubmit}>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(error) ? error.join(' ') : error}
          </div>
        )}

        <div style={sectionStyle}>
          <p style={sectionTitle}>Job</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
              <label style={labelStyle}>Asset *</label>
              <SearchableSelect value={assetId} onChange={setAssetId} placeholder="Search by code or name…"
                options={assets.map((a) => ({ value: String(a.id), label: `${a.asset_code} — ${a.name}` }))} />
            </div>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={woType} onChange={(e) => setWoType(e.target.value)}>
                {Object.entries(WO_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 1 140px', minWidth: 120 }}>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 14, maxWidth: 700 }}>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Replace worn spindle bearings" maxLength={200} />
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Instructions</label>
            <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13, color: TEXT.body, cursor: 'pointer' }}>
            <input type="checkbox" checked={machineDown} onChange={(e) => setMachineDown(e.target.checked)} />
            Machine is down for this job (tracks downtime and blocks it in Production)
          </label>
          {machineDown && (
            <div style={{ marginTop: 10, maxWidth: 240 }}>
              <label style={labelStyle}>Down Since</label>
              <input style={inputStyle} type="datetime-local" value={downtimeStart} max={nowLocalInput()} onChange={(e) => setDowntimeStart(e.target.value)} />
            </div>
          )}
        </div>

        <div style={sectionStyle}>
          <p style={sectionTitle}>Planning</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <label style={labelStyle}>Technician</label>
              <SearchableSelect value={assignedTo} onChange={setAssignedTo} placeholder="Assign later"
                options={[{ value: '', label: '— Assign later —' }, ...(lookups?.technicians || []).map((t) => ({ value: String(t.id), label: t.name }))]} />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Planned Start</label>
              <DateField value={plannedStart} onChange={setPlannedStart} />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Planned End</label>
              <DateField value={plannedEnd} onChange={setPlannedEnd} />
            </div>
            <div style={{ flex: '0 1 120px', minWidth: 110 }}>
              <label style={labelStyle}>Est. Hours</label>
              <input style={inputStyle} type="number" min={0} step="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} />
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <p style={sectionTitle}>Checklist</p>
          {tasks.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 10px' }}>Optional. Each line needs a result (OK / Not OK / N/A) before the job can be completed.</p>}
          {tasks.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: TEXT.muted, width: 22 }}>{i + 1}.</span>
              <input style={{ ...inputStyle, flex: '1 1 280px' }} value={t.description} onChange={(e) => updateTask(i, 'description', e.target.value)} placeholder="Check belt tension" />
              <input style={{ ...inputStyle, flex: '0 1 200px' }} value={t.expected_value} onChange={(e) => updateTask(i, 'expected_value', e.target.value)} placeholder="Expected (optional)" />
              <span onClick={() => setTasks((prev) => prev.filter((_, j) => j !== i))} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>Remove</span>
            </div>
          ))}
          <button type="button" onClick={() => setTasks((prev) => [...prev, { description: '', expected_value: '' }])} style={secondaryBtnStyle}>+ Add Line</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}>
            {saving ? 'Creating…' : 'Create Work Order'}
          </button>
        </div>
      </form>
    </div>
  )
}
