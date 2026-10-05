'use client'

import { useEffect, useRef, useState } from 'react'
import { storeApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import ConfirmDialog from '@/components/erp/ConfirmDialog'

const MAX_BYTES = 5 * 1024 * 1024

const box: React.CSSProperties = {
  width: 180, height: 180, borderRadius: 14, border: '1.5px dashed rgba(0,0,0,0.18)', background: 'rgba(0,0,0,0.02)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flex: 'none',
}
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, fontSize: 12.5, fontWeight: 600, color: '#ea580c', cursor: 'pointer' }

/** Returns a problem message for a picked file, or '' if it's fine. */
export function checkPhoto(file: File): string {
  if (!file.type.startsWith('image/')) return `'${file.name}' isn't an image — pick a JPG, PNG or WEBP photo.`
  if (file.size > MAX_BYTES) return `The photo is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep it under 5 MB.`
  return ''
}

/** Item photo box. With `itemId` it loads/uploads/removes the saved photo
 *  straight away; without it (Add Item) it just holds the picked file in
 *  `pending` so the page can upload it after the item is created. */
export default function ItemPhoto({
  itemId,
  hasPhoto = false,
  editable = true,
  pending,
  onPendingChange,
  onChanged,
}: {
  itemId?: number
  hasPhoto?: boolean
  editable?: boolean
  pending?: File | null
  onPendingChange?: (f: File | null) => void
  onChanged?: (hasPhoto: boolean) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [version, setVersion] = useState(0)

  // Saved photo (fetched with auth, shown via an object URL).
  useEffect(() => {
    if (!itemId || !hasPhoto) { if (!pending) setUrl(''); return }
    let revoked = false
    let objectUrl = ''
    storeApi.getItemPhoto(itemId)
      .then((blob) => { if (!revoked) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) } })
      .catch((err) => { if (!revoked) setError(extractErrorMessages(err, 'Could not load the photo.').join(' ')) })
    return () => { revoked = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, hasPhoto, version])

  // Picked-but-not-saved photo on Add Item.
  useEffect(() => {
    if (itemId || !pending) { if (!itemId) setUrl(''); return }
    const objectUrl = URL.createObjectURL(pending)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [itemId, pending])

  const pick = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    const problem = checkPhoto(file)
    if (problem) { setError(problem); return }
    setError('')
    if (!itemId) { onPendingChange?.(file); return }
    setBusy(true)
    try {
      await storeApi.uploadItemPhoto(itemId, file)
      setVersion((v) => v + 1)
      onChanged?.(true)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not upload the photo.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setConfirmRemove(false)
    if (!itemId) { onPendingChange?.(null); return }
    setBusy(true)
    try {
      await storeApi.deleteItemPhoto(itemId)
      setUrl('')
      onChanged?.(false)
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not remove the photo.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const showing = !!url
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{ ...box, cursor: editable && !busy ? 'pointer' : 'default', borderStyle: showing ? 'solid' : 'dashed' }}
        onClick={() => editable && !busy && fileRef.current?.click()}
        title={editable ? (showing ? 'Click to change the photo' : 'Click to add a photo') : ''}
      >
        {busy ? (
          <span style={{ fontSize: 12.5, color: TEXT.muted }}>Uploading…</span>
        ) : showing ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Item photo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 12.5, color: TEXT.muted, textAlign: 'center', padding: 12 }}>
            {editable ? <>+ Add photo<br /><span style={{ fontSize: 11 }}>JPG / PNG, up to 5 MB</span></> : 'No photo'}
          </span>
        )}
      </div>
      {editable && showing && !busy && (
        <div style={{ display: 'flex', gap: 14 }}>
          <button type="button" style={linkBtn} onClick={() => fileRef.current?.click()}>Change</button>
          <button type="button" style={{ ...linkBtn, color: '#b91c1c' }} onClick={() => (itemId ? setConfirmRemove(true) : remove())}>Remove</button>
        </div>
      )}
      {error && <p style={{ fontSize: 12, color: '#dc2626', margin: 0, maxWidth: 220 }}>{error}</p>}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
      <ConfirmDialog open={confirmRemove} title="Remove this photo?" message="The item's photo will be deleted." onCancel={() => setConfirmRemove(false)} onConfirm={remove} />
    </div>
  )
}
