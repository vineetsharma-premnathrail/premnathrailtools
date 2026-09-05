'use client'

import { useRef } from 'react'
import { TEXT, BORDER } from '@/lib/theme'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Drop-in replacement for a raw <input type="file"> — shows the picked (or
 * already-uploaded) file's name/size with Replace and Remove actions instead
 * of the native "Choose File / No file chosen" control. `file` is a locally
 * picked File awaiting upload; `existingName`/`existingSize` describe a file
 * already saved server-side (mutually exclusive in practice — once a file is
 * uploaded elsewhere, the caller usually stops rendering the local `file`). */
export default function FileUploadField({
  file,
  existingName,
  existingSize,
  onChange,
  onRemove,
  uploading,
  disabled,
  accept,
}: {
  file?: File | null
  existingName?: string | null
  existingSize?: number | null
  onChange: (file: File | null) => void
  onRemove?: () => void
  uploading?: boolean
  disabled?: boolean
  accept?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const name = file?.name || existingName || null
  const size = file ? file.size : existingSize

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
      {!name ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px dashed ${BORDER.normal}`,
            background: 'rgba(255,255,255,.5)', fontSize: 13, color: TEXT.secondary, cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Choose file to upload…
        </button>
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10,
          border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
          </svg>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: TEXT.heading, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
            <p style={{ fontSize: 11, color: TEXT.muted, margin: 0 }}>
              {uploading ? 'Uploading…' : size != null ? formatSize(size) : existingName ? 'Uploaded' : ''}
            </p>
          </div>
          {!uploading && (
            <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                title="Replace"
                style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 8, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, cursor: disabled ? 'not-allowed' : 'pointer' }}
              >
                Replace
              </button>
              {onRemove && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onRemove}
                  title="Remove"
                  style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.06)', color: '#b91c1c', cursor: disabled ? 'not-allowed' : 'pointer' }}
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
