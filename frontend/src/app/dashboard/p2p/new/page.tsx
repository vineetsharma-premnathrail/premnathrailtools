'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { p2pApi, storeApi } from '@/lib/api'
import { PRCategoryMeta, P2PPurposeMeta, P2PRequest, P2PRequestLineItemInput, StoreItem } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { accountAssignmentApi, ACCOUNT_ASSIGNMENTS } from '@/lib/mmLogisticsApi'

import DateField from '@/components/erp/DateField'
import { FormPage, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import P2PNav from '@/components/p2p/P2PNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { RowCount, pillStyle } from '@/components/shared/ui'

const PRIORITIES = ['low', 'medium', 'high']
const STANDARD_ITEM_TYPES = ['material', 'service', 'asset', 'consumable', 'tool_equipment']
const typeLabel = (t: string) => { const s = t.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1) }

// Purpose of the requisition (2026-10-23, backend p2p/purpose.py): decides what
// it must be charged to. What each purpose offers / locks (categories,
// requirement types, item types, Charged To, line project mode) comes from the
// server (/meta, edited in Procurement › Settings › Purpose rules); only the
// help text lives here. One project per machine: lines never pick a vehicle / lot.
const PURPOSE_HINTS: Record<string, string> = {
  machine_project: 'Spares or work for a machine already delivered to the customer: service, repair, warranty. Pick the machine; every line is for it. Charged To is optional.',
  development: 'New product development (R&D). Charged to the R&D project it belongs to; Finance is linked automatically.',
  // The cost centre is picked by Purchase on the PO (your department's by default), not here.
  department: "Day-to-day running cost of a department: cleaning material, stationery, small tools, office repairs, AMC, housekeeping. Purchase charges it to your department's cost centre on the PO.",
  capital: "Something the company owns and uses for years (machine, laptop, AC, welding set). Charged to the asset's internal order.",
  stock: 'Common items Store keeps in stock (fasteners, oil, gloves). Nothing is charged now; the cost goes to whoever Store issues it to.',
}

// A line is an Item Master item (store_item_id). Name, part code, UOM and
// category come from the master — shown read-only here and copied onto the
// line by the server. A new item is added in Store › Item Master first.
function emptyItem(): P2PRequestLineItemInput {
  return { store_item_id: null, item_name: '', make: '', part_code: '', unit: '', quantity: 1, project_inhouse: '', category: '', ship_to: '', order_project_id: null, order_project_element_id: null }
}


const inputStyle = sheetInput

