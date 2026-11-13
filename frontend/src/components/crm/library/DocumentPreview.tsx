'use client'

// In-app preview of a library file: PDF (frame) and images from the file's bytes, video from a
// short-lived SharePoint link (so a 200 MB mp4 streams instead of downloading into the page).
// Anything else says so and offers Download.

import { useEffect, useState } from 'react'
import { smallPrimaryBtnStyle } from '@/components/shared/ui'
import { TEXT } from '@/lib/theme'
import { fileExtension, salesLibraryApi } from '@/lib/salesLibraryApi'
import { errorText } from '@/components/crm/library/libraryUi'

// Only raster images are previewed; SVG (which can carry script) is download-only.
const IMAGE_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }
const VIDEO_EXT = ['mp4', 'webm', 'ogg', 'm4v', 'mov']

export type PreviewKind = 'pdf' | 'image' | 'video' | 'none'

export function previewKind(fileName?: string | null, mime?: string | null): PreviewKind {
  const ext = fileExtension(fileName)
  const m = (mime || '').toLowerCase()
  if (ext === 'pdf' || m === 'application/pdf') return 'pdf'
  if (IMAGE_MIME[ext]) return 'image'
  if (VIDEO_EXT.includes(ext) || m.startsWith('video/')) return 'video'
  return 'none'
}

/** Mount with a key that changes with the document / version: each one then starts clean. */
export default function DocumentPreview({ docId, versionNo, fileName, mimeType, onDownload }: {
  docId: number
  versionNo?: number
  fileName?: string | null
  mimeType?: string | null
  onDownload: () => void
}) {
  const kind = previewKind(fileName, mimeType)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(kind !== 'none')

  useEffect(() => {
    if (kind === 'none') return
    let live = true
    let objectUrl: string | null = null
    const run = async () => {
      try {
        if (kind === 'video') {
          const { url } = await salesLibraryApi.downloadUrl(docId, versionNo)
          if (live) setSrc(url)
        } else {
          const raw = await salesLibraryApi.content(docId, versionNo)
          if (!live) return
          // Never trust the type the server (or the uploader) gave: re-type from the file kind, so a file
          // can never be opened as text/html or SVG in this page's origin.
          const type = kind === 'pdf' ? 'application/pdf' : IMAGE_MIME[fileExtension(fileName)]
          objectUrl = URL.createObjectURL(new Blob([raw], { type }))
          setSrc(objectUrl)
        }
      } catch (err) {
        if (live) setError(await errorText(err, 'The preview could not be loaded. Use Download to open the file instead, or reload the page and try again.'))
      } finally {
        if (live) setLoading(false)
      }
    }
    run()
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, versionNo, kind])

  const box: React.CSSProperties = { borderRadius: 12, border: '1px solid rgba(15,23,42,0.10)', background: '#f8fafc', overflow: 'hidden', height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }
  const message = (text: string) => (
    <div style={{ padding: 16, color: TEXT.muted, fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <span>{text}</span>
      <button type="button" onClick={onDownload} style={smallPrimaryBtnStyle}>Download</button>
    </div>
  )

  if (kind === 'none') return <div style={box}>{message('Preview not available for this file type — download it to open.')}</div>
  if (loading) return <div style={box}><span role="status" style={{ color: TEXT.muted, fontSize: 13 }}>Loading preview…</span></div>
  if (error || !src) return <div style={box}>{message(error || 'Preview not available — download the file to open it.')}</div>
  // <object type="application/pdf"> on a blob re-typed as application/pdf: the browser's own PDF viewer renders it,
  // which Chrome refuses inside a sandboxed <iframe>. The blob can only ever be a PDF (see the re-typing above), so
  // nothing in it runs as a page of this site; browsers without a PDF viewer (phones) show the Download fallback.
  if (kind === 'pdf') {
    return (
      <div style={box}>
        <object data={src} type="application/pdf" aria-label={`Preview of ${fileName || 'document'}`} style={{ width: '100%', height: '100%' }}>
          {message('This browser cannot show PDFs inside the page — download the file to open it.')}
        </object>
      </div>
    )
  }
  if (kind === 'image') {
    return (
      <div style={box}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={fileName || 'Preview'} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </div>
    )
  }
  return (
    <div style={{ ...box, background: '#0f172a' }}>
      <video key={src} src={src} controls preload="metadata" playsInline style={{ width: '100%', height: '100%' }}
        onError={() => setError('This video format cannot be played in the browser. Use Download to open it in a video player.')} />
    </div>
  )
}
