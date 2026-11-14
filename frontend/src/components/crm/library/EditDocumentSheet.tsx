'use client'

// Edit a document's details: title, description, tags, expiry, folder (move) and links.

import { useState } from 'react'
import Select from '@/components/shared/Select'
import DateField from '@/components/erp/DateField'
import {
  FormSheet, SheetColumns, SheetError, SheetField, SheetIcon, SheetSection, Optional, Req,
  sheetBtn, sheetInput, sheetHint, sheetLabel, SHEET,
} from '@/components/shared/FormSheet'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { folderOptions, isConfidentialFolder, isPricingFolder, salesLibraryApi, type LibDocument, type LibFolder } from '@/lib/salesLibraryApi'
import { MultiPicker, TagsField, joinLinks, splitLinks, useRemotePicker } from '@/components/crm/library/libraryUi'

const PRICING_NEEDS_EXPIRY = 'Pricing documents need an expiry date so outdated prices are flagged — pick the date the price list stops being valid.'

export default function EditDocumentSheet({ doc, folders, onClose, onSaved }: {
  doc: LibDocument
  folders: LibFolder[]
  onClose: () => void
  onSaved: (d: LibDocument) => void
}) {
  const productPick = useRemotePicker('product')
  const projectPick = useRemotePicker('project')
  const orgPick = useRemotePicker('organization')
  const [askPublic, setAskPublic] = useState(false)
  const initial = splitLinks(doc.links)
  const [folderId, setFolderId] = useState(String(doc.folder_id))
  const [title, setTitle] = useState(doc.title)
  const [description, setDescription] = useState(doc.description ?? '')
  const [tags, setTags] = useState<string[]>(doc.tags)
  const [expiry, setExpiry] = useState(doc.expiry_date ? doc.expiry_date.slice(0, 10) : '')
  const [products, setProducts] = useState(initial.products)
  const [projects, setProjects] = useState(initial.projects)
  const [orgs, setOrgs] = useState(initial.orgs)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  const names = (t: string) => Object.fromEntries(doc.links.filter((l) => l.link_type === t && l.name).map((l) => [String(l.link_id), l.name as string]))
  const folder = folders.find((f) => String(f.id) === folderId)
  // Pricing = this folder or any folder above it is a Pricing folder.
  const pricing = isPricingFolder(folders, folder?.id)
  // Moving out of a Confidential folder shows the file to everyone with Knowledge Hub access.
  const becomesPublic = isConfidentialFolder(folders, doc.folder_id) && !isConfidentialFolder(folders, Number(folderId))

  const submit = async () => {
    setError('')
    if (!title.trim()) { setError('Enter a title — it is how people find this document.'); return }
    if (pricing && !expiry) { setError(PRICING_NEEDS_EXPIRY); return }
    if (becomesPublic && !askPublic) { setAskPublic(true); return }
    setAskPublic(false)
    setBusy(true)
    try {
      const saved = await salesLibraryApi.updateDocument(doc.id, {
        title: title.trim(), description: description.trim() || null, tags, expiry_date: expiry || null,
        folder_id: Number(folderId), links: joinLinks(products, projects, orgs),
      })
      onSaved(saved)
    } catch (err) {
      setError(extractErrorMessages(err, 'The document could not be saved. Check the details and try again, or reload the page if someone else changed it.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <FormSheet width={960} icon="edit" busy={busy} onClose={onClose} onSubmit={submit} title="Edit document details"
      subtitle={`${doc.title} · version ${doc.current_version_no}. To replace the file itself, upload a new version.`}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="submit" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <SheetColumns
        left={<>
          <SheetError error={error} />
          <SheetSection icon="doc" title="Details">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <SheetField label="Title" required>
                <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} style={sheetInput} autoFocus />
              </SheetField>
              <SheetField label="Folder" required hint="Choosing another folder moves the document; the file itself stays where it is.">
                <Select value={folderId} onChange={(e) => setFolderId(e.target.value)} style={sheetInput}>
                  {folderOptions(folders).map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}
                </Select>
              </SheetField>
              <SheetField label={<>Description <Optional /></>}>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...sheetInput, resize: 'vertical' }} />
              </SheetField>
            </div>
          </SheetSection>
        </>}
        right={<>
          <SheetSection icon="tag" title="Find it later">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={sheetLabel}>Tags <Optional /></label>
                <TagsField tags={tags} onChange={setTags} disabled={busy} />
              </div>
              <div>
                <label style={sheetLabel}>Expiry date {pricing ? <Req /> : <Optional />}</label>
                <DateField value={expiry} onChange={setExpiry} />
                <p style={sheetHint}>{pricing ? PRICING_NEEDS_EXPIRY : 'Optional. After this date the document shows as Expired.'}</p>
              </div>
            </div>
          </SheetSection>
          <SheetSection icon="link" title="Link to">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={sheetLabel}>Products <Optional /></label>
                <MultiPicker picker={productPick} kind="product" selected={products} onChange={setProducts} placeholder="Search and add a product…" hex="#2563eb" disabled={busy} knownLabels={names('product')} />
              </div>
              <div>
                <label style={sheetLabel}>Projects <Optional /></label>
                <MultiPicker picker={projectPick} kind="project" selected={projects} onChange={setProjects} placeholder="Search and add a project…" hex="#ea580c" disabled={busy} knownLabels={names('project')} />
              </div>
              <div>
                <label style={sheetLabel}>Customers <Optional /></label>
                <MultiPicker picker={orgPick} kind="organization" selected={orgs} onChange={setOrgs} placeholder="Search and add a customer…" hex="#16a34a" disabled={busy} knownLabels={names('organization')} />
              </div>
            </div>
          </SheetSection>
        </>}
      />
    </FormSheet>
    <ConfirmDialog open={askPublic} title="Make this file visible to more people?" confirmLabel="Continue" danger={false}
      message="This makes 1 file visible to everyone with Knowledge Hub access. Continue?"
      onConfirm={submit} onCancel={() => setAskPublic(false)} />
    </>
  )
}
