'use client'

// Upload to the Sales Library: new document(s), or a new version of one document.
// Files go straight from the browser to SharePoint in chunks (any size, e.g. a 200 MB video);
// the portal then records them. Progress shows in the global upload tray.

import { useState } from 'react'
import Select from '@/components/shared/Select'
import DateField from '@/components/erp/DateField'
import DraftBanner from '@/components/shared/DraftBanner'
import {
  FormSheet, SheetColumns, SheetError, SheetField, SheetIcon, SheetSection, FileDropZone, Optional, Req,
  sheetBtn, sheetInput, sheetHint, sheetLabel, SHEET,
} from '@/components/shared/FormSheet'
import { useFormDraft } from '@/lib/formDraft'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { folderOptions, isPricingFolder, salesLibraryApi, type LibDocument, type LibFolder } from '@/lib/salesLibraryApi'
import { MultiPicker, TagsField, daysUntil, joinLinks, useRemotePicker } from '@/components/crm/library/libraryUi'

type Form = { folderId: string; title: string; description: string; tags: string[]; expiry: string; products: string[]; projects: string[]; orgs: string[] }

const PRICING_NEEDS_EXPIRY = 'Pricing documents need an expiry date so outdated prices are flagged — pick the date the price list stops being valid.'
const VERSION_NEEDS_EXPIRY = 'This document is in a Pricing folder and its expiry date is missing or already past. Enter the date the new price list stops being valid (today or later) before uploading.'

