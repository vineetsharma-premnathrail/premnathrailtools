'use client'

// One attachment in a list: its name plus "View" (opens the in-portal viewer,
// AttachmentPreview) and "Download" (saves it with its real name). Used across
// Procurement (requisition, R.F.Q and vendor quotation files, PO documents).
// getPreviewUrl is the Microsoft-viewer link for Office files; without it the
// viewer still shows photos, PDFs, videos and text, and offers Download for the rest.

import { useState } from 'react'
import { DownloadSimple, Eye } from '@phosphor-icons/react'
import AttachmentPreviewDialog, { type PreviewFile } from '@/components/shared/AttachmentPreview'
import { openAttachmentBlob } from '@/hooks/useAttachmentBlobUrl'
import { extractErrorMessages } from '@/lib/validation'
import { btnBase } from '@/components/shared/ui'

// Shared button base, kept at this list's compact 24px size and colours.
const btn: React.CSSProperties = {
  ...btnBase,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 24, padding: '0 8px',
  borderRadius: 6, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', color: '#44403c',
  fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 24, lineHeight: 1,
}

const noPreviewLink = () => Promise.reject(new Error('no viewer link for this file'))

export default function FileViewDownload({ file, getBlob, getPreviewUrl, compact = false, label, hideName = false }: {
  file: PreviewFile
  getBlob: () => Promise<Blob>
  getPreviewUrl?: () => Promise<{ getUrl: string }>
  /** Icon-only buttons (table cells). */
  compact?: boolean
  /** Text shown instead of the file name. */
  label?: string
  /** Only the View / Download buttons (the row already shows the name). */
  hideName?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const download = async () => {
    setBusy(true)
    setError('')
    try {
      await openAttachmentBlob(getBlob, file.filename)
    } catch (err) {
      // The file comes back as a blob, so a refusal's JSON body (e.g. 403 "This R.F.Q belongs to ...") is read as text first.
      const data = (err as { response?: { data?: unknown } })?.response?.data
      if (data instanceof Blob) {
        try {
          const j = JSON.parse(await data.text())
          if (typeof j?.detail === 'string') { setError(j.detail); return }
        } catch { /* not JSON */ }
      }
      setError(extractErrorMessages(err,`Could not download ${file.filename} — check your connection and try again; if it keeps failing the file may have been removed, refresh the page.`).join(' '))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, maxWidth: '100%' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
        {!hideName && (
          <span title={file.filename} style={{ fontSize: 12.5, color: '#1c1917', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            📎 {label ?? file.filename}
          </span>
        )}
        <button type="button" onClick={() => setOpen(true)} style={btn} aria-label={`View ${file.filename}`} title="View">
          <Eye size={13} />{!compact && 'View'}
        </button>
        <button type="button" onClick={download} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }} aria-label={`Download ${file.filename}`} title="Download">
          <DownloadSimple size={13} />{!compact && (busy ? 'Downloading…' : 'Download')}
        </button>
      </span>
      {error && <span role="alert" style={{ fontSize: 11.5, color: '#b91c1c' }}>{error}</span>}
      <AttachmentPreviewDialog
        files={[file]}
        startIndex={open ? 0 : null}
        onClose={() => setOpen(false)}
        getBlob={getBlob}
        getPreviewUrl={getPreviewUrl ?? noPreviewLink}
      />
    </span>
  )
}
