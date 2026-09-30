'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireAnyApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAssetOption } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { PRIORITY_LABELS, REQUEST_TYPE_LABELS, localInputToIso, nowLocalInput } from '@/components/maintenance/labels'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function NewMaintenanceRequestPage() {
  const { isAuthorized, isLoading } = useRequireAnyApp('maintenance', 'production')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [assets, setAssets] = useState<MaintenanceAssetOption[]>([])
  const [assetId, setAssetId] = useState(searchParams.get('asset') || '')
  const [requestType, setRequestType] = useState('breakdown')
  const [machineDown, setMachineDown] = useState(true)
  const [reportedAt, setReportedAt] = useState(nowLocalInput())
  const [problem, setProblem] = useState('')
  const [priority, setPriority] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    maintenanceApi.lookupAssets()
      .then((data) => setAssets(Array.isArray(data) ? data : []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the asset list.')))
  }, [isAuthorized])

  const selected = useMemo(() => assets.find((a) => String(a.id) === assetId), [assets, assetId])

  const handleTypeChange = (t: string) => {
    setRequestType(t)
    // A breakdown means it stopped; the other types usually mean it's still running.
    setMachineDown(t === 'breakdown')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!assetId) { setError('Pick the machine or equipment that has the problem.'); return }
    if (!problem.trim()) { setError('Describe the problem — what happened, and any noise, leak, alarm or error code.'); return }
    const reportedIso = localInputToIso(reportedAt)
    if (reportedIso && new Date(reportedIso) > new Date()) { setError("Reported time can't be in the future."); return }
    setSaving(true)
    try {
      const req = await maintenanceApi.createRequest({
        asset_id: Number(assetId),
        request_type: requestType,
        machine_down: machineDown,
        reported_at: reportedIso,
        problem_description: problem.trim(),
        priority: priority || null,
      })
      if (photos.length) {
        try { await maintenanceApi.uploadAttachments('request', req.id, photos, 'photo') } catch { /* upload failure shouldn't block the request */ }
      }
      router.push(`/dashboard/maintenance/requests/${req.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise the request.'))
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
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>Report a Problem</h1>
        </div>
        <button onClick={() => router.push('/dashboard/maintenance/requests')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      <form onSubmit={handleSubmit} style={{ maxWidth: 820 }}>
        {error && (
          <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(error) ? error.join(' ') : error}
          </div>
        )}

        <div style={sectionStyle}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Machine / Equipment *</label>
            <SearchableSelect value={assetId} onChange={setAssetId} placeholder="Search by code, name or location…"
              options={assets.map((a) => ({ value: String(a.id), label: `${a.asset_code} — ${a.name}${a.location_text ? ` (${a.location_text})` : ''}` }))} />
            {selected && selected.status !== 'operational' && selected.status !== 'standby' && (
              <p style={{ fontSize: 12, color: '#b45309', margin: '6px 0 0' }}>
                This asset is already marked {selected.status.replace('_', ' ')} — check its open requests before raising another one.
              </p>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '0 1 240px', minWidth: 200 }}>
              <label style={labelStyle}>Type</label>
              <select style={inputStyle} value={requestType} onChange={(e) => handleTypeChange(e.target.value)}>
                {Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 1 220px', minWidth: 200 }}>
              <label style={labelStyle}>When did it happen?</label>
              <input style={inputStyle} type="datetime-local" value={reportedAt} max={nowLocalInput()} onChange={(e) => setReportedAt(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="">Auto (from criticality)</option>
                {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          <label style={{
            display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
            border: `1px solid ${machineDown ? 'rgba(220,38,38,0.35)' : BORDER.normal}`, background: machineDown ? 'rgba(220,38,38,0.06)' : 'transparent',
          }}>
            <input type="checkbox" checked={machineDown} onChange={(e) => setMachineDown(e.target.checked)} style={{ width: 18, height: 18 }} />
            <span>
              <span style={{ fontSize: 14, fontWeight: 700, color: machineDown ? '#b91c1c' : TEXT.heading, display: 'block' }}>Machine is stopped</span>
              <span style={{ fontSize: 12, color: TEXT.muted }}>Starts the downtime clock from the time above and blocks the machine in Production until it&apos;s repaired.</span>
            </span>
          </label>

          <div style={{ marginTop: 16 }}>
            <label style={labelStyle}>What&apos;s wrong? *</label>
            <textarea style={{ ...inputStyle, minHeight: 110, resize: 'vertical' }} value={problem} onChange={(e) => setProblem(e.target.value)}
              placeholder="What happened, what you saw or heard, any alarm or error code on the panel…" />
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Photos</label>
            <input type="file" multiple accept="image/*" capture="environment" onChange={(e) => setPhotos(Array.from(e.target.files || []))} style={inputStyle} />
            {photos.length > 0 && <p style={{ fontSize: 12, color: TEXT.muted, margin: '6px 0 0' }}>{photos.length} photo{photos.length > 1 ? 's' : ''} will be attached.</p>}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}>
            {saving ? 'Sending…' : 'Raise Request'}
          </button>
        </div>
      </form>
    </div>
  )
}
