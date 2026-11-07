'use client'

import UomSelect from '@/components/erp/UomSelect'
import ItemPhoto from '@/components/store/ItemPhoto'
import ItemUnitNames from '@/components/store/ItemUnitNames'
import ItemTypeSelect, { ItemTypeOption } from '@/components/store/ItemTypeSelect'
import CategorySelect from '@/components/store/CategorySelect'
import SubcategorySelect from '@/components/store/SubcategorySelect'
import { useEffect, useState } from 'react'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreItemCategory, StoreItemMeta, StoreItemUnitName } from '@/types'
import { ItemErpForm, ItemErpValues, EMPTY_ERP_VALUES, erpPayload } from '@/components/store/ItemErpSections'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import { recordPath } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { useVisibility } from '@/lib/visibility'
import { VisOptionValues, VisSection, VisTd, VisTh } from '@/lib/visibilityComponents'

export default function NewStoreItemPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()
  // Role visibility (Organization › Role & Permissions › Store › Items › Visibility): hidden sections, allowed item types.
  const vis = useVisibility('store:items')

  const [categories, setCategories] = useState<StoreItemCategory[]>([])
  const [codePreview, setCodePreview] = useState('')
  const [uoms, setUoms] = useState<{ value: string; label: string }[]>([])
  const [itemName, setItemName] = useState('')
  const [unitNames, setUnitNames] = useState<StoreItemUnitName[]>([])
  const [itemType, setItemType] = useState('material')
  const [itemTypes, setItemTypes] = useState<ItemTypeOption[]>([])
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [description, setDescription] = useState('')
  const [partCode, setPartCode] = useState('')
  const [leadTime, setLeadTime] = useState('')
  const [legacyCode, setLegacyCode] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoWarning, setPhotoWarning] = useState<{ href: string; message: string } | null>(null)
  const [uom, setUom] = useState('')
  const [meta, setMeta] = useState<StoreItemMeta | null>(null)
  const [erp, setErp] = useState<ItemErpValues>(EMPTY_ERP_VALUES)

  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  // Role editor preview: nothing is saved, no draft, module nav / Back left out.
  const draft = useFormDraft(vis.preview ? null : 'store-item-new',
    { itemName, unitNames, itemType, category, subcategory, description, partCode, leadTime, legacyCode, uom, erp },
    (d) => {
      setItemName(d.itemName ?? ''); setUnitNames(d.unitNames ?? []); setItemType(d.itemType || 'material'); setCategory(d.category ?? ''); setSubcategory(d.subcategory ?? '')
      setDescription(d.description ?? ''); setPartCode(d.partCode ?? ''); setLeadTime(d.leadTime ?? ''); setLegacyCode(d.legacyCode ?? '')
      setUom(d.uom ?? ''); setErp({ ...EMPTY_ERP_VALUES, ...(d.erp ?? {}) })
    })

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listCategories().then(setCategories).catch(() => setCategories([]))
    storeApi.getItemMeta().then((m) => {
      setMeta(m); setUoms(m.uoms); setItemTypes(m.item_types)
      // Item types this user's roles allow come flagged `allowed`; when the current (default / drafted) type
      // is not allowed, the first allowed one is picked for them.
      const allowed = (m.item_types as ItemTypeOption[]).filter((t) => t.allowed !== false)  // `allowed` = types/index.ts StoreItemMeta addition pending
      if (allowed.length) setItemType((cur) => (allowed.some((t) => t.value === cur) ? cur : allowed[0].value))
    }).catch(() => setUoms([]))
  }, [isAuthorized])

  // Item code is the next global running number (01, 02 … 100 …) from the
  // server; show what it will be (assigned on save).
  useEffect(() => {
    if (!isAuthorized) return
    let cancelled = false
    storeApi.previewItemCode()
      .then((code) => { if (!cancelled) setCodePreview(code) })
      .catch(() => { if (!cancelled) setCodePreview('') })
    return () => { cancelled = true }
  }, [isAuthorized])

  // Item types this user's roles allow (the server marks each type `allowed`).
  const typeChoices = itemTypes.filter((t) => t.allowed !== false)

  // Only the standard categories for the picked item type.
  const topLevelCategories = categories.filter((c) => !c.parent_id && c.item_type === itemType)
  const selectedCategory = topLevelCategories.find((c) => c.name === category)

  const save = async () => {
    const problems: string[] = []
    if (!itemName.trim()) problems.push('Item Name is required.')
    if (!uom) problems.push('Pick the unit of measure (UOM).')
    if (problems.length) {
      setErrors(problems)
      return
    }
    setBusy(true)
    setErrors([])
    try {
      const item = await storeApi.createItem({
        item_name: itemName.trim(),
        unit_names: unitNames.filter((u) => u.name.trim()),
        item_type: itemType,
        category: category || undefined,
        subcategory: subcategory || undefined,
        description: description.trim() || undefined,
        part_number: partCode.trim() || undefined,
        uom,
        lead_time_days: leadTime.trim() === '' ? null : Number(leadTime),
        legacy_code: legacyCode.trim() || null,
        ...erpPayload(erp),
      })
      draft.clear()
      if (photo) {
        try {
          await storeApi.uploadItemPhoto(item.id, photo)
        } catch (err) {
          // Item is saved; tell the user the photo didn't make it.
          setPhotoWarning({ href: recordPath('/dashboard/store', item), message: `Item ${item.item_code} was saved, but the photo couldn't be uploaded: ${extractErrorMessages(err, 'upload failed').join(' ')} You can add it from the item page.` })
          return
        }
      }
      router.push(recordPath('/dashboard/store', item))
    } catch (err) {
      setErrors(extractErrorMessages(err, 'Failed to create item.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <FormPage nav={vis.preview ? undefined : <StoreNav />} icon="box" title="Add Item" subtitle="A new Item Master record — the code is assigned on save from type + category."
      onBack={vis.preview ? undefined : () => router.push('/dashboard/store')} backTour="item-back-btn"
      footer={<>
        <button data-tour="item-cancel-btn" type="button" disabled={busy || vis.preview} onClick={() => router.push('/dashboard/store')} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button data-tour="item-save-btn" type="button" disabled={busy || vis.preview} onClick={save} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="plus" size={16} />{busy ? 'Saving…' : 'Save Item'}</button>
      </>}>
      <DraftBanner draft={draft} />
      <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Item" message={errors} onClose={() => setErrors([])} />
      <MessageDialog open={!!photoWarning} variant="error" title="Photo Not Uploaded" message={photoWarning?.message || ''}
        onClose={() => photoWarning && router.push(photoWarning.href)} />

      <SheetColumns
        left={<>
          <VisSection vis={vis} k="item_details"><SheetSection icon="list" title="Item Details">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
              <div style={{ flex: '1 1 180px' }}>
                <label style={sheetLabel}>Item Type</label>
                <div data-tour="item-type">
                  <ItemTypeSelect value={itemType} onChange={(v) => { if (v !== itemType) { setItemType(v); setCategory(''); setSubcategory('') } }} types={vis.preview ? itemTypes : typeChoices} />
                  <VisOptionValues vis={vis} dropdown="item_type" />
                </div>
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <label style={sheetLabel}>Category</label>
                <div data-tour="item-category">
                  <CategorySelect itemType={itemType} value={category}
                    onChange={(v) => { if (v !== category) { setCategory(v); setSubcategory('') } }} categories={categories} />
                </div>
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <label style={sheetLabel}>Subcategory</label>
                <div data-tour="item-subcategory">
                  <SubcategorySelect category={selectedCategory} value={subcategory} onChange={setSubcategory} categories={categories} />
                </div>
              </div>
            </div>
            <label style={sheetLabel}>Item Name (as on invoice) <Req /></label>
            <input data-tour="item-name" style={sheetInput} value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Mild Steel Rod 12mm" />
            <ItemUnitNames value={unitNames} onChange={setUnitNames} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 14 }}>
              <div style={{ flex: '0 1 200px', minWidth: 160 }}>
                <label style={sheetLabel}>UOM <Req /></label>
                <div data-tour="item-uom">
                  <UomSelect value={uom} onChange={setUom} options={uoms} onOptionsChange={setUoms} manage={false} />
                </div>
              </div>
            </div>
            <label style={{ ...sheetLabel, marginTop: 14 }}>Technical Specification <Optional /></label>
            <textarea data-tour="item-description" style={{ ...sheetInput, minHeight: 70, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </SheetSection></VisSection>

          <VisSection vis={vis} k="planning"><SheetSection icon="calendar" title="Planning">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              <div style={{ flex: '0 1 220px', minWidth: 180 }}>
                <label style={sheetLabel}>Purchase lead time (days) <Optional /></label>
                <input data-tour="item-lead-time" type="number" min={0} max={730} step={1} style={sheetInput} value={leadTime}
                  onChange={(e) => setLeadTime(e.target.value)} placeholder="e.g. 21" />
              </div>
              <div style={{ flex: '0 1 220px', minWidth: 180 }}>
                <label style={sheetLabel}>Legacy code <Optional /></label>
                <input data-tour="item-legacy-code" style={sheetInput} value={legacyCode} maxLength={50}
                  onChange={(e) => setLegacyCode(e.target.value)} placeholder="v3 / Tally code" />
              </div>
            </div>
            <p style={sheetHint}>Lead time = calendar days from PO to goods in store. Used by MRP and the Engineering long-lead list.</p>
          </SheetSection></VisSection>

          <ItemErpForm values={erp} onChange={(patch) => setErp({ ...erp, ...patch })} meta={meta} itemType={itemType} uom={uom}
            partCode={partCode} onPartCode={setPartCode} partCodeTour="item-part-code" />
        </>}
        right={<>
          <SheetSection icon="tag" title="Item Code">
            <input data-tour="item-code" style={{ ...sheetInput, background: SHEET.SOFT, color: SHEET.BODY, fontWeight: 600 }} value={codePreview} readOnly
              placeholder="Next running number" title="Assigned automatically when you save — the next running number (01, 02 … 100 …)" />
            <p style={sheetHint}>Assigned automatically when you save — the next running number. Numbers are never reused.</p>
          </SheetSection>
          <VisSection vis={vis} k="photo"><SheetSection icon="clip" title="Photo" extra={<Optional />}>
            <div data-tour="item-photo">
              <ItemPhoto pending={photo} onPendingChange={setPhoto} />
            </div>
          </SheetSection></VisSection>
        </>}
      />
    </FormPage>
  )
}