// A value the purpose fixes (one option, or locked in Procurement › Settings › Purpose rules): read-only, with a "Fixed" tag.
function FixedValue({ text, label }: { text: string; label: string }) {
  return (
    <>
      <div role="textbox" aria-readonly="true" aria-label={`${label} (fixed by the purpose)`} tabIndex={0} title="Fixed by the purpose" style={{ ...sheetInput, display: 'flex', alignItems: 'center', gap: 8, background: SHEET.SOFT, fontWeight: 600 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
        <span style={{ ...pillStyle('#475569'), marginLeft: 'auto', flex: 'none' }}>Fixed · Set by purpose</span>
      </div>
    </>
  )
}
// Shown while the Purpose is empty: the field exists (no layout shift) but cannot be used yet.
function ChoosePurposeFirst({ label }: { label: string }) {
  return <SearchableSelect value="" onChange={() => {}} ariaLabel={label} disabled placeholder="Choose a purpose first" options={[]} />
}
// Compact attach row: one line with the button and the picked files (replaces the 100px drop zones).
function AttachRow({ label, files, onChange, tour }: { label: string; files: File[]; onChange: (f: File[]) => void; tour: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div data-tour={tour} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 44, padding: '6px 10px', border: `1.5px dashed #cbd5e1`, borderRadius: 10, background: '#fff', marginBottom: 8 }}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onChange([...files, ...Array.from(e.dataTransfer.files)].slice(0, 10)) }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: SHEET.INK, flex: '0 0 auto' }}>{label}</span>
      <button type="button" onClick={() => ref.current?.click()} aria-label={`Attach files: ${label}`} style={{ ...sheetBtn('secondary', SHEET.INK), marginLeft: 'auto' }}><SheetIcon name="clip" size={14} />Attach files</button>
      <input ref={ref} type="file" multiple hidden onChange={(e) => { onChange([...files, ...Array.from(e.target.files || [])].slice(0, 10)); e.target.value = '' }} />
      {files.length > 0 && (
        <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {files.map((f, i) => (
            // ui-audit-ignore-next-line custom-pill — picked-file chip (name + remove), not a status badge
            <span key={`${f.name}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 10px', borderRadius: 999, background: '#f1f5f9', color: SHEET.BODY, maxWidth: '100%' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: SHEET.MUTED, fontSize: 14, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
const labelStyle = sheetLabel
const readCell: React.CSSProperties = { padding: '6px 8px', fontSize: 13, color: SHEET.BODY, whiteSpace: 'nowrap' }
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: SHEET.MUTED, whiteSpace: 'nowrap', background: SHEET.SOFT, borderBottom: `1px solid ${SHEET.LINE}` }

export default function NewP2PRequestPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  const router = useRouter()
  const searchParams = useSearchParams()
  // ?edit=<ref>: edit an existing requisition (draft, returned, or one not yet
  // at RFQ) instead of raising a new one.
  const editRef = searchParams.get('edit')
  const { id: editId, error: editLinkError } = useRecordId(editRef)
  const [editing, setEditing] = useState<P2PRequest | null>(null)

  const [metaError, setMetaError] = useState('')
  const [metaLoaded, setMetaLoaded] = useState(false)
  const [acctLoading, setAcctLoading] = useState(false)
  const [acctError, setAcctError] = useState('')
  // After a failed submit the message opens in a dialog; closing it puts focus on the field to fix.
  const focusIdRef = useRef<string | null>(null)
  const [categories, setCategories] = useState<PRCategoryMeta[]>([])
  const [requirementTypes, setRequirementTypes] = useState<string[]>([])
  const [masterItems, setMasterItems] = useState<StoreItem[]>([])
  const [loadingMaster, setLoadingMaster] = useState(false)
  const masterById = useMemo(() => new Map(masterItems.map((i) => [i.id, i])), [masterItems])
  // Each purpose with the categories it offers, its pre-filled category /
  // requirement type and the item types it may buy (backend p2p/purpose.py PURPOSE_FORM).
  const [purposes, setPurposes] = useState<P2PPurposeMeta[]>([])
  const [purpose, setPurpose] = useState('')
  const purposeMeta = purposes.find((p) => p.code === purpose)
  // Charged To / line project rules of the chosen purpose (from the server).
  const rule = purposeMeta ? { kinds: purposeMeta.charged_to_kinds, required: purposeMeta.charged_required,
    inhouseOnly: purposeMeta.line_project_mode === 'inhouse', hint: PURPOSE_HINTS[purposeMeta.code] || '' } : undefined
  const allowedTypes = purposeMeta?.item_types?.length ? purposeMeta.item_types : null
  // Per-line pickers to narrow the item list: Item Type, then Category
  // (categories offered are the ones used under the chosen type).
  const [lineFilters, setLineFilters] = useState<{ type: string; category: string }[]>([{ type: '', category: '' }])
  // The purpose decides which Item Master types may be bought (backend
  // p2p/purpose.py PURPOSE_ITEM_TYPES, via /meta). Types Store added beyond the
  // standard five aren't judged, so they stay offered.
  const typeFits = (t: string | null | undefined) =>
    !allowedTypes || !STANDARD_ITEM_TYPES.includes(t || '') || allowedTypes.includes(t || '')
  const itemTypeOptions = useMemo(() => {
    const present = Array.from(new Set(masterItems.map((i) => i.item_type || '').filter(Boolean)))
    if (!allowedTypes) return present.sort()
    // Purpose order (most usual first); only types that have items, once the list is loaded.
    const ordered = allowedTypes.filter((t) => !present.length || present.includes(t))
    return [...ordered, ...present.filter((t) => !STANDARD_ITEM_TYPES.includes(t)).sort()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterItems, allowedTypes])
  // The line's type pick; the only allowed type is chosen for the requester.
  const effectiveType = (picked: string) =>
    itemTypeOptions.includes(picked) ? picked : itemTypeOptions.length === 1 ? itemTypeOptions[0] : ''
  const categoriesForType = (type: string) =>
    Array.from(new Set(masterItems.filter((i) => (!type ? typeFits(i.item_type) : i.item_type === type)).map((i) => i.category || '').filter(Boolean))).sort()
  const setLineFilter = (idx: number, patch: Partial<{ type: string; category: string }>) =>
    setLineFilters((prev) => {
      const next = [...prev]
      while (next.length <= idx) next.push({ type: '', category: '' })
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  const [projects, setProjects] = useState<{ id: number; label: string }[]>([])

  const [projectId, setProjectId] = useState('')
  // Account assignment (SAP ME51N): what the purchase is charged to — a real link.
  const [acctKind, setAcctKind] = useState('')
  const [acctId, setAcctId] = useState('')
  const [acctOptions, setAcctOptions] = useState<{ id: number; label: string }[]>([])
  const [categoryCode, setCategoryCode] = useState('')
  const [requiredDate, setRequiredDate] = useState('')
  const [requirementType, setRequirementType] = useState('')
  const [priority, setPriority] = useState('medium')
  const [remarks, setRemarks] = useState('')
  const [items, setItems] = useState<P2PRequestLineItemInput[]>([emptyItem()])
  const [supportingFiles, setSupportingFiles] = useState<File[]>([])
  const [specFiles, setSpecFiles] = useState<File[]>([])

  const [submitting, setSubmitting] = useState<'' | 'draft' | 'submit'>('')
  const [error, setError] = useState<string | string[]>('')
  const [uploadWarning, setUploadWarning] = useState<{ prHref: string; message: string } | null>(null)

  // Pre-fill from Store's "Raise P2P Request" low-stock action — see
  // docs/product/PURCHASE_STORE_INTEGRATION.md integration point 2. Pure
  // UI pre-fill only; nothing is submitted until the requester reviews and
  // clicks Submit themselves.
  useEffect(() => {
    if (editRef) return
    // Multi-line pre-fill (e.g. Maintenance › Spares "Raise PR for selected"):
    // ?prefill=session reads { items, remarks } from sessionStorage 'p2p_new_prefill'.
    if (searchParams.get('prefill') === 'session') {
      try {
        const pre = JSON.parse(sessionStorage.getItem('p2p_new_prefill') || 'null')
        if (Array.isArray(pre?.items) && pre.items.length) {
          setItems(pre.items.map((i: Partial<P2PRequestLineItemInput>) => ({
            ...emptyItem(), project_inhouse: i.order_project_element_id ? 'Project' : 'Inhouse', store_item_id: i.store_item_id ?? null,
            make: i.make || '', quantity: Number(i.quantity) || 1,
            // Order Project vehicle / lot the demand is pegged to (MRP / shortage callers).
            order_project_id: i.order_project_id ?? null, order_project_element_id: i.order_project_element_id ?? null,
          })))
          if (pre.remarks) setRemarks(String(pre.remarks))
          return
        }
      } catch { /* bad / missing pre-fill — start with a blank form */ }
    }
    const storeItemId = Number(searchParams.get('store_item_id'))
    if (!storeItemId) return
    // ?order_project_id=&order_project_element_id=: demand pegged to an Order Project vehicle / lot.
    const opElementId = Number(searchParams.get('order_project_element_id')) || null
    setItems([{
      ...emptyItem(),
      store_item_id: storeItemId,
      make: searchParams.get('make') || '',
      quantity: Number(searchParams.get('quantity')) || 1,
      project_inhouse: opElementId ? 'Project' : 'Inhouse',
      order_project_id: opElementId ? Number(searchParams.get('order_project_id')) || null : null,
      order_project_element_id: opElementId,
    }])
    // `remarks` lets other callers (e.g. Production's shortage planner) say where the request came from.
    setRemarks(searchParams.get('remarks') || `Auto-suggested from Store low-stock alert${searchParams.get('part_code') ? ` for part ${searchParams.get('part_code')}` : ''}.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setAcctError('')
    if (!isAuthorized || !acctKind) { setAcctOptions([]); setAcctLoading(false); return }
    let live = true
    setAcctLoading(true); setAcctOptions([])
    accountAssignmentApi.options(acctKind).then((r) => { if (live) setAcctOptions(r.options) })
      .catch((err) => { if (live) setAcctError(extractErrorMessages(err, 'Failed to load the account assignment list.').join(' ')) })
      .finally(() => { if (live) setAcctLoading(false) })
    return () => { live = false }
  }, [isAuthorized, acctKind])

  useEffect(() => {
    if (!isAuthorized) return
    ;(async () => {
      try {
        const [meta, projectList] = await Promise.all([p2pApi.getMeta(), p2pApi.listProjects()])
        setCategories(meta.categories)
        setRequirementTypes(meta.requirement_types)
        setPurposes(meta.purposes || [])
        setProjects(projectList)
        setMetaLoaded(true)
      } catch (err) {
        setMetaError(extractErrorMessages(err, 'Failed to load form options.').join(' '))
      }
    })()
  }, [isAuthorized])

  // Edit mode: load the requisition and fill the form from it once the form
  // options are in (an existing project is matched back by its label).
  useEffect(() => {
    if (!isAuthorized || !editId || !categories.length) return
    if (editing && editing.id === editId) return
    ;(async () => {
      try {
        const pr: P2PRequest = await p2pApi.get(editId)
        if (!pr.can_edit) {
          setError(pr.edit_block_reason || `${pr.p2p_number} can no longer be edited.`)
          return
        }
        setEditing(pr)
        const match = projects.find((p) => p.label === pr.project_label)
        setProjectId(match ? String(match.id) : '')
        setCategoryCode(pr.category_code)
        {
          const a = pr as unknown as Record<string, unknown>
          let kind = (a.account_assignment as string) || ''
          let fk = ACCOUNT_ASSIGNMENTS.find((x) => x.value === kind)?.fk
          // Production is charged to the Order Project only — an older PR
          // charged to the sales order is shown as its Order Project.
          if (kind === 'sales_order' && pr.order_project_id) { kind = 'order_project'; fk = 'order_project_id' }
          setAcctKind(kind)
          setAcctId(fk && a[fk] ? String(a[fk]) : '')
          // Requisitions from before the Purpose question: infer it where the
          // charge makes it clear, otherwise the requester picks it.
          setPurpose(pr.purpose || (kind === 'order_project' || kind === 'sales_order' ? 'customer_order'
            : kind === 'cost_center' ? 'department' : match ? 'machine_project' : ''))
        }
        setRequiredDate(pr.required_date || '')
        setRequirementType(pr.requirement_type || '')
        setPriority(pr.priority || 'medium')
        setRemarks(pr.remarks || '')
        setItems(pr.items.length ? pr.items.map((it) => ({
          ...emptyItem(), id: it.id, store_item_id: it.store_item_id ?? null, make: it.make || '',
          quantity: it.quantity, project_inhouse: it.project_inhouse || '', ship_to: it.ship_to || '',
          order_project_id: it.order_project_id ?? null, order_project_element_id: it.order_project_element_id ?? null,
        })) : [emptyItem()])
      } catch (err) {
        setError(extractErrorMessages(err, 'Could not load the requisition to edit.'))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, editId, categories])

  // Active Item Master items. Re-loadable, so an item just added in
  // Store › Item Master (new tab) can be picked without losing the form.
  const loadMasterItems = async () => {
    setLoadingMaster(true)
    try {
      setMasterItems(await storeApi.listItems({ status: 'active' }))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not load the Item Master list.'))
    } finally {
      setLoadingMaster(false)
    }
  }
  useEffect(() => {
    if (isAuthorized) loadMasterItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized])

  // Lines whose picked item is of a type this purpose doesn't buy.
  const typeMismatches = allowedTypes
    ? items.flatMap((it, idx) => {
        const m = it.store_item_id ? masterById.get(it.store_item_id) : undefined
        return m && !typeFits(m.item_type) ? [`Line ${idx + 1} (${m.item_code} ${m.item_name}, ${typeLabel(m.item_type || '').toLowerCase()})`] : []
      })
    : []
  // A new requisition (or a draft) is held to the purpose's rules on submit;
  // one already submitted is not re-checked by the server.
  const rulesApply = !editing || editing.status === 'draft'

  const pickItem = (idx: number, value: string) => {
    const m = masterById.get(Number(value))
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, store_item_id: m ? m.id : null } : it)))
  }

  // A new purpose resets the charge to what that purpose takes.
  const pickPurpose = (value: string) => {
    setPurpose(value)
    const pm = purposes.find((p) => p.code === value)
    if (value !== 'machine_project' && value !== 'customer_order') setProjectId('')
    setAcctKind(pm?.charged_required ? pm.charged_to_kinds[0] : '')
    setAcctId('')
    // Lines carry no project choice: Inhouse purposes mark every line Inhouse, the rest are for the header's project.
    setItems((prev) => prev.map((it) => ({ ...it, project_inhouse: pm?.line_project_mode === 'inhouse' ? 'Inhouse' : 'Project', order_project_id: null, order_project_element_id: null })))
    // Category / requirement type follow the purpose — a category that still
    // fits is kept, otherwise the purpose's usual one (or blank) is put in.
    // A submitted requisition's category is fixed (it is in the number).
    // A locked (or single-option) field always takes the purpose's value.
    if (pm && (!editing || editing.status === 'draft')) {
      setCategoryCode((cur) => (pm.category_locked ? pm.default_category || '' : pm.categories.includes(cur) ? cur : pm.default_category || (pm.categories.length === 1 ? pm.categories[0] : '')))
    }
    if (pm) {
      setRequirementType((cur) => (pm.requirement_type_locked ? pm.default_requirement_type || ''
        : pm.default_requirement_type ? pm.default_requirement_type : pm.requirement_types.includes(cur) ? cur : pm.requirement_types.length === 1 ? pm.requirement_types[0] : ''))
    }
    // Each line's Item Type pick must be one the new purpose buys; the rest of
    // the filter is kept. Lines already holding an out-of-type item are only
    // warned about (see typeMismatches), never dropped.
    const ok = pm?.item_types
    if (ok?.length) {
      setLineFilters((prev) => prev.map((f) => ({
        type: f.type && STANDARD_ITEM_TYPES.includes(f.type) && !ok.includes(f.type) ? '' : f.type,
        category: f.category,
      })))
    }
  }

  const updateItem = (idx: number, field: keyof P2PRequestLineItemInput, value: string | number | null) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }
  const addItem = () => {
    setItems((prev) => [...prev, emptyItem()])
    setLineFilters((prev) => [...prev, { type: '', category: '' }])
  }
  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
    setLineFilters((prev) => prev.filter((_, i) => i !== idx))
  }

  // asDraft: keep it as a private draft — only the category is needed, and
  // lines without an item picked yet are left out. Submit checks everything.
  const fail = (msg: string | string[], focusId?: string) => { focusIdRef.current = focusId || null; setError(msg) }
  const closeError = () => {
    setError('')
    const id = focusIdRef.current; focusIdRef.current = null
    if (id) setTimeout(() => {
      const el = document.getElementById(id)
      const target = el && (el.matches('input,button,textarea,select,[tabindex]') ? el : el.querySelector<HTMLElement>('input,button,textarea,select,[tabindex]'))
      ;(target as HTMLElement | null)?.focus()
    }, 0)
  }
  const handleSubmit = async (asDraft: boolean) => {
    setError('')
    if (editRef && !editing) { fail('The requisition is still loading — try again in a moment.'); return }
    if (asDraft) {
      if (!categoryCode) { fail(purposeMeta ? 'Pick a Purchase Requisition category before saving the draft — it decides the requisition number.' : 'Choose a purpose first — it sets the category, and the category is needed before saving the draft (it decides the requisition number).', purposeMeta ? 'pr-field-category' : 'pr-field-purpose'); return }
      const bad = items.findIndex((it) => it.store_item_id && !(Number(it.quantity) > 0))
      if (bad >= 0) { fail(`Line ${bad + 1}: quantity must be more than 0.`, `pr-line-${bad + 1}-qty`); return }
    } else {
    if (!rule) { fail('Choose the purpose of this requisition: what is it being bought for?', 'pr-field-purpose'); return }
    if ((purpose === 'machine_project' || purpose === 'customer_order') && !projectId) { fail('Pick the machine project this requisition is for.', 'pr-field-project'); return }
    if (acctKind && !acctId) {
      fail(acctKind === 'rnd_project'
        ? 'Pick the R&D project this development belongs to.'
        : acctKind === 'internal_order'
        ? "Pick the internal order this is charged to. If it isn't in the list, ask Finance to open one in Finance › Masters & Setup › Internal Orders."
        : `Pick the ${ACCOUNT_ASSIGNMENTS.find((a) => a.value === acctKind)?.label.toLowerCase()} this requisition is charged to.`, 'pr-field-acct-id')
      return
    }
    if (!categoryCode) { fail('Please select a Purchase Requisition category.', 'pr-field-category'); return }
    for (let i = 0; i < items.length; i++) {
      const m = items[i].store_item_id ? masterById.get(items[i].store_item_id!) : undefined
      if (!m) {
        fail(`Line ${i + 1}: pick the item from the Item Master. If it's a new item, add it first in Store › Item Master, then click "refresh items".`, `pr-line-${i + 1}-item`)
        return
      }
      if (!(Number(items[i].quantity) > 0)) {
        fail(`Line ${i + 1} (${m.item_code} ${m.item_name}): quantity must be more than 0.`, `pr-line-${i + 1}-qty`)
        return
      }
    }
    // The same rules the server enforces on a new requisition / draft — shown here so the fix is on the form.
    if (rulesApply && purposeMeta) {
      if (!purposeMeta.categories.includes(categoryCode)) {
        setError(`${categories.find((c) => c.code === categoryCode)?.label || categoryCode} isn't a category for a ${purposeMeta.label.toLowerCase()} requisition — pick one of: ${purposeMeta.categories.map((c) => categories.find((x) => x.code === c)?.label || c).join(', ')}.`)
        return
      }
      if (requirementType && !purposeMeta.requirement_types.includes(requirementType)) {
        setError(`Requirement type ${requirementType} isn't offered for a ${purposeMeta.label.toLowerCase()} requisition — pick one of: ${purposeMeta.requirement_types.join(', ')}.`)
        return
      }
      if (typeMismatches.length && allowedTypes) {
        setError(`${typeMismatches.join('; ')} ${typeMismatches.length === 1 ? "isn't" : "aren't"} an item type bought on a ${purposeMeta.label.toLowerCase()} requisition (it takes: ${allowedTypes.map((t) => typeLabel(t).toLowerCase()).join(', ')}). Pick another item for ${typeMismatches.length === 1 ? 'that line' : 'those lines'}, or change the purpose.`)
        return
      }
    }
    }

    setSubmitting(asDraft ? 'draft' : 'submit')
    try {
      const payload = {
        save_as_draft: asDraft,
        purpose: purpose || null,
        // Only a machine project names a project; for the rest the server
        // fills the label from what it is charged to (or the purpose).
        project_label: (purpose === 'machine_project' || purpose === 'customer_order') ? projects.find((p) => p.id === Number(projectId))?.label : null,
        category_code: categoryCode,
        account_assignment: acctKind || null,
        ...Object.fromEntries(ACCOUNT_ASSIGNMENTS.map((x) => [x.fk, x.value === acctKind && acctId ? Number(acctId) : null])),
        required_date: requiredDate || undefined,
        requirement_type: requirementType || undefined,
        priority,
        remarks: remarks || undefined,
        items: items.filter((it) => !asDraft || it.store_item_id).map((it) => ({
          id: it.id || undefined,
          store_item_id: it.store_item_id,
          quantity: Number(it.quantity),
          project_inhouse: rule?.inhouseOnly ? 'Inhouse' : 'Project', // no per-line choice; the server applies the purpose's rule
          ship_to: it.ship_to || undefined,
          order_project_element_id: it.order_project_element_id || null,
        })),
      }
      const pr = editing ? await p2pApi.edit(editing.id, payload) : await p2pApi.create(payload)

      const allFiles = [...supportingFiles.map((f) => ({ f, doc: 'supporting' })), ...specFiles.map((f) => ({ f, doc: 'specification' }))]
      // The PR is already created — an upload failure mustn't undo that, but
      // the requester must be told which files didn't make it and why.
      let failedCount = 0
      const failReasons: string[] = []
      for (const doc of ['supporting', 'specification'] as const) {
        const files = allFiles.filter((x) => x.doc === doc).map((x) => x.f)
        if (files.length) {
          try {
            await p2pApi.uploadAttachments(pr.id, files, doc)
          } catch (err) {
            failedCount += files.length
            failReasons.push(...extractErrorMessages(err, `Upload of ${doc} file(s) failed.`))
          }
        }
      }

      if (failedCount > 0) {
        setUploadWarning({
          prHref: recordPath('/dashboard/p2p', pr),
          message: `Purchase Requisition ${pr.p2p_number} was ${asDraft ? 'saved' : editing ? 'updated' : 'created'}, but ${failedCount} file(s) failed to upload: ${Array.from(new Set(failReasons)).join(' ')} Open the requisition and add them again.`,
        })
        return
      }
      router.push(recordPath('/dashboard/p2p', pr))
    } catch (err) {
      setError(extractErrorMessages(err, asDraft ? 'Failed to save the draft.' : 'Failed to submit Purchase Requisition.'))
    } finally {
      setSubmitting('')
    }
  }

  if (isLoading || !isAuthorized) return null
  if (editLinkError) return <InvalidRecordLink message={editLinkError} listHref="/dashboard/p2p" />

  const inApproval = !!editing && (editing.status === 'submitted' || editing.status === 'approved')
  const heading = !editing ? 'New Purchase Requisition'
    : editing.status === 'draft' ? `Edit Draft ${editing.p2p_number}` : `Edit Purchase Requisition ${editing.p2p_number}`

  const subtitle = !editing ? 'Ask for items from the Item Master — approved requisitions go to stock check, then RFQ and PO.'
    : `${editing.category_label || editing.category_code} · status ${editing.status.replace(/_/g, ' ')}`

  return (
    <FormPage nav={<P2PNav />} icon={editing ? 'edit' : 'cart'} title={heading} subtitle={subtitle} onBack={() => router.back()} backTour="pr-new-back"
      footer={<>
        <button data-tour="pr-new-cancel" onClick={() => router.back()} type="button" style={sheetBtn('secondary', SHEET.INK)}>Cancel</button>
        <button data-tour="pr-new-save-draft" onClick={() => handleSubmit(true)} disabled={!!submitting} type="button" style={sheetBtn('secondary', SHEET.INK, !!submitting)}>
          <SheetIcon name="doc" size={16} />{submitting === 'draft' ? 'Saving…' : 'Save as Draft'}
        </button>
        <button data-tour="pr-new-submit" onClick={() => handleSubmit(false)} disabled={!!submitting} type="button" style={sheetBtn('primary', SHEET.BLUE, !!submitting)}>
          <SheetIcon name="send" size={16} />{submitting === 'submit' ? 'Submitting…' : editing && editing.status !== 'draft' ? 'Save & Submit for Approval' : 'Submit Purchase Requisition'}
        </button>
      </>}>
      <MessageDialog open={!!error} variant="error" title="Cannot Save Request" message={error} onClose={closeError} />
      <MessageDialog
        open={!!uploadWarning}
        variant="warning"
        title="Requisition Created — Some Files Not Uploaded"
        message={uploadWarning?.message || ''}
        actionLabel="Open Requisition"
        onAction={() => { const href = uploadWarning?.prHref; setUploadWarning(null); if (href) router.push(href) }}
        onClose={() => { const href = uploadWarning?.prHref; setUploadWarning(null); if (href) router.push(href) }}
      />

      {inApproval && (
        <div style={{ padding: '10px 14px', margin: '16px 24px 0', borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#92400e', fontSize: 13 }}>
          This requisition is {editing?.status === 'approved' ? 'already approved' : 'waiting for approval'}. Saving your changes withdraws that approval:
          {' '}<b>Save &amp; Submit</b> sends it for approval again, <b>Save as Draft</b> keeps it with you until you submit it.
        </div>
      )}

      <div className="sheet-columns" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 0 }}>
        <div style={{ minWidth: 0, padding: '20px 24px', borderRight: `1px solid ${SHEET.LINE}` }}>
          <SheetSection icon="building" title="Purpose & Charging">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div data-tour="pr-new-purpose" style={{ minWidth: 0 }}>
                <label style={labelStyle}>Purpose <Req /></label>
                <div id="pr-field-purpose">
                  <SearchableSelect value={purpose} onChange={pickPurpose} ariaLabel="Purpose" disabled={!!metaError}
                    placeholder={metaError ? 'Purposes could not be loaded' : metaLoaded ? 'What is this being bought for?' : 'Loading purposes…'}
                    options={purposes.map((p) => ({ value: p.code, label: p.label }))} />
                </div>
              </div>
              <div data-tour="pr-new-charged-to" style={{ minWidth: 0 }}>
                <label style={labelStyle}>Charged To{rule?.required && <> <Req /></>}</label>
                {!rule ? (
                  <ChoosePurposeFirst label="Charged To" />
                ) : rule.kinds.length === 0 ? (
                  <FixedValue label="Charged To" text="Nothing charged now" />
                ) : rule.kinds.length === 1 && rule.required ? (
                  // One required answer: a fixed value, not a dead dropdown.
                  <FixedValue label="Charged To" text={ACCOUNT_ASSIGNMENTS.find((a) => a.value === rule.kinds[0])?.label || ''} />
                ) : (
                  <SearchableSelect value={acctKind} onChange={(v) => { setAcctKind(v); setAcctId('') }} ariaLabel="Charged To"
                    options={[...(rule.required ? [] : [{ value: '', label: 'Not charged' }]),
                      ...ACCOUNT_ASSIGNMENTS.filter((a) => rule.kinds.includes(a.value)).map((a) => ({ value: a.value, label: a.label }))]}
                    placeholder="Select…" />
                )}
              </div>
            </div>
            {metaError && <p role="alert" style={{ ...sheetHint, color: '#B91C1C' }}>{metaError} Reload the page to try again.</p>}
            {rule && <p data-tour="pr-new-purpose-hint" style={sheetHint}>{rule.hint}</p>}
            {(purpose === 'machine_project' || purpose === 'customer_order' || (rule && rule.kinds.length > 0 && acctKind)) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              {(purpose === 'machine_project' || purpose === 'customer_order') && (
                <div data-tour="pr-new-project" style={{ minWidth: 0 }}>
                  <label style={labelStyle}>{purpose === 'customer_order' ? 'Project' : 'Machine Project'} <Req /></label>
                  <div id="pr-field-project">
                    <SearchableSelect
                      value={projectId}
                      onChange={setProjectId}
                      ariaLabel="Machine project"
                      disabled={metaLoaded && projects.length === 0}
                      options={projects.map((p) => ({ value: String(p.id), label: p.label }))}
                      placeholder={!metaLoaded ? 'Loading machine projects…' : projects.length ? 'Search machine project…' : 'No machine projects yet'}
                    />
                  </div>
                  {metaLoaded && projects.length === 0 && <p style={sheetHint}>No machine projects found. Reload the page; if the list stays empty, ask an admin which delivered machines are set up as projects.</p>}
                </div>
              )}
              {acctKind && (
                <div style={{ minWidth: 0 }}>
                  <label style={labelStyle}>{ACCOUNT_ASSIGNMENTS.find((a) => a.value === acctKind)?.label} <Req /></label>
                  <div id="pr-field-acct-id">
                    <SearchableSelect value={acctId} onChange={setAcctId} ariaLabel={ACCOUNT_ASSIGNMENTS.find((a) => a.value === acctKind)?.label}
                      disabled={acctLoading || !!acctError || acctOptions.length === 0}
                      options={acctOptions.map((o) => ({ value: String(o.id), label: o.label }))}
                      placeholder={acctLoading ? 'Loading…' : acctError ? 'Could not load the list' : acctOptions.length ? (acctKind === 'rnd_project' ? 'Search an R&D project' : 'Search…') : (acctKind === 'rnd_project' ? 'No open R&D project' : 'Nothing to pick yet')} />
                  </div>
                  {acctError && <p role="alert" style={{ ...sheetHint, color: '#B91C1C' }}>{acctError} Pick the charge type again, or reload the page.</p>}
                  {!acctLoading && !acctError && acctOptions.length === 0 && (
                    <p style={sheetHint}>{acctKind === 'rnd_project'
                      ? 'No open R&D project — ask the R&D head to create one in R&D › Prototype / Research.'
                      : acctKind === 'internal_order'
                      ? 'No internal orders yet — ask Finance to open one in Finance › Masters & Setup › Internal Orders.'
                      : `No ${ACCOUNT_ASSIGNMENTS.find((a) => a.value === acctKind)?.label.toLowerCase()} available yet — ask an admin to set one up, then reload the page.`}</p>
                  )}
                </div>
              )}
            </div>
            )}
          </SheetSection>
        </div>
        <div style={{ minWidth: 0, padding: '20px 24px', background: '#fcfcfd' }}>
          <SheetSection icon="list" title="Request Details">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <label style={labelStyle}>Purchase Requisition Category <Req /></label>
                <div id="pr-field-category" data-tour="pr-new-category">
                  {!purposeMeta ? (
                    <ChoosePurposeFirst label="Purchase Requisition Category" />
                  ) : (purposeMeta.category_locked && categoryCode === purposeMeta.default_category) || (purposeMeta.categories.length === 1 && categoryCode === purposeMeta.categories[0]) ? (
                    <FixedValue label="Purchase Requisition Category" text={`${categories.find((c) => c.code === categoryCode)?.label || categoryCode} (${categoryCode})`} />
                  ) : (
                    // Only the categories that fit the purpose, in its order (the current one stays visible on an older requisition).
                    <SearchableSelect value={categoryCode} onChange={setCategoryCode} ariaLabel="Purchase Requisition Category" placeholder="Select category…"
                      options={categories.filter((c) => purposeMeta.categories.includes(c.code) || c.code === categoryCode)
                        .sort((a, b) => purposeMeta.categories.indexOf(a.code) - purposeMeta.categories.indexOf(b.code))
                        .map((c) => ({ value: c.code, label: `${c.label} (${c.code})` }))} />
                  )}
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <label style={labelStyle}>Requirement Type</label>
                <div data-tour="pr-new-requirement-type">
                  {!purposeMeta ? (
                    <ChoosePurposeFirst label="Requirement Type" />
                  ) : (purposeMeta.requirement_type_locked && requirementType === purposeMeta.default_requirement_type) || (purposeMeta.requirement_types.length === 1 && requirementType === purposeMeta.requirement_types[0]) ? (
                    <FixedValue label="Requirement Type" text={requirementType} />
                  ) : (
                    <SearchableSelect value={requirementType} onChange={setRequirementType} ariaLabel="Requirement Type" placeholder="Select type…"
                      options={requirementTypes.filter((t) => purposeMeta.requirement_types.includes(t) || t === requirementType).map((t) => ({ value: t, label: t }))} />
                  )}
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <label style={labelStyle}>Required Date</label>
                <div data-tour="pr-new-required-date"><DateField value={requiredDate} onChange={setRequiredDate} /></div>
              </div>
              <div style={{ minWidth: 0 }}>
                <label style={labelStyle}>Priority</label>
                <div data-tour="pr-new-priority">
                  <SearchableSelect value={priority} onChange={setPriority} ariaLabel="Priority" placeholder="Priority"
                    options={PRIORITIES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} />
                </div>
              </div>
            </div>
          </SheetSection>
        </div>
      </div>

      <div style={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetSection icon="box" title="Item Details" extra={
          <button data-tour="pr-new-add-item" onClick={addItem} type="button" style={{ ...sheetBtn('secondary', SHEET.INK), marginLeft: 'auto' }}><SheetIcon name="plus" size={14} />Add Item</button>
        }>
          {typeMismatches.length > 0 && allowedTypes && (
            <div data-tour="pr-new-type-warning" style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#92400e', fontSize: 13 }}>
              {typeMismatches.join('; ')} {typeMismatches.length === 1 ? "isn't" : "aren't"} an item type bought on a {purposeMeta?.label.toLowerCase()} requisition
              (it takes: {allowedTypes.map((t) => typeLabel(t).toLowerCase()).join(', ')}).{' '}
              {rulesApply
                ? <>Pick another item for {typeMismatches.length === 1 ? 'that line' : 'those lines'} or change the purpose — it can&apos;t be submitted as it is.</>
                : <>This requisition was submitted earlier, so your changes can still be saved; for new lines pick an item of a type the purpose buys.</>}
            </div>
          )}
          <div style={{ overflowX: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead>
                <tr>
                  {['Actions', 'SL', 'Item (from Item Master) *', 'Make', 'Part Code', 'UOM', 'Qty *', 'Category', 'Ship To'].map((h, i) => (
                    <th key={h} style={th}>{h === 'Actions' ? <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>Actions</span> : h}{i === 1 && <RowCount count={items.length} />}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const m = item.store_item_id ? masterById.get(item.store_item_id) : undefined
                  const f = lineFilters[idx] || { type: '', category: '' }
                  const lineType = effectiveType(f.type)
                  // Only items of the purpose's types (or the line's type pick); keep
                  // the picked item in the list even if it falls outside the filters.
                  const shown = masterItems.filter((i) =>
                    i.id === item.store_item_id
                    || ((lineType ? i.item_type === lineType : typeFits(i.item_type)) && (!f.category || i.category === f.category)))
                  return (
                  <tr key={idx} style={{ borderTop: idx ? `1px solid ${SHEET.LINE}` : undefined }}>
                    <td style={{ padding: '6px 8px', width: 70 }}>
                      {items.length > 1 && (
                        <button type="button" data-tour="pr-new-item-remove" aria-label={`Remove line ${idx + 1}`} onClick={() => removeItem(idx)} style={{ border: 'none', background: 'transparent', paddingBlock: 4, paddingInline: 2, minHeight: 24, fontSize: 11.5, fontWeight: 600, color: '#dc2626', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>Remove</button>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', fontSize: 12.5, fontWeight: 600, color: SHEET.MUTED }}>{idx + 1}</td>
                    <td data-tour="pr-new-item-name" style={{ padding: '6px 8px', minWidth: 300 }}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <div title="Item Type" style={{ flex: '1 1 0', minWidth: 0 }}>
                          <SearchableSelect
                            ariaLabel={`Item type, line ${idx + 1}`}
                            value={lineType}
                            onChange={(type) => setLineFilter(idx, { type, category: categoriesForType(type).includes(f.category) ? f.category : '' })}
                            options={[...(itemTypeOptions.length === 1 ? [] : [{ value: '', label: purposeMeta ? 'All fitting types' : 'All types' }]),
                              ...itemTypeOptions.map((t) => ({ value: t, label: typeLabel(t) }))]}
                            placeholder="Item type"
                          />
                        </div>
                        <div title="Category" style={{ flex: '1 1 0', minWidth: 0 }}>
                          <SearchableSelect
                            ariaLabel={`Category filter, line ${idx + 1}`}
                            value={f.category}
                            onChange={(category) => setLineFilter(idx, { category })}
                            options={[{ value: '', label: 'All categories' }, ...categoriesForType(lineType).map((c) => ({ value: c, label: c }))]}
                            placeholder="Category"
                          />
                        </div>
                      </div>
                      <div id={`pr-line-${idx + 1}-item`}>
                        <div style={{ minWidth: 0 }}>
                          <SearchableSelect
                            ariaLabel={`Item, line ${idx + 1}`}
                            value={item.store_item_id ? String(item.store_item_id) : ''}
                            onChange={(v) => pickItem(idx, v)}
                            options={shown.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}${i.part_number ? ` · ${i.part_number}` : ''}` }))}
                            placeholder={loadingMaster ? 'Loading items…' : `Search ${shown.length} item${shown.length === 1 ? '' : 's'} by code, name or part no…`}
                          />
                        </div>
                      </div>
                    </td>
                    <td data-tour="pr-new-item-make" style={readCell}>{m?.make || '—'}</td>
                    <td data-tour="pr-new-item-partcode" style={readCell}>{m?.part_number || m?.manufacturer_part_number || '—'}</td>
                    <td data-tour="pr-new-item-unit" style={readCell}>{m?.uom || '—'}</td>
                    <td style={{ padding: '6px 8px', minWidth: 70 }}>
                      <input data-tour="pr-new-item-qty" id={`pr-line-${idx + 1}-qty`} aria-label={`Quantity, line ${idx + 1}`} type="number" min={0} step="any" style={inputStyle} value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} />
                    </td>
                    <td data-tour="pr-new-item-category" style={readCell}>{m?.category || '—'}</td>
                    <td style={{ padding: '6px 8px', minWidth: 140 }}>
                      <input data-tour="pr-new-item-shipto" aria-label={`Ship to, line ${idx + 1}`} style={inputStyle} value={item.ship_to} onChange={(e) => updateItem(idx, 'ship_to', e.target.value)} />
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p data-tour="pr-new-item-master-hint" style={sheetHint}>
            Item not in the list? Add it in{' '}
            <a href="/dashboard/store/new" target="_blank" rel="noopener noreferrer" style={{ color: SHEET.BLUE, fontWeight: 600 }}>Store › Item Master</a>
            {' '}(opens in a new tab), then{' '}
            {/* ui-audit-ignore-next-line adhoc-button — inline text link inside a sentence, not a button box */}
            <button type="button" onClick={loadMasterItems} disabled={loadingMaster} style={{ border: 'none', background: 'none', padding: 0, color: SHEET.BLUE, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
              {loadingMaster ? 'refreshing…' : 'refresh items'}
            </button>.
          </p>
        </SheetSection>
      </div>

      <div className="sheet-columns" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', borderTop: `1px solid ${SHEET.LINE}` }}>
        <div style={{ minWidth: 0, padding: '20px 24px', borderRight: `1px solid ${SHEET.LINE}` }}>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea data-tour="pr-new-remarks" aria-label="Remarks" style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)}
              placeholder="Why it is needed, references, anything the buyer should know…" />
          </SheetSection>
        </div>
        <div style={{ minWidth: 0, padding: '20px 24px', background: '#fcfcfd' }}>
          <SheetSection icon="clip" title="Attachments" extra={<Optional />}>
            <AttachRow label="Supporting documents" files={supportingFiles} onChange={setSupportingFiles} tour="pr-new-supporting-docs" />
            <AttachRow label="Specification / reference file" files={specFiles} onChange={setSpecFiles} tour="pr-new-spec-docs" />
          </SheetSection>
        </div>
      </div>
    </FormPage>
  )
}
