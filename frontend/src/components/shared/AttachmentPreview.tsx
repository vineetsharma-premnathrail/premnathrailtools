'use client'

// In-portal file viewer used by every Attachments list.
//  - Photos (jpg/png/webp/gif/bmp) are drawn straight from the file's bytes: instant.
//  - Everything else (video incl. iPhone .mov, PDF, Word, Excel, PowerPoint, text,
//    HEIC, ...) opens in Microsoft's SharePoint viewer inside the popup —
//    SharePoint does the converting; our server only mints a short-lived link
//    after the backend's permission + data-scope check.
//  - If a viewer cannot open the file, the popup says why and offers Download.
// AttachmentThumb shows the small SharePoint-rendered picture (photo, video frame,
// first page) in lists, falling back to a file-type badge.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretLeft, CaretRight, DownloadSimple, X } from '@phosphor-icons/react'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useFocusTrap } from '@/components/shared/useFocusTrap'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'

export type PreviewFile = { id: number; filename: string; content_type?: string | null; size?: number | null }

const NATIVE_IMAGE = ['jpg', 'jpeg', 'jfif', 'png', 'gif', 'webp', 'bmp']
const NATIVE_VIDEO = ['mp4', 'webm', 'ogg', 'm4v']
const HTML_EXT = ['html', 'htm', 'xhtml', 'shtml', 'xht']
// Shown as text in the viewer — code, scripts, configs, data. Nothing in them runs.
const TEXT_EXT = [
  'txt', 'log', 'csv', 'tsv', 'md', 'json', 'xml', 'xsl', 'xslt', 'css', 'js', 'mjs', 'cjs', 'jse', 'ts', 'tsx', 'jsx',
  'py', 'php', 'asp', 'aspx', 'jsp', 'java', 'c', 'cpp', 'h', 'cs', 'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe',
  'wsf', 'wsh', 'hta', 'sh', 'reg', 'sql', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'toml', 'properties', 'nc', 'gcode', 'tap',
  'iges', 'igs', 'mht', 'mhtml',
]
const TEXT_VIEW_MAX = 2 * 1024 * 1024 // show at most 2 MB of text; the rest via Download
const TEXT_SNIFF_MAX = 5 * 1024 * 1024 // unknown files up to 5 MB are checked for readable text

export function fileExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function isNativeImage(f: PreviewFile): boolean {
  return NATIVE_IMAGE.includes(fileExt(f.filename))
}

/** Blob requests (responseType 'blob') carry the server's JSON error as a Blob:
 * unwrap it so the user sees the backend's real reason, not "status code 403". */
async function blobErrorMessage(err: unknown, fallback: string): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text())
      return extractErrorMessages({ response: { data: parsed } }, fallback).join(' ')
    } catch { /* not JSON */ }
  }
  return extractErrorMessages(err, fallback).join(' ')
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', pdf: 'application/pdf',
}

/** SharePoint viewer links only — never put anything else into the frame. */
function isSharePointViewerUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname.endsWith('.sharepoint.com') || u.hostname.endsWith('.sharepoint-df.com'))
  } catch {
    return false
  }
}

// Thumbnails stay for the browser session, so going back to a tab does not
// ask SharePoint again (the API sends no-store, so the browser cache can't help).
// Grey sweep on a thumbnail while it loads (still grey when motion is reduced).
const SHIMMER_STYLE = (
  <style>{`
    .ap-shimmer { background: linear-gradient(90deg, rgba(0,0,0,0.05) 25%, rgba(0,0,0,0.11) 50%, rgba(0,0,0,0.05) 75%); background-size: 200% 100%; animation: ap-shimmer 1.2s ease-in-out infinite; }
    @keyframes ap-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .ap-shimmer { animation: none; } }
  `}</style>
)

const thumbCache = new Map<string, Blob>()
const THUMB_CACHE_MAX = 300

