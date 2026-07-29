'use client'

import { useEffect, useMemo, useState } from 'react'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Staged file list shown to the user before anything is actually uploaded —
 * lets them see exactly what they're about to send (with an image thumbnail
 * where possible) and back out of individual files before confirming. */
export default function FileUploadPreview({
  files,
  onRemove,
  onConfirm,
  onCancel,
  uploading,
}: {
  files: File[]
  onRemove: (index: number) => void
  onConfirm: () => void
  onCancel: () => void
  uploading: boolean
}) {
  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)),
    [files]
  )

  useEffect(() => {
    return () => previews.forEach((url) => url && URL.revokeObjectURL(url))
  }, [previews])

  if (files.length === 0) return null

  return (
    <div style={{ marginTop: 12, padding: 14, borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)', background: '#fff' }}>
      <p style={{ fontSize: 11.5, fontWeight: 700, color: '#78716c', textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 0 10px' }}>
        Review before uploading ({files.length} file{files.length > 1 ? 's' : ''})
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {files.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: '#f8fafc' }}>
            {previews[i] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previews[i]!} alt={f.name} style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flex: 'none' }} />
            ) : (
              <div style={{ width: 40, height: 40, borderRadius: 6, background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#78716c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: '#1f1108', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</p>
              <p style={{ fontSize: 11, color: '#a8a29e', margin: 0 }}>{formatSize(f.size)}</p>
            </div>
            <button
              onClick={() => onRemove(i)}
              disabled={uploading}
              style={{ border: 'none', background: 'none', cursor: uploading ? 'default' : 'pointer', color: '#a8a29e', display: 'flex', flex: 'none', padding: 4 }}
              aria-label={`Remove ${f.name}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onConfirm}
          disabled={uploading}
          style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(140deg,#fa9b9b,#ffe3d0)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.7 : 1 }}
        >
          {uploading ? 'Uploading…' : `Upload ${files.length} file${files.length > 1 ? 's' : ''}`}
        </button>
        <button
          onClick={onCancel}
          disabled={uploading}
          style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#57534e', fontSize: 12.5, fontWeight: 700, cursor: uploading ? 'default' : 'pointer' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