export default function UploadSheet({ folders, folderId, document: doc, initialFiles, onClose, onDone }: {
  folders: LibFolder[]
  /** Folder preselected (the one open on the page). */
  folderId?: number | null
  /** Set = upload a new version of this document (folder and details stay as they are). */
  document?: LibDocument
  initialFiles?: File[]
  onClose: () => void
  /** `complete` false = some files went up before one failed: refresh the list, keep the popup open. */
  onDone: (saved: LibDocument[], complete: boolean) => void
}) {
  const versionMode = !!doc
  const productPick = useRemotePicker('product')
  const projectPick = useRemotePicker('project')
  const orgPick = useRemotePicker('organization')
  const [files, setFiles] = useState<File[]>(initialFiles ?? [])
  const [form, setForm] = useState<Form>({ folderId: String((doc?.folder_id ?? folderId) ?? ''), title: '', description: '', tags: [], expiry: '', products: [], projects: [], orgs: [] })
  const [changeNote, setChangeNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | string[]>('')
  const draft = useFormDraft<Form>(versionMode ? null : 'crm-library-upload', form, setForm)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const folder = folders.find((f) => String(f.id) === form.folderId)
  // Pricing = this folder or any folder above it is a Pricing folder.
  const pricing = isPricingFolder(folders, folder?.id)
  // A new version of a priced document needs a valid expiry: its current one is missing or past.
  const versionNeedsExpiry = versionMode && pricing && (!doc!.expiry_date || (daysUntil(doc!.expiry_date) ?? -1) < 0)
  const expiryRequired = versionMode ? versionNeedsExpiry : pricing
  const multi = files.length > 1

  const submit = async () => {
    setError('')
    if (!files.length) { setError('Pick a file to upload — drag it onto the box or click to browse.'); return }
    if (!folder) { setError('Choose the folder this file belongs in.'); return }
    // Checked before any byte is sent to SharePoint.
    if (expiryRequired && !form.expiry) { setError(versionMode ? VERSION_NEEDS_EXPIRY : PRICING_NEEDS_EXPIRY); return }
    if (versionNeedsExpiry && (daysUntil(form.expiry) ?? -1) < 0) { setError(VERSION_NEEDS_EXPIRY); return }
    setBusy(true)
    const saved: LibDocument[] = []
    let remaining = [...files]
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]
        setProgress(files.length > 1 ? `Uploading ${i + 1} of ${files.length}: ${file.name}` : `Uploading ${file.name}…`)
        try {
          const meta = versionMode
            ? { change_note: changeNote.trim() || undefined, expiry_date: form.expiry || undefined }
            : {
              title: !multi && form.title.trim() ? form.title.trim() : undefined,
              description: form.description.trim() || undefined,
              tags: form.tags.length ? form.tags : undefined,
              expiry_date: form.expiry || undefined,
              links: joinLinks(form.products, form.projects, form.orgs),
            }
          saved.push(await salesLibraryApi.uploadFile(file, { folderId: folder.id, documentId: doc?.id, meta }))
          remaining = remaining.filter((f) => f !== file)
        } catch (err) {
          const reason = extractErrorMessages(err, `${file.name} could not be uploaded. Check your connection and that the file is not open in another program, then try again.`).join(' ')
          setFiles(remaining)
          setError(files.length > 1 ? `${file.name}: ${reason}${saved.length ? ` (${saved.length} file${saved.length > 1 ? 's' : ''} before it uploaded fine.)` : ''}` : reason)
          if (saved.length) onDone(saved, false)
          return
        }
      }
      if (!versionMode) draft.clear()
      onDone(saved, true)
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  const folderPick = folderOptions(folders)

  return (
    <FormSheet width={960} icon="upload" busy={busy} onClose={onClose} onSubmit={submit}
      title={versionMode ? 'Upload new version' : 'Upload to Sales Library'}
      subtitle={versionMode ? `${doc!.title} is now on version ${doc!.current_version_no}. The new file becomes version ${doc!.current_version_no + 1}; older versions stay downloadable.` : 'Any file type. Big files such as videos are sent in parts, so a 200 MB video is fine.'}
      footer={<>
        {busy && progress && <span role="status" style={{ marginRight: 'auto', alignSelf: 'center', fontSize: 12.5, color: SHEET.MUTED, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{progress} Keep this page open until it finishes.</span>}
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="submit" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}>
          <SheetIcon name="upload" size={16} />{busy ? 'Uploading…' : versionMode ? 'Upload version' : `Upload${files.length > 1 ? ` ${files.length} files` : ''}`}
        </button>
      </>}>
      <SheetColumns
        left={<>
          {!versionMode && <DraftBanner draft={draft} />}
          <SheetError error={error} />
          <SheetSection icon="clip" title="File">
            <FileDropZone files={files} onChange={setFiles} max={versionMode ? 1 : 10} hint={versionMode ? 'One file — the new version' : 'Any type · up to 10 files at a time · videos and large files are fine'} />
          </SheetSection>
          {versionMode ? (
            <SheetSection icon="history" title="What changed">
              <SheetField label={<>Change note <Optional /></>}>
                <textarea value={changeNote} onChange={(e) => setChangeNote(e.target.value)} rows={3} placeholder="e.g. Updated specifications for 2026" style={{ ...sheetInput, resize: 'vertical' }} />
              </SheetField>
            </SheetSection>
          ) : (
            <SheetSection icon="doc" title="Details">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <SheetField label="Folder" required hint={folder?.product_id ? `Files in this folder are linked to ${folder.product_name || 'its product'} automatically.` : undefined}>
                  <Select value={form.folderId} onChange={(e) => set('folderId', e.target.value)} style={sheetInput} placeholder="Choose a folder">
                    {folderPick.map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}
                  </Select>
                </SheetField>
                <SheetField label={<>Title <Optional /></>} hint={multi ? 'Each file uses its own file name as the title.' : 'Leave empty to use the file name.'}>
                  <input value={form.title} maxLength={200} disabled={multi} onChange={(e) => set('title', e.target.value)} placeholder={files[0]?.name || 'File name'} style={sheetInput} />
                </SheetField>
                <SheetField label={<>Description <Optional /></>}>
                  <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} style={{ ...sheetInput, resize: 'vertical' }} />
                </SheetField>
              </div>
            </SheetSection>
          )}
        </>}
        right={versionMode ? (
          <>
            <SheetSection icon="history" title="Current version">
              <p style={{ ...sheetHint, margin: 0 }}>
                {doc!.title} · v{doc!.current_version_no}{doc!.file_name ? ` · ${doc!.file_name}` : ''}{doc!.updated_at ? ` · updated ${formatDate(doc!.updated_at)}` : ''}
              </p>
            </SheetSection>
            {pricing && (
              <SheetSection icon="calendar" title="Price validity">
                <label style={sheetLabel}>New expiry date {versionNeedsExpiry ? <Req /> : <Optional />}</label>
                <DateField value={form.expiry} onChange={(v) => set('expiry', v)} />
                <p style={sheetHint}>
                  {versionNeedsExpiry
                    ? `${doc!.expiry_date ? `The current expiry (${formatDate(doc!.expiry_date)}) has passed. ` : 'This pricing document has no expiry date. '}Enter the date the new price list stops being valid.`
                    : `Current expiry: ${formatDate(doc!.expiry_date)}. Leave empty to keep it, or enter a new date.`}
                </p>
              </SheetSection>
            )}
          </>
        ) : (
          <>
            <SheetSection icon="tag" title="Find it later">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={sheetLabel}>Tags <Optional /></label>
                  <TagsField tags={form.tags} onChange={(t) => set('tags', t)} disabled={busy} />
                </div>
                <div>
                  <label style={sheetLabel}>Expiry date {pricing ? <Req /> : <Optional />}</label>
                  <DateField value={form.expiry} onChange={(v) => set('expiry', v)} />
                  <p style={sheetHint}>{pricing ? PRICING_NEEDS_EXPIRY : 'Optional. After this date the document shows as Expired.'}</p>
                </div>
              </div>
            </SheetSection>
            <SheetSection icon="link" title="Link to">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={sheetLabel}>Products <Optional /></label>
                  <MultiPicker picker={productPick} kind="product" selected={form.products} onChange={(v) => set('products', v)} placeholder="Search and add a product…" hex="#2563eb" disabled={busy} />
                </div>
                <div>
                  <label style={sheetLabel}>Projects <Optional /></label>
                  <MultiPicker picker={projectPick} kind="project" selected={form.projects} onChange={(v) => set('projects', v)} placeholder="Search and add a project…" hex="#ea580c" disabled={busy} />
                </div>
                <div>
                  <label style={sheetLabel}>Customers <Optional /></label>
                  <MultiPicker picker={orgPick} kind="organization" selected={form.orgs} onChange={(v) => set('orgs', v)} placeholder="Search and add a customer…" hex="#16a34a" disabled={busy} />
                </div>
                <p style={{ ...sheetHint, margin: 0 }}>One file can be linked to many products, projects and customers — it is never copied.</p>
              </div>
            </SheetSection>
          </>
        )}
      />
    </FormSheet>
  )
}
