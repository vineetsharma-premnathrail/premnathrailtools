'use client'

// New folder / Edit folder / Move folder — one FormSheet popup.

import { useState } from 'react'
import Select from '@/components/shared/Select'
import Checkbox from '@/components/Checkbox'
import DraftBanner from '@/components/shared/DraftBanner'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { FormSheet, SheetField, SheetError, SheetIcon, sheetBtn, sheetInput, SHEET } from '@/components/shared/FormSheet'
import { useFormDraft } from '@/lib/formDraft'
import { useCan } from '@/lib/permissions'
import { extractErrorMessages } from '@/lib/validation'
import { folderAndDescendantIds, folderOptions, folderTotal, isConfidentialFolder, isPricingFolder, salesLibraryApi, type LibFolder, type LibFolderPayload } from '@/lib/salesLibraryApi'
import { RemoteSelect, useRemotePicker } from '@/components/crm/library/libraryUi'

export type FolderSheetMode = 'create' | 'edit' | 'move'

type Form = { name: string; parentId: string; description: string; productId: string; confidential: boolean; pricing: boolean }

export default function FolderSheet({ mode, folders, folder, parentId, onClose, onSaved }: {
  mode: FolderSheetMode
  folders: LibFolder[]
  /** The folder being edited / moved. */
  folder?: LibFolder
  /** New folder: the folder it is created inside (null = top level). */
  parentId?: number | null
  onClose: () => void
  onSaved: (f: LibFolder) => void
}) {
  const productPick = useRemotePicker('product')
  const { canFeature } = useCan()
  // Only people with the Confidential access can change the flag (the server enforces it too).
  const mayConfidential = canFeature('crm', 'sales_library', 'confidential', 'view')
  const [askPublic, setAskPublic] = useState(false)
  const [form, setForm] = useState<Form>(() => ({
    name: folder?.name ?? '',
    parentId: String((mode === 'create' ? parentId : folder?.parent_id) ?? ''),
    description: folder?.description ?? '',
    productId: folder?.product_id != null ? String(folder.product_id) : '',
    confidential: folder?.is_confidential ?? false,
    pricing: folder?.is_pricing ?? false,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const draft = useFormDraft<Form>(mode === 'create' ? 'crm-library-folder-new' : null, form, setForm)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const blocked = folder ? folderAndDescendantIds(folders, folder.id) : new Set<number>()
  const parentIdNum = form.parentId ? Number(form.parentId) : null
  // A folder inside a confidential folder (any level up) is always confidential (the server enforces it too).
  const forcedConfidential = isConfidentialFolder(folders, parentIdNum)
  const confidential = forcedConfidential || form.confidential
  // A parent further up that is a Pricing folder applies to this folder's documents as well.
  const pricingAbove = isPricingFolder(folders, parentIdNum)
  // Editing / moving out of confidentiality shows the files to everyone with Knowledge Hub access.
  const fileCount = folder ? folderTotal(folders, folder.id) : 0
  const becomesPublic = mode !== 'create' && !!folder && fileCount > 0 && isConfidentialFolder(folders, folder.id) && !confidential

  const submit = async () => {
    setError('')
    if (mode !== 'move' && !form.name.trim()) { setError('Enter a folder name — it is how people find the folder in the tree.'); return }
    if (becomesPublic && !askPublic) { setAskPublic(true); return }
    setAskPublic(false)
    setBusy(true)
    try {
      const parent_id = form.parentId ? Number(form.parentId) : null
      let saved: LibFolder
      if (mode === 'create') {
        saved = await salesLibraryApi.createFolder({
          name: form.name.trim(), parent_id, description: form.description.trim() || null,
          product_id: form.productId ? Number(form.productId) : null, is_confidential: confidential, is_pricing: form.pricing,
        })
        draft.clear()
      } else if (mode === 'move') {
        saved = await salesLibraryApi.updateFolder(folder!.id, { parent_id })
      } else {
        const payload: LibFolderPayload = {
          name: form.name.trim(), parent_id, description: form.description.trim() || null,
          product_id: form.productId ? Number(form.productId) : null, is_confidential: confidential, is_pricing: form.pricing,
        }
        saved = await salesLibraryApi.updateFolder(folder!.id, payload)
      }
      onSaved(saved)
    } catch (err) {
      setError(extractErrorMessages(err, mode === 'move'
        ? 'The folder could not be moved. Pick a different parent folder, or reload the page and try again.'
        : 'The folder could not be saved. Check the name is not already used in that folder, then try again.'))
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'create' ? 'New folder' : mode === 'move' ? 'Move folder' : 'Edit folder'
  const parentOptions = folderOptions(folders)
  const label = mode === 'create' ? 'Create folder' : mode === 'move' ? 'Move' : 'Save'

  return (
    <>
    <FormSheet width={560} icon="box" title={title} busy={busy} onClose={onClose} onSubmit={submit}
      subtitle={mode === 'move' ? `Choose where “${folder?.name}” goes. Its documents and sub-folders move with it.` : 'Folders keep sales material organised. Add as many levels as you need.'}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="submit" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="check" size={16} />{busy ? 'Saving…' : label}</button>
      </>}>
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {mode === 'create' && <DraftBanner draft={draft} style={{ marginBottom: 0 }} />}
        <SheetError error={error} />
        {mode !== 'move' && (
          <SheetField label="Folder name" required>
            <input value={form.name} maxLength={150} onChange={(e) => set('name', e.target.value)} placeholder="e.g. RRV catalogues" style={sheetInput} autoFocus />
          </SheetField>
        )}
        <SheetField label="Inside folder" hint={mode === 'move' ? 'A folder cannot be moved into itself or into one of its own sub-folders.' : 'Leave on “Top level” to create a main folder.'}>
          <Select value={form.parentId} onChange={(e) => set('parentId', e.target.value)} style={sheetInput}>
            <option value="">Top level</option>
            {parentOptions.map((o) => {
              const inside = blocked.has(o.id)
              return <option key={o.id} value={String(o.id)} disabled={inside}>{o.label}{inside ? ' — inside this folder' : ''}</option>
            })}
          </Select>
        </SheetField>
        {mode !== 'move' && (
          <>
            <SheetField label="Description" hint="Optional — what belongs in this folder.">
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} style={{ ...sheetInput, resize: 'vertical' }} />
            </SheetField>
            <SheetField label="Linked product" hint="Files uploaded into this folder are linked to this product automatically, so they show on the product page under Sales Resources.">
              <RemoteSelect picker={productPick} kind="product" value={form.productId} onChange={(v) => set('productId', v)} allLabel="No product" fallbackLabel={folder?.product_name || undefined} ariaLabel="Linked product" />
            </SheetField>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: forcedConfidential || !mayConfidential ? 'default' : 'pointer' }}>
                <Checkbox asSwitch checked={confidential} disabled={forcedConfidential || !mayConfidential} onChange={(e) => set('confidential', e.target.checked)} aria-label="Confidential" />
                <span style={{ fontSize: 13, color: SHEET.BODY }}>
                  <strong style={{ color: SHEET.INK }}>Confidential</strong><br />
                  {forcedConfidential
                    ? 'This folder is inside a confidential folder, so it is confidential too.'
                    : !mayConfidential
                      ? 'Only people with the Confidential access in their role can change this. Ask an admin if this folder should be confidential.'
                      : 'Only people with the Confidential access in their role can see this folder and its documents. Sub-folders become confidential too.'}
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <Checkbox asSwitch checked={form.pricing} onChange={(e) => set('pricing', e.target.checked)} aria-label="Pricing folder" />
                <span style={{ fontSize: 13, color: SHEET.BODY }}>
                  <strong style={{ color: SHEET.INK }}>Pricing folder</strong><br />
                  Every document in it must carry an expiry date, so outdated prices are flagged as Expired.
                  {pricingAbove && <><br /><em>A folder above this one is already a Pricing folder, so documents here need an expiry date anyway.</em></>}
                </span>
              </label>
            </div>
          </>
        )}
      </div>
    </FormSheet>
    <ConfirmDialog open={askPublic} title="Make these files visible to more people?" confirmLabel="Continue" danger={false}
      message={`This makes ${fileCount} ${fileCount === 1 ? 'file' : 'files'} visible to everyone with Knowledge Hub access. Continue?`}
      onConfirm={submit} onCancel={() => setAskPublic(false)} />
    </>
  )
}