export function formatFileSize(bytes?: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const BADGE_COLORS: Record<string, string> = {
  pdf: '#dc2626', doc: '#2563eb', docx: '#2563eb', xls: '#16a34a', xlsx: '#16a34a', csv: '#16a34a',
  ppt: '#ea580c', pptx: '#ea580c', mp4: '#7c3aed', mov: '#7c3aed', webm: '#7c3aed', avi: '#7c3aed', mkv: '#7c3aed',
  zip: '#78716c', dwg: '#0891b2', dxf: '#0891b2', step: '#0891b2', stp: '#0891b2',
}

function FileBadge({ filename, size }: { filename: string; size: number }) {
  const ext = fileExt(filename) || 'file'
  const color = BADGE_COLORS[ext] || '#57534e'
  return (
    <div aria-hidden="true" style={{ width: size, height: size, borderRadius: 8, background: `${color}14`, border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      <span style={{ fontSize: size >= 48 ? 11 : 9.5, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '.03em' }}>{ext.slice(0, 4)}</span>
    </div>
  )
}

/** Small preview picture for a list row. Uses the SharePoint thumbnail when
 * `getThumbnail` is given (a few KB), the photo itself for images otherwise,
 * and a coloured file-type badge when neither is available. Render it inside
 * a row keyed by the file id: it loads once per mount. */
export function AttachmentThumb({ file, size = 44, getThumbnail, getBlob, cacheKey }: {
  file: PreviewFile
  size?: number
  getThumbnail?: () => Promise<Blob>
  getBlob?: () => Promise<Blob>
  /** Unique per record + file (e.g. `sr:12:34`) to reuse the picture this session. */
  cacheKey?: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    const sources: (() => Promise<Blob>)[] = []
    if (getThumbnail) sources.push(getThumbnail)
    if (getBlob && isNativeImage(file)) sources.push(getBlob)
    const cached = cacheKey ? thumbCache.get(cacheKey) : undefined
    if (cached) sources.unshift(async () => cached)
    ;(async () => {
      for (const load of sources) {
        try {
          const blob = await load()
          if (cancelled) return
          if (!blob || blob.size === 0) continue
          if (cacheKey && blob !== cached) {
            if (thumbCache.size >= THUMB_CACHE_MAX) thumbCache.delete(thumbCache.keys().next().value as string)
            thumbCache.set(cacheKey, blob)
          }
          objectUrl = URL.createObjectURL(blob)
          setSrc(objectUrl)
          return
        } catch { /* try the next source, then the badge */ }
      }
      if (!cancelled) setFailed(true)
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, file.filename])

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" onError={() => { setSrc(null); setFailed(true) }} style={{ width: size, height: size, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(0,0,0,0.08)', flex: 'none', background: '#f5f5f4' }} />
  }
  if (!failed) {
    return (
      <>
        {SHIMMER_STYLE}
        <div aria-hidden="true" className="ap-shimmer" style={{ width: size, height: size, borderRadius: 8, flex: 'none' }} />
      </>
    )
  }
  return <FileBadge filename={file.filename} size={size} />
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'image'; url: string }
  | { kind: 'frame'; url: string }
  | { kind: 'native-video'; url: string }
  | { kind: 'native-pdf'; url: string }
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'html'; html: string; truncated: boolean }
  | { kind: 'error'; message: string }

/** Reads a blob as text, or null when it is a binary file (has NUL bytes). */
async function readAsText(blob: Blob): Promise<{ text: string; truncated: boolean } | null> {
  const truncated = blob.size > TEXT_VIEW_MAX
  const part = truncated ? blob.slice(0, TEXT_VIEW_MAX) : blob
  const bytes = new Uint8Array(await part.arrayBuffer())
  const probe = bytes.subarray(0, 8192)
  for (let i = 0; i < probe.length; i++) if (probe[i] === 0) return null
  return { text: new TextDecoder('utf-8').decode(bytes), truncated }
}

const iconBtn: React.CSSProperties = {
  ...secondaryBtnStyle, width: 34, height: 34, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}

type DialogProps = {
  files: PreviewFile[]
  /** Which file to open; null = closed. */
  startIndex: number | null
  onClose: () => void
  getBlob: (f: PreviewFile) => Promise<Blob>
  getPreviewUrl: (f: PreviewFile) => Promise<{ getUrl: string }>
}

/** Full-screen popup that shows any attachment inside the portal, with
 * previous / next across the list and Download. */
export default function AttachmentPreviewDialog(props: DialogProps) {
  if (props.startIndex === null || props.files.length === 0 || typeof document === 'undefined') return null
  return <Viewer key={props.startIndex} {...props} startIndex={props.startIndex} />
}

function Viewer({ files, startIndex, onClose, getBlob, getPreviewUrl }: DialogProps & { startIndex: number }) {
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), files.length - 1))
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const uid = useId()

  // The list can shrink while open (file deleted elsewhere): stay in range.
  const cur = Math.min(index, files.length - 1)
  const file = files[cur]

  useEscapeKey(true, onClose)
  useFocusTrap(true, panelRef, { firstField: false, fallback: '[data-dialog-title]' })

  const go = useCallback((delta: number) => {
    if (files.length < 2) return
    setDownloadError('')
    setIndex((i) => (Math.min(i, files.length - 1) + delta + files.length) % files.length)
  }, [files.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Leave arrow keys to the video player's seek and to text fields.
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'VIDEO' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'AUDIO') return
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  const download = async () => {
    setDownloading(true)
    setDownloadError('')
    try {
      const blob = await getBlob(file)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setDownloadError(await blobErrorMessage(err, 'Could not download the file — check your connection and try again.'))
    } finally {
      setDownloading(false)
    }
  }

  const meta = [fileExt(file.filename).toUpperCase(), formatFileSize(file.size)].filter(Boolean).join(' · ')
  const downloadBtn = (
    <button type="button" onClick={download} disabled={downloading} style={{ ...secondaryBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <DownloadSimple size={15} /> {downloading ? 'Downloading…' : 'Download'}
    </button>
  )

  return createPortal(
    <div
      onClick={onClose}
      className="dialog-backdrop"
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-t`}
        onClick={(e) => e.stopPropagation()}
        className="dialog-panel"
        style={{ width: '100%', maxWidth: 1200, height: 'min(92vh, 900px)', background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <p id={`${uid}-t`} data-dialog-title tabIndex={-1} title={file.filename} style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1f1108', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', outline: 'none' }}>
              {file.filename}
            </p>
            <p style={{ margin: 0, fontSize: 11.5, color: '#a8a29e' }}>
              {[files.length > 1 ? `${cur + 1} of ${files.length}` : '', meta].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {files.length > 1 && (
              <>
                <button type="button" onClick={() => go(-1)} aria-label="Previous file" title="Previous (←)" style={iconBtn}><CaretLeft size={16} /></button>
                <button type="button" onClick={() => go(1)} aria-label="Next file" title="Next (→)" style={iconBtn}><CaretRight size={16} /></button>
              </>
            )}
            {downloadBtn}
            <button type="button" onClick={onClose} aria-label="Close preview" title="Close (Esc)" style={iconBtn}><X size={16} /></button>
          </div>
        </div>
        {downloadError && <p role="alert" style={{ margin: 0, padding: '8px 14px', fontSize: 12.5, color: '#b91c1c', background: '#fef2f2' }}>{downloadError}</p>}

        <FileStage key={file.id} file={file} getBlob={getBlob} getPreviewUrl={getPreviewUrl} downloadBtn={downloadBtn} />
      </div>
    </div>,
    document.body,
  )
}

/** The viewing area for one file. Keyed by file id, so every file starts
 * fresh in the loading state. Photos: drawn from their bytes. Everything
 * else: SharePoint viewer; when that link cannot be made, the browser's own
 * video player / PDF viewer for those formats, else a clear message. */
function FileStage({ file, getBlob, getPreviewUrl, downloadBtn }: {
  file: PreviewFile
  getBlob: (f: PreviewFile) => Promise<Blob>
  getPreviewUrl: (f: PreviewFile) => Promise<{ getUrl: string }>
  downloadBtn: React.ReactNode
}) {
  const [view, setView] = useState<ViewState>({ kind: 'loading' })
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [showCode, setShowCode] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    const ext = fileExt(file.filename)

    const fromBytes = async (): Promise<ViewState | null> => {
      const blob = await getBlob(file)
      if (cancelled) return null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      const mime = MIME_BY_EXT[ext]
      if (!mime) return null
      // Type from the extension, never the uploader's stored content type.
      objectUrl = URL.createObjectURL(new Blob([blob], { type: mime }))
      if (NATIVE_IMAGE.includes(ext)) return { kind: 'image', url: objectUrl }
      if (NATIVE_VIDEO.includes(ext)) return { kind: 'native-video', url: objectUrl }
      if (ext === 'pdf') return { kind: 'native-pdf', url: objectUrl }
      return null
    }

    ;(async () => {
      if (isNativeImage(file)) {
        try {
          const v = await fromBytes()
          if (!cancelled && v) { setView(v); return }
        } catch { /* fall through to the SharePoint viewer */ }
      }
      // SVG: drawn as a picture (<img> never runs script inside an SVG).
      // Web pages: drawn in a fully sandboxed frame (no script, no access to the portal).
      // Code / scripts / text: shown as text. Nothing in any of them can run.
      if (ext === 'svg' || HTML_EXT.includes(ext) || TEXT_EXT.includes(ext)) {
        try {
          const blob = await getBlob(file)
          if (cancelled) return
          if (ext === 'svg') {
            objectUrl = URL.createObjectURL(new Blob([blob], { type: 'image/svg+xml' }))
            setView({ kind: 'image', url: objectUrl })
            return
          }
          const t = await readAsText(blob)
          if (cancelled) return
          if (t) {
            setView(HTML_EXT.includes(ext) ? { kind: 'html', html: t.text, truncated: t.truncated } : { kind: 'text', ...t })
            return
          }
        } catch (err) {
          if (!cancelled) setView({ kind: 'error', message: `This file could not be loaded (${(await blobErrorMessage(err, 'connection problem')).replace(/\.$/, '')}). Try again, or use Download.` })
          return
        }
      }
      try {
        const { getUrl } = await getPreviewUrl(file)
        if (!isSharePointViewerUrl(getUrl)) throw new Error('SharePoint returned an unexpected preview link.')
        if (!cancelled) setView({ kind: 'frame', url: getUrl })
      } catch (err) {
        if (cancelled) return
        const reason = (await blobErrorMessage(err, '')).replace(/\.$/, '')
        if (!isNativeImage(file) && (NATIVE_VIDEO.includes(ext) || ext === 'pdf')) {
          try {
            const v = await fromBytes()
            if (!cancelled && v) { setView(v); return }
          } catch { /* report below */ }
        }
        // Any other file that is really text (ASCII DXF, logs, unknown config files): show its text.
        if (!file.size || file.size <= TEXT_SNIFF_MAX) {
          try {
            const t = await readAsText(await getBlob(file))
            if (!cancelled && t) { setView({ kind: 'text', ...t }); return }
          } catch { /* report below */ }
        }
        if (!cancelled) {
          setView({
            kind: 'error',
            message: `This file cannot be previewed in the portal${reason ? ` (${reason})` : ''}. Programs are never run here. Use Download to open it in its own application (for example SOLIDWORKS / eDrawings for CAD files).`,
          })
        }
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dark = view.kind === 'image' || view.kind === 'native-video'

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, background: dark ? '#1c1917' : '#f5f5f4', display: 'flex', alignItems: zoomed ? 'flex-start' : 'center', justifyContent: zoomed ? 'flex-start' : 'center', overflow: zoomed ? 'auto' : 'hidden' }}>
      {(view.kind === 'loading' || (view.kind === 'frame' && !frameLoaded)) && (
        <div role="status" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16, textAlign: 'center' }}>
          {/* App-standard jumping-square loader (.loader in globals.css); its shadow sits 60px down */}
          <div className="loader" aria-hidden="true" style={{ margin: '0 0 30px' }} />
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: '#57534e', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Opening {file.filename}…</p>
          {!isNativeImage(file) && (
            <p style={{ margin: 0, fontSize: 12, color: '#a8a29e' }}>Videos and large files can take a few seconds.</p>
          )}
        </div>
      )}
      {view.kind === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={view.url}
          alt={file.filename}
          onClick={() => setZoomed((z) => !z)}
          title={zoomed ? 'Click to fit the screen' : 'Click to see full size'}
          style={zoomed
            ? { maxWidth: 'none', maxHeight: 'none', cursor: 'zoom-out' }
            : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'zoom-in' }}
        />
      )}
      {view.kind === 'native-video' && (
        <video src={view.url} controls autoPlay style={{ maxWidth: '100%', maxHeight: '100%' }} />
      )}
      {view.kind === 'native-pdf' && (
        <iframe src={view.url} title={file.filename} style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
      )}
      {view.kind === 'frame' && (
        <iframe
          src={view.url}
          title={file.filename}
          onLoad={() => setFrameLoaded(true)}
          allow="fullscreen; autoplay"
          allowFullScreen
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads allow-presentation"
          style={{ width: '100%', height: '100%', border: 'none', background: '#fff', opacity: frameLoaded ? 1 : 0 }}
        />
      )}
      {(view.kind === 'text' || (view.kind === 'html' && showCode)) && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'auto', background: '#fff' }}>
          {view.truncated && (
            <p style={{ margin: 0, padding: '6px 14px', fontSize: 12, color: '#92400e', background: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
              Showing the first 2 MB only — use Download for the full file.
            </p>
          )}
          <pre style={{ margin: 0, padding: 16, fontSize: 12.5, lineHeight: 1.55, color: '#1c1917', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {view.kind === 'text' ? view.text : view.html}
          </pre>
        </div>
      )}
      {view.kind === 'html' && !showCode && (
        // sandbox="" = no scripts, no forms, no popups, no access to the portal: the page is only drawn.
        <iframe sandbox="" srcDoc={view.html} title={file.filename} referrerPolicy="no-referrer" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', background: '#fff' }} />
      )}
      {view.kind === 'html' && (
        <button
          type="button"
          onClick={() => setShowCode((s) => !s)}
          style={{ ...secondaryBtnStyle, position: 'absolute', top: 10, right: 14, zIndex: 1, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}
        >
          {showCode ? 'View page' : 'View code'}
        </button>
      )}
      {view.kind === 'error' && (
        <div role="alert" style={{ maxWidth: 460, textAlign: 'center', padding: 24, margin: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><FileBadge filename={file.filename} size={56} /></div>
          <p style={{ margin: '0 0 14px', fontSize: 13.5, color: '#57534e', lineHeight: 1.6 }}>{view.message}</p>
          {downloadBtn}
        </div>
      )}
    </div>
  )
}
