'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceLookups } from '@/types'
import { FormPage, SheetSection, SheetIcon, SHEET, Optional, Req, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import SearchableSelect from '@/components/erp/SearchableSelect'
import MaintenanceAssetPicker from '@/components/maintenance/MaintenanceAssetPicker'
import DateField from '@/components/erp/DateField'
import { extractErrorMessages } from '@/lib/validation'
import { normalizePriority } from '@/lib/priority'
import { PRIORITY_LABELS, WO_TYPE_LABELS, localInputToIso, nowLocalInput } from '@/components/maintenance/labels'
import Select from '@/components/shared/Select'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'


export default function NewMaintenanceWorkOrderPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [lookups, setLookups] = useState<MaintenanceLookups | null>(null)
  // Role assign-to rule (core/features/maintenance.py) — the server enforces it on save too.
  const allowTech = useAssigneeFilter('maintenance:work_orders.assign')
  // ?asset=<signed ref> pre-selects the asset (from its detail page / QR scan).
  const { id: presetAsset, error: linkError, loading: presetLoading } = useRecordId(searchParams.get('asset'))
  const [assetId, setAssetId] = useState<number | null>(presetAsset)
  useEffect(() => { if (presetAsset) setAssetId(presetAsset) }, [presetAsset])
  const [woType, setWoType] = useState('corrective')
  const [priority, setPriority] = useState('standard')
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
  const draft = useFormDraft(presetLoading ? null : 'maintenance-work-order-new',
    { assetId, woType, priority, title, description, machineDown, downtimeStart, assignedTo, plannedStart, plannedEnd, estimatedHours, tasks },
    (d) => {
      if (d.assetId) setAssetId(d.assetId)
      if (d.woType) setWoType(d.woType)
      if (d.priority) setPriority(normalizePriority(d.priority))
      setTitle(d.title || ''); setDescription(d.description || ''); setMachineDown(!!d.machineDown)
      if (d.downtimeStart) setDowntimeStart(d.downtimeStart)
      setAssignedTo(d.assignedTo || ''); setPlannedStart(d.plannedStart || ''); setPlannedEnd(d.plannedEnd || '')
      setEstimatedHours(d.estimatedHours || ''); setTasks(Array.isArray(d.tasks) ? d.tasks : [])
    })

  useEffect(() => {
    if (!isAuthorized) return
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
        asset_id: assetId,
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
      draft.clear()
      router.push(recordPath('/dashboard/maintenance/work-orders', wo))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create work order.'))
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><MaintenanceNav /><InvalidRecordLink message={linkError} listHref="/dashboard/maintenance/work-orders" listLabel="Back to work orders" /></div>)
  if (presetLoading) return <div><MaintenanceNav /></div>

  return (
    <form onSubmit={handleSubmit}>
      <FormPage tour="maint-wof-page" icon="tool" title="New Work Order"
        subtitle="For a breakdown someone reported, open their request and use “Create Work Order” instead, so the downtime and sign-off link up."
        nav={<MaintenanceNav />} onBack={() => router.push('/dashboard/maintenance/work-orders')} backTour="maint-wof-back"
        footer={<>
          <button type="button" onClick={() => router.push('/dashboard/maintenance/work-orders')} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
          <button data-tour="maint-wof-submit" type="submit" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name="plus" size={16} />{saving ? 'Creating…' : 'Create Work Order'}
          </button>
        </>}>
      <div style={{ padding: '20px 24px' }}>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(error) ? error.join(' ') : error}
          </div>
        )}

        <DraftBanner draft={draft} />

        <SheetSection icon="tool" title="Job">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div data-tour="maint-wof-asset" style={{ flex: '1 1 280px', maxWidth: 420 }}>
              <label style={sheetLabel}>Asset <Req /></label>
              <MaintenanceAssetPicker value={assetId} onChange={(v) => setAssetId(v)} placeholder="Search by code or name…" rejectDecommissioned />
            </div>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}>
              <label style={sheetLabel}>Type</label>
              <Select data-tour="maint-wof-type" style={sheetInput} value={woType} onChange={(e) => setWoType(e.target.value)}>
                {Object.entries(WO_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
            <div style={{ flex: '0 1 140px', minWidth: 120 }}>
              <label style={sheetLabel}>Priority</label>
              <Select data-tour="maint-wof-priority" style={sheetInput} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
          </div>
          <div style={{ marginTop: 14, maxWidth: 700 }}>
            <label style={sheetLabel}>Title <Req /></label>
            <input data-tour="maint-wof-title" style={sheetInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Replace worn spindle bearings" maxLength={200} />
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={sheetLabel}>Instructions</label>
            <textarea data-tour="maint-wof-instructions" style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label data-tour="maint-wof-machine-down" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
            <input type="checkbox" checked={machineDown} onChange={(e) => setMachineDown(e.target.checked)} />
            Machine is down for this job (tracks downtime and blocks it in Production)
          </label>
          {machineDown && (
            <div style={{ marginTop: 10, maxWidth: 240 }}>
              <label style={sheetLabel}>Down Since</label>
              <input style={sheetInput} type="datetime-local" value={downtimeStart} max={nowLocalInput()} onChange={(e) => setDowntimeStart(e.target.value)} />
            </div>
          )}
        </SheetSection>

        <SheetSection icon="calendar" title="Planning">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div data-tour="maint-wof-technician" style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <label style={sheetLabel}>Technician</label>
              <SearchableSelect value={assignedTo} onChange={setAssignedTo} placeholder="Assign later"
                options={[{ value: '', label: '— Assign later —' }, ...(lookups?.technicians || []).filter((t) => allowTech(t.id)).map((t) => ({ value: String(t.id), label: t.name }))]} />
            </div>
            <div data-tour="maint-wof-planned-start" style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={sheetLabel}>Planned Start</label>
              <DateField value={plannedStart} onChange={setPlannedStart} />
            </div>
            <div data-tour="maint-wof-planned-end" style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={sheetLabel}>Planned End</label>
              <DateField value={plannedEnd} onChange={setPlannedEnd} />
            </div>
            <div style={{ flex: '0 1 120px', minWidth: 110 }}>
              <label style={sheetLabel}>Est. Hours</label>
              <input data-tour="maint-wof-est-hours" style={sheetInput} type="number" min={0} step="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} />
            </div>
          </div>
        </SheetSection>

        <SheetSection icon="list" title="Checklist" extra={<Optional />}>
          {tasks.length === 0 && <p style={{ ...sheetHint, margin: '0 0 10px' }}>Each line needs a result (OK / Not OK / N/A) before the job can be completed.</p>}
          {tasks.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: SHEET.MUTED, width: 22 }}>{i + 1}.</span>
              <input style={{ ...sheetInput, flex: '1 1 280px' }} value={t.description} onChange={(e) => updateTask(i, 'description', e.target.value)} placeholder="Check belt tension" />
              <input style={{ ...sheetInput, flex: '0 1 200px' }} value={t.expected_value} onChange={(e) => updateTask(i, 'expected_value', e.target.value)} placeholder="Expected (optional)" />
              <span onClick={() => setTasks((prev) => prev.filter((_, j) => j !== i))} style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>Remove</span>
            </div>
          ))}
          <button data-tour="maint-wof-add-line" type="button" onClick={() => setTasks((prev) => [...prev, { description: '', expected_value: '' }])} style={sheetBtn('ghost')}><SheetIcon name="plus" size={14} />Add Line</button>
        </SheetSection>

      </div>
      </FormPage>
    </form>
  )
}
