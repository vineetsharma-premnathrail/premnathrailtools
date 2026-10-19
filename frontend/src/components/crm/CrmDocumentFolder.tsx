'use client'

import { useEffect, useState } from 'react'
import { ArrowSquareOut, MagnifyingGlass } from '@phosphor-icons/react'
import { crmApi } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { CrmDocument } from '@/types'
import { inputStyle } from '@/components/crm/ui'
import { FormSheet, SheetSection, SheetIcon, FileDropZone, SHEET, sheetBtn, sheetInput, sheetHint, SheetError } from '@/components/shared/FormSheet'

/** A document the system generates from a record (e.g. a quotation PDF) —
 * listed with the uploaded files but opened live and never deleted from here. */
export type GeneratedDoc = { key: string; name: string; category: string; createdAt?: string; open: () => void }

type Row = { key: string; name: string; category: string; createdAt?: string; by?: string; size?: number; generated?: boolean; open: () => void }

/** Fixed panel height: the file list scrolls inside it once it is full, so
 * Client and Internal stay the same size however many files each holds. */
const PANEL_HEIGHT = 460

/** Used when the categories list is empty or can't be loaded. */
const FALLBACK_CATEGORY = 'Other'

/** Search box shown above both folders of a Documents tab; its text filters
 * both lists (name, category, uploader, date). */
export function DocumentSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ flex: '0 0 100%' }}>
      <div style={{ position: 'relative', maxWidth: 420 }}>
      <MagnifyingGlass size={15} color="#a8a29e" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search documents by name, category, uploader or date…"
        aria-label="Search documents"
        style={{ ...inputStyle, paddingLeft: 34 }}
      />
      </div>
    </div>
  )
}

/** One folder (Client / Internal) of an inquiry's or tender's Documents tab:
 * newest-first file list with type, category, uploader and created date,
 * plus a drag-and-drop upload zone. Shared by Inquiry and Tender panels. */
