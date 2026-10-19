'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireAnyApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAssetOption } from '@/types'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, Optional, Req, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { recordPath, useRecordId } from '@/lib/recordRef'
import MaintenanceAssetPicker from '@/components/maintenance/MaintenanceAssetPicker'
import { extractErrorMessages } from '@/lib/validation'
import { PRIORITY_LABELS, REQUEST_TYPE_LABELS, localInputToIso, nowLocalInput } from '@/components/maintenance/labels'

export default function NewMaintenanceRequestPage() {
  const { isAuthorized, isLoading } = useRequireAnyApp('maintenance', 'production')
  const router = useRouter()
  const searchParams = useSearchParams()

  // ?asset=<signed ref> pre-selects the asset (from its detail page / QR scan).
  const { id: presetAsset, error: linkError, loading: presetLoading } = useRecordId(searchParams.get('asset'))
  const [assetId, setAssetId] = useState<number | null>(presetAsset)
  useEffect(() => { if (presetAsset) setAssetId(presetAsset) }, [presetAsset])
  const [selected, setSelected] = useState<MaintenanceAssetOption | null>(null)
  const [requestType, setRequestType] = useState('breakdown')
  const [machineDown, setMachineDown] = useState(true)
  const [reportedAt, setReportedAt] = useState(nowLocalInput())
  const [problem, setProblem] = useState('')
  const [priority, setPriority] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)
  const takeRef = useRef<HTMLInputElement>(null)
  const chooseRef = useRef<HTMLInputElement>(null)

  const addPhotos = (list: FileList | null) => {
    const files = Array.from(list || [])
    if (files.length) setPhotos((prev) => [...prev, ...files])
  }
  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx))

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
        asset_id: assetId,
        request_type: requestType,
        machine_down: machineDown,
        reported_at: reportedIso,
        problem_description: problem.trim(),
        priority: priority || null,
      })
      if (photos.length) {
        try {
          await maintenanceApi.uploadAttachments('request', req.id, photos, 'photo')
        } catch (uploadErr) {
          // The request itself is saved — don't block it, but tell the requester the truth on the next page.
          // No server reply = network drop / timeout. Don't reuse the generic "Nothing was saved"
          // wording — the request IS saved; only the photos are in doubt.
          const ue = uploadErr as { response?: unknown; code?: string; message?: string } | null
          let reason: string
          if (!ue?.response) {
            reason = ue?.code === 'ECONNABORTED' || /timeout/i.test(ue?.message || '')
              ? 'the photo upload timed out (the request itself is saved) — some photos may have gone through, so check the list below first'
              : 'the connection dropped while the photos were uploading (the request itself is saved)'
          } else {
            reason = extractErrorMessages(uploadErr, 'the server rejected the photos').join(' ')
          }
          try { sessionStorage.setItem(`mt-photo-err-${req.id}`, reason) } catch { /* storage blocked — detail page shows a generic reason */ }
          router.push(`${recordPath('/dashboard/maintenance/requests', req)}?photos_failed=1`)
          return
        }
      }
      router.push(recordPath('/dashboard/maintenance/requests', req))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to raise the request.'))
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><MaintenanceNav /><InvalidRecordLink message={linkError} listHref="/dashboard/maintenance/requests" listLabel="Back to requests" /></div>)
  if (presetLoading) return <div><MaintenanceNav /></div>

  return (
    <form onSubmit={handleSubmit} className="mt-req-form">
      <style>{`
        @media (max-width: 640px) {
          .mt-req-form input, .mt-req-form select, .mt-req-form textarea { font-size: 16px !important; }
          .mt-req-form .mt-req-submit { flex: 1 1 auto; justify-content: center; }
        }
      `}</style>
      <FormPage tour="maint-reqf-page" icon="alert" iconColor="#DC2626" title="Report a Problem"
        subtitle="Tell Maintenance what is wrong — they are notified at once and the request is tracked until the machine is confirmed working."
        nav={<MaintenanceNav />} onBack={() => router.push('/dashboard/maintenance/requests')} backTour="maint-reqf-back"
        footer={<>
          <button type="button" onClick={() => router.push('/dashboard/maintenance/requests')} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
          <button data-tour="maint-reqf-submit" type="submit" disabled={saving} className="mt-req-submit" style={sheetBtn('primary', '#DC2626', saving)}>
            <SheetIcon name="send" size={16} />{saving ? 'Sending…' : 'Raise Request'}
          </button>
        </>}>
        <SheetColumns
          left={<>
            {error && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {Array.isArray(error) ? error.join(' ') : error}
              </div>
            )}
            <SheetSection icon="tool" title="Machine">
              <div data-tour="maint-reqf-asset">
                <label style={sheetLabel}>Machine / Equipment <Req /></label>
                <MaintenanceAssetPicker value={assetId} onChange={(v) => setAssetId(v)} onSelectedOption={setSelected} rejectDecommissioned />
                {selected && selected.status !== 'operational' && selected.status !== 'standby' && (
                  <p style={{ fontSize: 12, color: '#b45309', margin: '6px 0 0' }}>
                    This asset is already marked {selected.status.replace('_', ' ')} — check its open requests before raising another one.
                  </p>
                )}
              </div>
              <label data-tour="maint-reqf-machine-down" style={{
                display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                border: `1px solid ${machineDown ? 'rgba(220,38,38,0.35)' : SHEET.LINE}`, background: machineDown ? 'rgba(220,38,38,0.06)' : 'transparent',
              }}>
                <input type="checkbox" checked={machineDown} onChange={(e) => setMachineDown(e.target.checked)} style={{ width: 18, height: 18 }} />
                <span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: machineDown ? '#b91c1c' : SHEET.INK, display: 'block' }}>Machine is stopped</span>
                  <span style={{ fontSize: 12, color: SHEET.MUTED }}>Starts the downtime clock from the time below and blocks the machine in Production until it&apos;s repaired.</span>
                </span>
              </label>
            </SheetSection>
            <SheetSection icon="alert" title="Problem">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '0 1 240px', minWidth: 200 }}>
                  <label style={sheetLabel}>Type</label>
                  <select data-tour="maint-reqf-type" style={sheetInput} value={requestType} onChange={(e) => handleTypeChange(e.target.value)}>
                    {Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div style={{ flex: '0 1 220px', minWidth: 200 }}>
                  <label style={sheetLabel}>When did it happen?</label>
                  <input data-tour="maint-reqf-reported-at" style={sheetInput} type="datetime-local" value={reportedAt} max={nowLocalInput()} onChange={(e) => setReportedAt(e.target.value)} />
                </div>
                <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <label style={sheetLabel}>Priority</label>
                  <select data-tour="maint-reqf-priority" style={sheetInput} value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="">Auto (from criticality)</option>
                    {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <label style={{ ...sheetLabel, marginTop: 14 }}>What&apos;s wrong? <Req /></label>
              <textarea data-tour="maint-reqf-problem" style={{ ...sheetInput, minHeight: 110, resize: 'vertical' }} value={problem} onChange={(e) => setProblem(e.target.value)}
                placeholder="What happened, what you saw or heard, any alarm or error code on the panel…" />
            </SheetSection>
          </>}
          right={
            <SheetSection icon="clip" title="Photos" extra={<Optional />}>
              <div data-tour="maint-reqf-photos">
                <input ref={takeRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                  onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
                <input ref={chooseRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                  onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => takeRef.current?.click()} style={{ ...sheetBtn('secondary'), flex: '1 1 140px', minHeight: 44, justifyContent: 'center' }}><SheetIcon name="clip" size={15} />Take photo</button>
                  <button type="button" onClick={() => chooseRef.current?.click()} style={{ ...sheetBtn('secondary'), flex: '1 1 140px', minHeight: 44, justifyContent: 'center' }}><SheetIcon name="upload" size={15} />Choose photos</button>
                </div>
                {photos.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {photos.map((f, i) => (
                      <div key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '6px 10px', borderRadius: 8, border: `1px solid ${SHEET.LINE}`, background: '#fff', fontSize: 12.5, color: SHEET.BODY }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name || `Photo ${i + 1}`}</span>
                        <button type="button" onClick={() => removePhoto(i)} aria-label={`Remove ${f.name || `photo ${i + 1}`}`}
                          style={{ flex: 'none', background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 12.5, fontWeight: 600, padding: '4px 6px' }}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p style={sheetHint}>{photos.length ? `${photos.length} photo${photos.length > 1 ? 's' : ''} will be attached.` : 'A photo of the fault, panel alarm or leak helps the technician come prepared.'}</p>
              </div>
            </SheetSection>
          }
        />
      </FormPage>
    </form>
  )
}
