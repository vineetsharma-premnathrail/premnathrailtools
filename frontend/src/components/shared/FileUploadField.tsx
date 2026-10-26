'use client'

import { useRef } from 'react'
import { TEXT, BORDER } from '@/lib/theme'
import { UploadSimple, File as FileIcon } from '@phosphor-icons/react'
import { smallDangerBtnStyle } from '@/components/shared/ui'

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
        // ui-audit-ignore-next-line custom-button — full-width dashed file-picker drop zone styled as an input, not an action pill
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
          <UploadSimple size={15} />
          Choose file to upload…
        </button>
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10,
          border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.7)',
        }}>
          <FileIcon size={16} color="#2563eb" style={{ flex: 'none' }} />
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
                  style={{ ...smallDangerBtnStyle, cursor: disabled ? 'not-allowed' : 'pointer' }}
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