export default function CrmDocumentFolder({ tourId, title, folderType, docs, generated = [], related, canModify, onUploaded, setError, query = '' }: {
  tourId?: string
  title: string
  folderType: 'client' | 'internal'
  docs: CrmDocument[]
  generated?: GeneratedDoc[]
  related: { module: 'inquiry' | 'tender'; id: number; universalId: string; orgId: number }
  canModify: boolean
  onUploaded: () => void
  setError: (v: string | string[]) => void
  query?: string
}) {
  // Category choices come from CRM › Settings › Lists › Document Categories.
  const [categories, setCategories] = useState<string[]>([])
  const [docCategory, setDocCategory] = useState(FALLBACK_CATEGORY)
  const [uploading, setUploading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [uploadError, setUploadError] = useState<string | string[]>('')
  const closeUpload = () => { if (!uploading) { setShowUpload(false); setFiles([]); setUploadError('') } }

  useEffect(() => {
    if (!canModify) return
    crmApi.listDocumentCategories()
      .then((rows) => {
        // Alphabetical, with the catch-all "Other" last; it's also the default pick.
        const labels = rows.map((r) => r.label)
          .sort((a, b) => (a === FALLBACK_CATEGORY ? 1 : b === FALLBACK_CATEGORY ? -1 : a.localeCompare(b)))
        setCategories(labels)
        setDocCategory(labels.includes(FALLBACK_CATEGORY) || labels.length === 0 ? FALLBACK_CATEGORY : labels[0])
      })
      .catch((err) => setError(extractErrorMessages(err, 'Could not load the document categories, so uploads will be filed as "Other". Reload the page to try again.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canModify])

  const handleUpload = async () => {
    if (files.length === 0) { setUploadError('Pick at least one file to upload — drag it onto the box or click to browse.'); return }
    setUploading(true)
    setUploadError('')
    try {
      await crmApi.uploadDocuments(
        { related_module: related.module, related_id: related.id, folder_type: folderType, doc_category: docCategory, universal_id: related.universalId, org_id: related.orgId },
        files
      )
      setShowUpload(false)
      setFiles([])
      onUploaded()
    } catch (err) {
      setUploadError(extractErrorMessages(err, `Upload to ${title} failed. Check the file is under the size limit and that you can edit this ${related.module}, then try again.`))
    } finally {
      setUploading(false)
    }
  }

  const rows: Row[] = [
    ...generated.map((g) => ({ key: g.key, name: g.name, category: g.category, createdAt: g.createdAt, generated: true, open: g.open })),
    ...docs.map((d) => ({
      key: `doc-${d.id}`,
      name: d.file_name,
      category: d.doc_category === 'rnd_response' ? 'R&D Response' : (d.doc_category || 'Other'),
      createdAt: d.created_at,
      by: d.uploaded_by_name,
      size: d.file_size,
      open: async () => {
        try {
          await crmApi.openDocument(d)
        } catch (err) {
          setError(extractErrorMessages(err, `Could not open ${d.file_name}. It may have been moved on SharePoint; reload the page and try again.`))
        }
      },
    })),
  ].sort((a, b) => (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0))

  const q = query.trim().toLowerCase()
  const shown = q
    ? rows.filter((r) => [r.name, r.category, r.by, r.createdAt ? formatDateTime(r.createdAt) : ''].some((v) => v?.toLowerCase().includes(q)))
    : rows

  return (
    <div data-tour={tourId} style={{ position: 'relative', flex: '1 1 380px', minWidth: 0, height: PANEL_HEIGHT, boxSizing: 'border-box', padding: 16, borderRadius: 16, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 4px 14px rgba(15,23,42,0.05)', display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <p style={{ fontSize: 13.5, fontWeight: 700, color: '#1f1108', margin: 0 }}>{title}</p>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(255,122,69,0.12)', color: '#c2410c' }}>{q ? `${shown.length} of ${rows.length}` : rows.length}</span>
      </div>

      {shown.length === 0 ? (
        <p style={{ flex: 1, fontSize: 12.5, color: '#a8a29e', margin: 0, padding: '14px 0', textAlign: 'center' }}>
          {rows.length === 0 ? 'No documents yet.' : `No ${title.toLowerCase()} match "${query.trim()}".`}
        </p>
      ) : (
        <div style={{ flex: 1, minHeight: 0, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', overflowY: 'auto', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 12 }}>
          {shown.map((r, i) => {
            const type = fileType(r.name)
            return (
              <button
                key={r.key}
                type="button"
                onClick={r.open}
                title={`Open ${r.name}`}
                style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderTop: i ? '1px solid rgba(0,0,0,0.05)' : 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,122,69,0.05)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 9, background: `${type.color}1a`, color: type.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800, letterSpacing: '.02em' }}>{type.label}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1f1108', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 9999, background: r.generated ? 'rgba(139,92,246,0.1)' : 'rgba(0,0,0,0.05)', color: r.generated ? '#7c3aed' : '#57534e' }}>{r.category}</span>
                    <span style={{ fontSize: 11, color: '#78716c' }}>
                      {[r.createdAt ? formatDateTime(r.createdAt) : null, r.by, r.size ? formatSize(r.size) : null].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                </span>
                <ArrowSquareOut size={15} color="#a8a29e" style={{ flex: 'none' }} />
              </button>
            )
          })}
        </div>
      )}

      {canModify && (
        <button type="button" onClick={() => { setUploadError(''); setFiles([]); setShowUpload(true) }} style={{ ...sheetBtn('secondary', SHEET.INK), flex: 'none', justifyContent: 'center', borderStyle: 'dashed' }}>
          <SheetIcon name="upload" size={16} color={SHEET.BLUE} />Upload to {title}
        </button>
      )}

      {canModify && showUpload && (
        <FormSheet width={580} icon="upload" title={`Upload to ${title}`} subtitle={`Files are filed under this ${related.module}'s ${title} with the category you pick.`} onClose={closeUpload} busy={uploading}
          footer={<>
            <button type="button" onClick={closeUpload} disabled={uploading} style={sheetBtn('secondary', SHEET.INK, uploading)}>Cancel</button>
            <button type="button" onClick={handleUpload} disabled={uploading} style={sheetBtn('primary', SHEET.BLUE, uploading)}>
              <SheetIcon name="upload" size={16} />{uploading ? 'Uploading…' : `Upload${files.length ? ` ${files.length} file${files.length > 1 ? 's' : ''}` : ''}`}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <SheetError error={uploadError} />
            <SheetSection icon="tag" title="Category">
              <select value={docCategory} onChange={(e) => setDocCategory(e.target.value)} style={{ ...sheetInput, maxWidth: 300 }}>
                {(categories.length ? categories : [FALLBACK_CATEGORY]).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <p style={sheetHint}>Choices come from CRM › Settings › Lists › Document Categories.</p>
            </SheetSection>
            <SheetSection icon="clip" title="Files">
              <FileDropZone files={files} onChange={setFiles} />
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}

function fileType(name: string): { label: string; color: string } {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (ext === 'pdf') return { label: 'PDF', color: '#dc2626' }
  if (['doc', 'docx', 'rtf'].includes(ext)) return { label: 'DOC', color: '#2563eb' }
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { label: 'XLS', color: '#16a34a' }
  if (['ppt', 'pptx'].includes(ext)) return { label: 'PPT', color: '#ea580c' }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return { label: 'IMG', color: '#9333ea' }
  if (['dwg', 'dxf', 'step', 'stp', 'igs'].includes(ext)) return { label: 'CAD', color: '#0891b2' }
  if (['zip', 'rar', '7z'].includes(ext)) return { label: 'ZIP', color: '#78716c' }
  return { label: ext ? ext.slice(0, 4).toUpperCase() : 'FILE', color: '#78716c' }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
