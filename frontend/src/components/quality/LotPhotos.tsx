'use client'

import { useEffect, useState } from 'react'
import { qualityApi } from '@/lib/api'
import { QualityInspectionLot } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import { useCan } from '@/lib/permissions'
import { ActionSheet } from '@/components/quality/QualityBits'
import { sheetInput, sheetLabel, sheetHint, Req, Optional } from '@/components/shared/FormSheet'
import Select from '@/components/shared/Select'

/** Inspection photos of a lot (SharePoint, served through the app). Added /
 *  removed only while the lot is open — after the usage decision they are
 *  part of the record. */
export default function LotPhotos({ lot, onChange }: { lot: QualityInspectionLot; onChange: (l: QualityInspectionLot) => void }) {
  const photos = lot.photos || []
  // Adding / removing photos needs quality:inspection_lots:edit (backend _CAN_EDIT).
  const { canFeature } = useCan()
  // Inspection Lots › Photos feature: add (create) / remove (delete).
  const live = ['created', 'in_inspection', 'results_recorded'].includes(lot.status)
  const open = live && canFeature('quality', 'inspection_lots', 'photos', 'create')
  const canRemove = live && canFeature('quality', 'inspection_lots', 'photos', 'delete')
  const [adding, setAdding] = useState(false)
  const [urls, setUrls] = useState<Record<number, string>>({})
  const [files, setFiles] = useState<File[]>([])
  const [resultId, setResultId] = useState('')
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removeId, setRemoveId] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    const made: string[] = []
    photos.forEach((p) => {
      if (urls[p.id]) return
      qualityApi.lotPhotoBlob(lot.id, p.id).then((b) => {
        const u = URL.createObjectURL(b)
        made.push(u)
        if (alive) setUrls((m) => ({ ...m, [p.id]: u }))
      }).catch(() => { /* thumbnail missing — the name still shows */ })
    })
    return () => { alive = false }
  }, [lot.id, photos.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async () => {
    if (!files.length) { setError('Choose one or more photos first.'); return }
    setBusy(true)
    setError('')
    try {
      onChange(await qualityApi.uploadLotPhotos(lot.id, files, resultId ? Number(resultId) : null, caption.trim()))
      setFiles([])
      setCaption('')
      setAdding(false)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to upload the photos.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const id = removeId
    setRemoveId(null)
    if (!id) return
    try {
      onChange(await qualityApi.deleteLotPhoto(lot.id, id))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to remove the photo.').join(' '))
    }
  }

  const charName = (id?: number | null) => lot.results.find((r) => r.id === id)?.characteristic_name

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ConfirmDialog open={removeId !== null} title="Remove this photo?" message="The photo is removed from the lot." confirmLabel="Remove" danger
        onCancel={() => setRemoveId(null)} onConfirm={remove} />
      {error && !adding && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>
      )}
      {photos.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>{open ? 'No photos yet — add photos of defects, markings or the set-up.' : 'No photos were taken for this lot.'}</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {photos.map((p) => (
            <div key={p.id} style={{ width: 170, borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,0.7)', overflow: 'hidden' }}>
              <a href={urls[p.id]} target="_blank" rel="noreferrer" style={{ display: 'block', height: 120, background: '#f5f5f4' }}>
                {urls[p.id] && <img src={urls[p.id]} alt={p.caption || p.file_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </a>
              <div style={{ padding: '6px 8px', fontSize: 11.5, color: TEXT.body }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.caption || p.file_name}</div>
                {p.result_id && <div style={{ color: TEXT.muted }}>{charName(p.result_id)}</div>}
                <div style={{ color: TEXT.muted }}>{p.uploaded_by_name || ''}</div>
                {canRemove && <span onClick={() => setRemoveId(p.id)} style={{ color: '#DC2626', cursor: 'pointer', fontWeight: 600 }}>Remove</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && (
        <div><button type="button" style={secondaryBtnStyle} onClick={() => { setFiles([]); setResultId(''); setCaption(''); setError(''); setAdding(true) }}>+ Add photos</button></div>
      )}
      {adding && (
        <ActionSheet icon="upload" title="Add inspection photos" subtitle={`${lot.lot_number} · ${lot.item_name}`}
          onClose={() => { if (!busy) { setAdding(false); setError('') } }} onSubmit={upload} busy={busy} error={error}
          submitLabel="Add photos" busyLabel="Uploading…">
          <label style={sheetLabel}>Photos <Req /></label>
          <input type="file" multiple accept="image/*" style={sheetInput} onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          <p style={sheetHint}>{files.length ? `${files.length} photo(s) selected.` : 'Images only — defects, markings or the set-up.'}</p>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Characteristic <Optional /></label>
          <Select style={sheetInput} value={resultId} onChange={(e) => setResultId(e.target.value)}>
            <option value="">Whole lot</option>
            {lot.results.map((r) => <option key={r.id} value={r.id}>{r.characteristic_name}</option>)}
          </Select>
          <label style={{ ...sheetLabel, marginTop: 14 }}>Caption <Optional /></label>
          <input style={sheetInput} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Crack at weld toe" />
        </ActionSheet>
      )}
    </div>
  )
}
