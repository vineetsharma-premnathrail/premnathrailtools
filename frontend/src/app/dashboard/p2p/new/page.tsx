'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { apiClient, p2pApi, storeApi, usersApi, PrStockAvailability } from '@/lib/api'
import { P2PPurposeMeta, P2PRequest, P2PRequestLineItemInput, StoreItem, StoreItemCategory } from '@/types'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { itemOptionDetail } from '@/lib/itemOptions'
import { matchesAllWords } from '@/lib/searchWords'
import { ACCOUNT_ASSIGNMENTS, accountAssignmentApi } from '@/lib/mmLogisticsApi'

import DateField from '@/components/erp/DateField'
import { FormPage, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import P2PNav from '@/components/p2p/P2PNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { RowCount } from '@/components/shared/ui'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'
import { normalizePriority, PRIORITY_OPTIONS } from '@/lib/priority'
import { useVisibility } from '@/lib/visibility'
import { CONTROL } from '@/lib/theme'
import { VisOptionValues, VisSection, VisTd, VisTh } from '@/lib/visibilityComponents'

type LineFilter = { type: string; category: string; q?: string; custom?: boolean }

const STANDARD_ITEM_TYPES = ['material', 'service', 'asset', 'consumable', 'tool_equipment']
const typeLabel = (t: string) => { const s = t.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1) }

// Purpose of the requisition (2026-10-23, backend p2p/purpose.py): decides what
// it must be charged to. What each purpose offers (item types, Charged To, line
// project mode) comes from the server (/meta, edited in Procurement › Settings ›
// Purpose rules); only the help text lives here. One project per machine: lines
// never pick a vehicle / lot. No header category / requirement type (2026-10-27):
// each line's Item Type + Category say what is bought, and the item's category
// picks the line's buyer (Procurement › Settings › Buyer responsibility).
const PURPOSE_HINTS: Record<string, string> = {
  machine_project: 'Service work on a project: spares, repair, warranty, commissioning support. Pick the project (any stage); every line is for it.',
  development: 'New product development (R&D).',
  // The cost centre is picked by Purchase on the PO (your department's by default), not here.
  department: "Day-to-day running cost of a department: cleaning material, stationery, small tools, office repairs, AMC, housekeeping.",
  capital: "Something the company owns and uses for years (machine, laptop, AC, welding set).",
  stock: 'Common items Store keeps in stock (fasteners, oil, gloves).',
}

// A line is an Item Master item (store_item_id). Name, part code, UOM and
// category come from the master — shown read-only here and copied onto the
// line by the server. For now (owner, 2026-11-18) an item not in the master
// can be typed by hand (manual line: type, category, name, technical details,
// UOM); Store gives it an item code when the goods arrive (GRN).
function emptyItem(): P2PRequestLineItemInput {
  return { store_item_id: null, item_name: '', make: '', part_code: '', unit: '', quantity: 1, project_inhouse: '', category: '', ship_to: '', order_project_id: null, order_project_element_id: null, manual: true, specification: '', item_type: '' }
}

// A manual line's technical details travel in its name ("Name — details", server: item_link.MANUAL_SEP).
const MANUAL_SEP = ' — '
function splitManualName(full: string): { name: string; spec: string } {
  const at = full.indexOf(MANUAL_SEP)
  return at < 0 ? { name: full, spec: '' } : { name: full.slice(0, at), spec: full.slice(at + MANUAL_SEP.length) }
}


const inputStyle = sheetInput
// Typed line boxes (owner, 2026-11-18): one control high like the rest of the row, and grow
// downwards as the text wraps / gets line breaks (up to 4 lines, then scroll inside).
const wrapBox: React.CSSProperties = { ...sheetInput, display: 'block', resize: 'none', overflowY: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
function GrowBox(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Empty: exactly one control high (a long placeholder must not make it taller).
    if (!String(props.value ?? '')) { el.style.height = `${CONTROL.height}px`; el.style.overflowY = 'hidden'; return }
    el.style.height = 'auto'
    const cs = getComputedStyle(el)
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    const max = (parseFloat(cs.lineHeight) || 20) * 4 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + border
    const want = el.scrollHeight + border
    el.style.height = `${Math.min(want, max)}px`
    // Scroll bar only once the text is past four lines.
    el.style.overflowY = want > max ? 'auto' : 'hidden'
  }, [props.value])
  return <textarea ref={ref} rows={1} {...props} style={{ ...wrapBox, overflowY: 'hidden', height: CONTROL.height, ...props.style }} />
}
const oneLine = (v: string) => v.replace(/\r?\n/g, ' ')

// Files for one item line (owner, 2026-11-18): drawing / photo / datasheet of that item.
function LineFiles({ line, files, onChange }: { line: number; files: File[]; onChange: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div data-tour={line === 1 ? 'pr-new-item-files' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 96 }}>
      <button type="button" onClick={() => ref.current?.click()} aria-label={`Attach files to line ${line}`} title="Drawing, photo or datasheet of this item"
        style={{ ...sheetBtn('secondary', SHEET.INK), justifyContent: 'center' }}>
        <SheetIcon name="clip" size={14} />{files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'Attach'}
      </button>
      <input ref={ref} type="file" multiple hidden onChange={(e) => { onChange([...files, ...Array.from(e.target.files || [])].slice(0, 10)); e.target.value = '' }} />
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: SHEET.BODY, maxWidth: 160 }}>
          <span title={f.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
          <button type="button" aria-label={`Remove ${f.name} from line ${line}`} onClick={() => onChange(files.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: SHEET.MUTED, fontSize: 14, lineHeight: 1 }}>×</button>
        </span>
      ))}
    </div>
  )
}

const labelStyle = sheetLabel
const readCell: React.CSSProperties = { padding: '6px 8px', fontSize: 13, color: SHEET.BODY, whiteSpace: 'nowrap' }
const th: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 1, textAlign: 'left', padding: '8px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: SHEET.MUTED, whiteSpace: 'nowrap', background: SHEET.SOFT, borderBottom: `1px solid ${SHEET.LINE}` }

export default function NewP2PRequestPage() {
  const { isAuthorized, isLoading } = useRequireApp('p2p')
  const { can } = useCan()
  const router = useRouter()
  const searchParams = useSearchParams()
  // ?edit=<ref>: edit an existing requisition (draft, returned, or one not yet
  // at RFQ) instead of raising a new one.
  const editRef = searchParams.get('edit')
  const { id: editId, error: editLinkError } = useRecordId(editRef)
  const [editing, setEditing] = useState<P2PRequest | null>(null)

  const [metaError, setMetaError] = useState('')
  const [metaLoaded, setMetaLoaded] = useState(false)
  // After a failed submit the message opens in a dialog; closing it puts focus on the field to fix.
  const focusIdRef = useRef<string | null>(null)
  const [masterItems, setMasterItems] = useState<StoreItem[]>([])
  const [loadingMaster, setLoadingMaster] = useState(false)
  const masterById = useMemo(() => new Map(masterItems.map((i) => [i.id, i])), [masterItems])
  // Each purpose with the item types it may buy (backend p2p/purpose.py PURPOSE_FORM).
  const [purposes, setPurposes] = useState<P2PPurposeMeta[]>([])
  const [purpose, setPurpose] = useState('')
  const purposeMeta = purposes.find((p) => p.code === purpose)
  // What the user's roles let them see here (Role editor > Purchase Requisitions > Visibility).
  const vis = useVisibility('p2p:purchase_requisitions')
  // Charged To / line project rules of the chosen purpose (from the server).
  const rule = purposeMeta ? { kinds: purposeMeta.charged_to_kinds, required: purposeMeta.charged_required,
    inhouseOnly: purposeMeta.line_project_mode === 'inhouse', hint: PURPOSE_HINTS[purposeMeta.code] || '' } : undefined
  const allowedTypes = purposeMeta?.item_types?.length ? purposeMeta.item_types : null
  // Per-line pickers to narrow the item list: Item Type, then Category
  // (categories offered are the ones used under the chosen type).
  // q = the line's item search text; custom = Ship To is a typed address (not a plant).
  const [lineFilters, setLineFilters] = useState<LineFilter[]>([{ type: '', category: '' }])
  // Plants a line can ship to: only active units that run an active store (a
  // unit without a store, e.g. RDC, never receives goods); a typed address is the other choice.
  const [plants, setPlants] = useState<{ id: number; name: string; code: string }[]>([])
  useEffect(() => {
    apiClient.get('/store/items/units')
      .then(({ data }: { data: { id: number; name: string; code: string }[] }) => setPlants(data || []))
      .catch(() => setPlants([]))  // no plant list: Ship To stays a typed address
  }, [])
  const plantLabel = (b: { name: string; code: string }) => `${b.name} (${b.code})`
  // The purpose decides which Item Master types may be bought (backend
  // p2p/purpose.py PURPOSE_ITEM_TYPES, via /meta). Types Store added beyond the
  // standard five aren't judged, so they stay offered.
  const typeFits = (t: string | null | undefined) =>
    !allowedTypes || !STANDARD_ITEM_TYPES.includes(t || '') || allowedTypes.includes(t || '')
  const itemTypeOptions = (() => {
    const present = Array.from(new Set(masterItems.map((i) => i.item_type || '').filter(Boolean)))
    if (!allowedTypes) return present.sort()
    // Purpose order (most usual first); only types that have items, once the list is loaded.
    const ordered = allowedTypes.filter((t) => !present.length || present.includes(t))
    return [...ordered, ...present.filter((t) => !STANDARD_ITEM_TYPES.includes(t)).sort()]
  })()
  // The line's type pick; the only allowed type is chosen for the requester.
  const effectiveType = (picked: string) =>
    itemTypeOptions.includes(picked) ? picked : itemTypeOptions.length === 1 ? itemTypeOptions[0] : ''
  const categoriesForType = (type: string) =>
    Array.from(new Set(masterItems.filter((i) => (!type ? typeFits(i.item_type) : i.item_type === type)).map((i) => i.category || '').filter(Boolean))).sort()
  const setLineFilter = (idx: number, patch: Partial<LineFilter>) =>
    setLineFilters((prev) => {
      const next = [...prev]
      while (next.length <= idx) next.push({ type: '', category: '' })
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  // Manual (typed) lines: the Item Master categories (with their type) and units to pick from.
  const [catMaster, setCatMaster] = useState<StoreItemCategory[]>([])
  useEffect(() => {
    storeApi.listCategories().then((c: StoreItemCategory[]) => setCatMaster(c.filter((x) => x.is_active && !x.parent_id))).catch(() => setCatMaster([]))
  }, [])
  // A typed line's type (2026-11-18: no Item Type on the PR for now): the type of the
  // Item Master category its typed category matches, else none.
  const manualType = (idx: number) => {
    const typed = (lineFilters[idx]?.category || '').trim().toLowerCase()
    return (typed && catMaster.find((c) => c.name.toLowerCase() === typed)?.item_type) || ''
  }
  const [projects, setProjects] = useState<{ id: number; label: string; serviceable: boolean }[]>([])

  const [projectId, setProjectId] = useState('')
  // The Project Head of a project requisition (2026-11-18): the approval's "Project head" stage goes to them.
  const [projectHeadId, setProjectHeadId] = useState('')
  const [projectHeads, setProjectHeads] = useState<{ id: number; name: string; designation?: string | null; department?: string | null }[] | null>(null)
  const [projectHeadError, setProjectHeadError] = useState('')
  const isProjectPurpose = purpose === 'machine_project' || purpose === 'customer_order'
  useEffect(() => {
    if (!isProjectPurpose || projectHeads) return
    usersApi.directory()
      // Every active user (owner, 2026-11-18: "project head have all names"); those marked Project head first.
      .then((all) => setProjectHeads([...all.filter((u) => u.is_project_head), ...all.filter((u) => !u.is_project_head)]))
      .catch((err) => setProjectHeadError(extractErrorMessages(err, 'The Project Heads could not be loaded.').join(' ')))
  }, [isProjectPurpose, projectHeads])
  // What the purchase is charged to: hidden on the form for now (2026-10-28); kept so editing an older PR keeps its charge.
  const [acctKind, setAcctKind] = useState('')
  const [acctId, setAcctId] = useState('')
  // New development is charged to an open R&D project (R&D › Prototype / Research); loaded when that purpose is picked.
  const [rndProjects, setRndProjects] = useState<{ id: number; label: string }[] | null>(null)
  const [rndError, setRndError] = useState('')
  useEffect(() => {
    if (purpose !== 'development' || rndProjects) return
    accountAssignmentApi.options('rnd_project')
      .then((r) => setRndProjects(r.options || []))
      .catch((err) => setRndError(extractErrorMessages(err, 'R&D projects could not be loaded.').join(' ')))
  }, [purpose, rndProjects])
  const [requiredDate, setRequiredDate] = useState('')
  const [priority, setPriority] = useState<string>('standard')
  // New form: when the role doesn't offer 'standard', start on the first value it does offer (a saved record keeps its own).
  const allowedPriorityKey = vis.options('priority', PRIORITY_OPTIONS, (o) => o.value).map((o) => o.value).join(',')
  useEffect(() => {
    if (editRef) return
    const allowedValues = allowedPriorityKey.split(',').filter(Boolean)
    if (allowedValues.length && !allowedValues.includes(priority)) setPriority(allowedValues[0])
  }, [allowedPriorityKey, priority, editRef])
  const [remarks, setRemarks] = useState('')
  const [items, setItems] = useState<P2PRequestLineItemInput[]>([emptyItem()])
  // Files picked per item line (same order as `items`); uploaded against the saved line.
  const [lineFiles, setLineFiles] = useState<File[][]>([])

  const [submitting, setSubmitting] = useState<'' | 'draft' | 'submit'>('')
  const [error, setError] = useState<string | string[]>('')
  const [uploadWarning, setUploadWarning] = useState<{ prHref: string; message: string } | null>(null)

  // A new requisition's typed data survives a refresh / network failure (lib/formDraft.ts).
  // Off while editing and when the form is pre-filled from Store / Maintenance / MRP.
  const prefilled = !!searchParams.get('prefill') || !!searchParams.get('store_item_id')
  const draft = useFormDraft(editRef || prefilled || !metaLoaded || vis.preview ? null : 'p2p-pr-new',
    { purpose, projectId, projectHeadId, acctKind, acctId, requiredDate, priority, remarks, items, lineFilters },
    (d) => {
      setPurpose(d.purpose || ''); setProjectId(d.projectId || ''); setProjectHeadId(d.projectHeadId || ''); setAcctKind(d.acctKind || ''); setAcctId(d.acctId || '')
      setRequiredDate(d.requiredDate || ''); setPriority(normalizePriority(d.priority)); setRemarks(d.remarks || '')
      // For now every new line is typed by hand (owner, 2026-11-18): an older draft's empty picker line becomes a typed one.
      setItems(d.items?.length ? d.items.map((it: typeof d.items[number]) => (it.store_item_id ? it : { ...it, manual: true })) : [emptyItem()])
      setLineFilters(d.lineFilters?.length ? d.lineFilters : [{ type: '', category: '' }])
    })

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
            // Project unit (vehicle / lot) the demand is pegged to (MRP / shortage callers).
            order_project_id: i.order_project_id ?? null, order_project_element_id: i.order_project_element_id ?? null,
          })))
          if (pre.remarks) setRemarks(String(pre.remarks))
          return
        }
      } catch { /* bad / missing pre-fill — start with a blank form */ }
    }
    const storeItemId = Number(searchParams.get('store_item_id'))
    if (!storeItemId) return
    // ?order_project_id=&order_project_element_id=: demand pegged to an Project unit (vehicle / lot).
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
    if (!isAuthorized) return
    ;(async () => {
      try {
        const [meta, projectList] = await Promise.all([p2pApi.getMeta(), p2pApi.listProjects(undefined, true)])
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
    if (!isAuthorized || !editId || !metaLoaded) return
    if (editing && editing.id === editId) return
    ;(async () => {
      try {
        const pr: P2PRequest = await p2pApi.get(editId)
        if (!pr.can_edit) {
          setError(pr.edit_block_reason || `${pr.p2p_number} can no longer be edited.`)
          return
        }
        setEditing(pr)
        setProjectId(pr.project_label || '')
        setProjectHeadId(pr.project_head_id ? String(pr.project_head_id) : '')
        {
          const a = pr as unknown as Record<string, unknown>
          let kind = (a.account_assignment as string) || ''
          let fk = ACCOUNT_ASSIGNMENTS.find((x) => x.value === kind)?.fk
          // Production is charged to the Project only — an older PR
          // charged to the sales order is shown as its Project.
          if (kind === 'sales_order' && pr.order_project_id) { kind = 'order_project'; fk = 'order_project_id' }
          setAcctKind(kind)
          setAcctId(fk && a[fk] ? String(a[fk]) : '')
          // Requisitions from before the Purpose question: infer it where the
          // charge makes it clear, otherwise the requester picks it.
          setPurpose(pr.purpose || (kind === 'order_project' || kind === 'sales_order' ? 'customer_order'
            : kind === 'cost_center' ? 'department' : pr.project_label ? 'machine_project' : ''))
        }
        setRequiredDate(pr.required_date || '')
        setPriority(normalizePriority(pr.priority))
        setRemarks(pr.remarks || '')
        setItems(pr.items.length ? pr.items.map((it) => {
          // A line with no item code is a manual (typed) one: name + details back into their own boxes.
          const manual = !it.store_item_id && !!it.item_name
          const { name, spec } = manual ? splitManualName(it.item_name) : { name: '', spec: '' }
          return {
            ...emptyItem(), id: it.id, store_item_id: it.store_item_id ?? null, make: it.make || '',
            quantity: it.quantity, project_inhouse: it.project_inhouse || '', ship_to: it.ship_to || '',
            order_project_id: it.order_project_id ?? null, order_project_element_id: it.order_project_element_id ?? null,
            ...(manual ? { manual: true, item_name: name, specification: spec, unit: it.unit || '', part_code: it.part_code || '' } : {}),
          }
        }) : [emptyItem()])
        // Manual lines keep their category in the line filter (the type follows from it).
        setLineFilters(pr.items.length ? pr.items.map((it) => ({ type: '', category: !it.store_item_id && it.item_name ? it.category || '' : '' })) : [{ type: '', category: '' }])
      } catch (err) {
        setError(extractErrorMessages(err, 'Could not load the requisition to edit.'))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, editId, metaLoaded])

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

  // Free stock of the picked items, per store (owner, 2026-10-27): the requester
  // sees before raising the PR whether the store already has it, and where.
  const [stock, setStock] = useState<Record<number, PrStockAvailability | 'error'>>({})
  const pickedIds = [...new Set(items.map((i) => i.store_item_id).filter((v): v is number => !!v))].sort((a, b) => a - b).join(',')
  useEffect(() => {
    const missing = pickedIds ? pickedIds.split(',').map(Number).filter((id) => !(id in stock)) : []
    if (!missing.length) return
    let cancelled = false
    p2pApi.stockAvailability(missing)
      .then((rows) => { if (!cancelled) setStock((prev) => ({ ...prev, ...Object.fromEntries(rows.map((r) => [r.store_item_id, r])) })) })
      .catch(() => { if (!cancelled) setStock((prev) => ({ ...prev, ...Object.fromEntries(missing.map((id) => [id, 'error' as const])) })) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedIds])

  // Lines whose picked item is of a type this purpose doesn't buy.
  const typeMismatches = allowedTypes
    ? items.flatMap((it, idx) => {
        const m = it.store_item_id ? masterById.get(it.store_item_id) : undefined
        if (!m && !it.store_item_id) {
          const t = manualType(idx)
          return t && !typeFits(t) ? [`Line ${idx + 1} (${it.item_name}, ${typeLabel(t).toLowerCase()})`] : []
        }
        return m && !typeFits(m.item_type) ? [`Line ${idx + 1} (${m.item_code} ${m.item_name}, ${typeLabel(m.item_type || '').toLowerCase()})`] : []
      })
    : []
  // A new requisition (or a draft) is held to the purpose's rules on submit;
  // one already submitted is not re-checked by the server.
  const rulesApply = !editing || editing.status === 'draft'

  const pickItem = (idx: number, value: string) => {
    const m = masterById.get(Number(value))
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, store_item_id: m ? m.id : null, manual: false } : it)))
  }
  // "Not in the list": the line becomes a typed one (the search text pre-fills the name).
  const startManual = (idx: number, typed: string) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, store_item_id: null, manual: true, item_name: typed.trim(), specification: '', unit: '', make: '', part_code: '' } : it)))

  // A new purpose resets the charge to what that purpose takes.
  const pickPurpose = (value: string) => {
    setPurpose(value)
    const pm = purposes.find((p) => p.code === value)
    // Project and Service pick from different machines (in build vs delivered), so a switch clears the pick.
    if (value !== purpose) setProjectId('')
    // Charged To is hidden for now (owner 2026-10-28): a new purpose clears any charge.
    setAcctKind('')
    setAcctId('')
    // Lines carry no project choice: Inhouse purposes mark every line Inhouse, the rest are for the header's project.
    setItems((prev) => prev.map((it) => ({ ...it, project_inhouse: pm?.line_project_mode === 'inhouse' ? 'Inhouse' : 'Project', order_project_id: null, order_project_element_id: null })))
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
    setLineFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  // asDraft: keep it as a private draft — lines without an item picked yet
  // are left out. Submit checks everything.
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
      const bad = items.findIndex((it) => it.store_item_id && !(Number(it.quantity) > 0))
      if (bad >= 0) { fail(`Line ${bad + 1}: quantity must be more than 0.`, `pr-line-${bad + 1}-qty`); return }
    } else {
    if (!rule) { fail('Choose the purpose of this requisition: what is it being bought for?', 'pr-field-purpose'); return }
    if ((purpose === 'machine_project' || purpose === 'customer_order') && !projectId.trim()) { fail('Type the project this requisition is for (e.g. PEW-17A).', 'pr-field-project'); return }
    if (isProjectPurpose && !projectHeadId) { fail('Pick the Project Head — the person who approves requisitions for this project.', 'pr-field-project-head'); return }
    if (purpose === 'development' && !(acctKind === 'rnd_project' && acctId)) { fail('Pick the R&D project this development is for. If it is not listed, create it in R&D › Prototype / Research first.', 'pr-field-rnd-project'); return }
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const m = it.store_item_id ? masterById.get(it.store_item_id) : undefined
      if (!m && !it.store_item_id) {
        const name = (it.item_name || '').trim()
        const spec = (it.specification || '').trim()
        if (!(lineFilters[i]?.category || '').trim()) { fail(`Line ${i + 1}: type the category (e.g. Hydraulics, Electrical) — it decides which buyer gets this line.`, `pr-line-${i + 1}-item`); return }
        if (!name) { fail(`Line ${i + 1}: type the item name.`, `pr-line-${i + 1}-item`); return }
        if (!it.unit) { fail(`Line ${i + 1} (${name}): type the unit (UOM) — NOS, KG, MTR…`, `pr-line-${i + 1}-item`); return }
        const full = spec ? `${name}${MANUAL_SEP}${spec}` : name
        if (full.length > 255) { fail(`Line ${i + 1} (${name}): the name and technical details together are ${full.length} characters — keep them within 255, and attach a specification file for the rest.`, `pr-line-${i + 1}-item`); return }
        if (!(Number(it.quantity) > 0)) { fail(`Line ${i + 1} (${name}): quantity must be more than 0.`, `pr-line-${i + 1}-qty`); return }
        continue
      }
      if (!m) {
        fail(`Line ${i + 1}: pick the item from the Item Master, or choose "Not in the list — type it by hand" at the bottom of the item list.`, `pr-line-${i + 1}-item`)
        return
      }
      if (!(Number(it.quantity) > 0)) {
        fail(`Line ${i + 1} (${m.item_code} ${m.item_name}): quantity must be more than 0.`, `pr-line-${i + 1}-qty`)
        return
      }
    }
    // The same rules the server enforces on a new requisition / draft — shown here so the fix is on the form.
    if (rulesApply && purposeMeta) {
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
        project_label: (purpose === 'machine_project' || purpose === 'customer_order') ? projectId.trim() : null,
        project_head_id: isProjectPurpose && projectHeadId ? Number(projectHeadId) : null,
        account_assignment: acctKind || null,
        ...Object.fromEntries(ACCOUNT_ASSIGNMENTS.map((x) => [x.fk, x.value === acctKind && acctId ? Number(acctId) : null])),
        required_date: requiredDate || undefined,
        priority,
        remarks: remarks || undefined,
        items: items.map((it, idx) => ({ it, idx }))
          .filter(({ it }) => !asDraft || it.store_item_id || ((it.item_name || '').trim()))
          .map(({ it, idx }) => ({
          id: it.id || undefined,
          store_item_id: it.store_item_id,
          // Manual (typed) line: what the requester typed; the server checks it (item_link.manual_line).
          ...(!it.store_item_id ? {
            item_name: (it.item_name || '').trim(), specification: (it.specification || '').trim() || undefined,
            item_type: manualType(idx) || undefined, category: (lineFilters[idx]?.category || '').trim(),
            unit: it.unit, make: (it.make || '').trim() || undefined, part_code: (it.part_code || '').trim() || undefined,
          } : {}),
          quantity: Number(it.quantity),
          project_inhouse: rule?.inhouseOnly ? 'Inhouse' : 'Project', // no per-line choice; the server applies the purpose's rule
          ship_to: it.ship_to || undefined,
          order_project_element_id: it.order_project_element_id || null,
        })),
      }
      const pr = editing ? await p2pApi.edit(editing.id, payload) : await p2pApi.create(payload)
      draft.clear()

      // The PR is already created — an upload failure mustn't undo that, but
      // the requester must be told which files didn't make it and why.
      let failedCount = 0
      const failReasons: string[] = []
      // Per-line files: an edited line keeps its id; new lines are matched to the
      // saved lines not seen before, in the order they were sent (ids ascend).
      if (lineFiles.some((f) => f?.length)) {
        const keptIds = new Set(items.map((it) => it.id).filter(Boolean))
        const newIds = ((pr as P2PRequest).items || []).map((x: { id: number }) => x.id).filter((id: number) => !keptIds.has(id)).sort((a: number, b: number) => a - b)
        let n = 0
        for (let idx = 0; idx < items.length; idx++) {
          const it = items[idx]
          const sent = !asDraft || !!it.store_item_id || !!(it.item_name || '').trim()
          if (!sent) continue
          const lineId = it.id || newIds[n++]
          const files = lineFiles[idx] || []
          if (!files.length) continue
          try {
            if (!lineId) throw new Error(`Line ${idx + 1} was not found on the saved requisition.`)
            await p2pApi.uploadAttachments(pr.id, files, 'specification', lineId)
          } catch (err) {
            failedCount += files.length
            failReasons.push(...extractErrorMessages(err, `Upload of line ${idx + 1}'s file(s) failed.`))
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
  // The page follows its own tick (2026-11-14): Create on Purchase Requisitions (Edit too when editing one).
  if (!(can('p2p', 'purchase_requisitions', 'create') || (editRef && can('p2p', 'purchase_requisitions', 'edit')))) {
    return (<div><P2PNav /><p role="alert" style={{ fontSize: 13, color: '#b91c1c' }}>You don&apos;t have &apos;Create&apos; permission on Procurement › Purchase Requisitions, so you can&apos;t raise a requisition. Ask an admin to add it to your role in Organization › Role &amp; Permissions.</p></div>)
  }

  const inApproval = !!editing && (editing.status === 'submitted' || editing.status === 'approved')
  const heading = !editing ? 'New Purchase Requisition'
    : editing.status === 'draft' ? `Edit Draft ${editing.p2p_number}` : `Edit Purchase Requisition ${editing.p2p_number}`

  const subtitle = !editing ? 'Ask for items from the Item Master — approved requisitions go to stock check, then RFQ and PO.'
    : `${editing.category_code !== 'ITM' ? `${editing.category_label || editing.category_code} · ` : ''}status ${editing.status.replace(/_/g, ' ')}`

  // The server marks each purpose allowed / not for this user (/p2p/requests/meta `allowed`); a saved requisition keeps its own purpose in the list.
  const purposeChoices = (purposes as (P2PPurposeMeta & { allowed?: boolean })[]).filter((p) => p.allowed !== false || (!!editing && p.code === editing.purpose))
  // Priority: the role's allowed values, plus the value a saved requisition already holds.
  const priorityChoices = vis.options('priority', PRIORITY_OPTIONS, (o) => o.value)
  const currentPriority = PRIORITY_OPTIONS.find((o) => o.value === priority)
  const priorityOptions = editing && editing.priority === priority && currentPriority && !priorityChoices.some((o) => o.value === priority)
    ? [...priorityChoices, currentPriority] : priorityChoices
  // Layout only: a divider belongs between two columns that both show (the preview draws every section).
  const showRequestDetails = vis.preview || vis.showSection('request_details')
  const showRemarks = vis.preview || vis.showSection('remarks')
  // Item table columns the roles may hide: header (VisTh) and cells (VisTd) use the same key so they stay aligned.
  const ITEM_COL_KEYS: Record<string, string> = { Make: 'make', 'Part Code': 'part_code', UOM: 'uom', 'In Stock': 'in_stock', 'Ship To': 'ship_to' }
  // Role editor preview: nothing is saved and the page chrome (module nav, Back) is left out.
  const previewBlock = vis.preview

  return (
    <FormPage fill nav={previewBlock ? undefined : <P2PNav />} icon={editing ? 'edit' : 'cart'} title={heading} subtitle={subtitle} onBack={previewBlock ? undefined : () => router.back()} backTour="pr-new-back"
      footer={<>
        <button data-tour="pr-new-cancel" onClick={() => router.back()} type="button" style={sheetBtn('secondary', SHEET.INK)}>Cancel</button>
        <button data-tour="pr-new-save-draft" onClick={() => handleSubmit(true)} disabled={!!submitting || previewBlock} type="button" style={sheetBtn('secondary', SHEET.INK, !!submitting)}>
          <SheetIcon name="doc" size={16} />{submitting === 'draft' ? 'Saving…' : 'Save as Draft'}
        </button>
        <button data-tour="pr-new-submit" onClick={() => handleSubmit(false)} disabled={!!submitting || previewBlock} type="button" style={sheetBtn('primary', SHEET.BLUE, !!submitting)}>
          <SheetIcon name="send" size={16} />{submitting === 'submit' ? 'Submitting…' : editing && editing.status !== 'draft' ? 'Save & Submit for Approval' : 'Submit Purchase Requisition'}
        </button>
      </>}>
      <MessageDialog open={!!error} variant="error" title="Cannot Save Request" message={error} onClose={closeError} />
      {draft.restored && <div style={{ padding: '16px 24px 0' }}><DraftBanner draft={draft} style={{ marginBottom: 0 }} /></div>}
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
        <VisSection vis={vis} k="purpose_charging" frame={{ minWidth: 0, padding: '20px 24px', borderRight: showRequestDetails ? `1px solid ${SHEET.LINE}` : undefined }}>
          <SheetSection icon="building" title="Purpose & Charging">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div data-tour="pr-new-purpose" style={{ minWidth: 0 }}>
                <label style={labelStyle}>Purpose <Req /></label>
                <div id="pr-field-purpose">
                  <SearchableSelect value={purpose} onChange={pickPurpose} ariaLabel="Purpose" disabled={!!metaError}
                    placeholder={metaError ? 'Purposes could not be loaded' : metaLoaded ? 'What is this being bought for?' : 'Loading purposes…'}
                    options={purposeChoices.map((p) => ({ value: p.code, label: p.label }))} />
                </div>
                <VisOptionValues vis={vis} dropdown="purpose" />
              </div>
              {/* Charged To is hidden for now (owner 2026-10-28); the Project sits beside the Purpose. */}
              {(purpose === 'machine_project' || purpose === 'customer_order') && (
                <div data-tour="pr-new-project" style={{ minWidth: 0 }}>
                  <label style={labelStyle}>Project <Req /></label>
                  <div id="pr-field-project">
                    {/* Typed by hand for now (owner, 2026-11-18): no project list. */}
                    <input aria-label="Project" style={inputStyle} maxLength={255} value={projectId}
                      onChange={(e) => setProjectId(e.target.value)} placeholder="Type the project, e.g. PEW-17A" />
                  </div>
                </div>
              )}
              {isProjectPurpose && (
                <div data-tour="pr-new-project-head" style={{ minWidth: 0 }}>
                  <label style={labelStyle}>Project Head <Req /></label>
                  <div id="pr-field-project-head">
                    <SearchableSelect
                      value={projectHeadId}
                      onChange={setProjectHeadId}
                      ariaLabel="Project Head"
                      disabled={!!projectHeadError || (projectHeads !== null && projectHeads.length === 0)}
                      options={(projectHeads || []).map((u) => ({ value: String(u.id), label: u.name, description: [u.designation, u.department].filter(Boolean).join(' · ') || undefined }))}
                      placeholder={projectHeadError ? 'Project Heads could not be loaded' : !projectHeads ? 'Loading Project Heads…' : projectHeads.length ? 'Search Project Head…' : 'No active users found'}
                    />
                  </div>
                  {projectHeadError && <p role="alert" style={{ ...sheetHint, color: '#B91C1C' }}>{projectHeadError} Reload the page to try again.</p>}
                  
                  {projectHeadId && <p style={sheetHint}>This requisition goes to them for approval, with a notification.</p>}
                </div>
              )}
              {purpose === 'development' && (
                <div style={{ minWidth: 0 }}>
                  <label style={labelStyle}>R&amp;D project <Req /></label>
                  <div id="pr-field-rnd-project">
                    <SearchableSelect
                      value={acctKind === 'rnd_project' ? acctId : ''}
                      onChange={(v) => { setAcctKind(v ? 'rnd_project' : ''); setAcctId(v) }}
                      ariaLabel="R&D project"
                      disabled={!!rndError || (rndProjects !== null && rndProjects.length === 0)}
                      options={(rndProjects || []).map((p) => ({ value: String(p.id), label: p.label }))}
                      placeholder={rndError ? 'R&D projects could not be loaded' : !rndProjects ? 'Loading R&D projects…' : rndProjects.length ? 'Search R&D project…' : 'No open R&D projects'}
                    />
                  </div>
                  {rndError && <p role="alert" style={{ ...sheetHint, color: '#B91C1C' }}>{rndError} Reload the page to try again.</p>}
                  {rndProjects && rndProjects.length === 0 && <p style={sheetHint}>No open R&amp;D project found. Create the prototype / research project in R&amp;D first; handed-over, closed and cancelled projects are not listed.</p>}
                </div>
              )}
            </div>
            {metaError && <p role="alert" style={{ ...sheetHint, color: '#B91C1C' }}>{metaError} Reload the page to try again.</p>}
            {rule && <p data-tour="pr-new-purpose-hint" style={sheetHint}>{rule.hint}</p>}
          </SheetSection>
        </VisSection>
        <VisSection vis={vis} k="request_details" frame={{ minWidth: 0, padding: '20px 24px', background: '#fcfcfd' }}>
          <SheetSection icon="list" title="Request Details">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <label style={labelStyle}>Required Date</label>
                <div data-tour="pr-new-required-date"><DateField value={requiredDate} onChange={setRequiredDate} /></div>
              </div>
              <div style={{ minWidth: 0 }}>
                <label style={labelStyle}>Priority</label>
                <div data-tour="pr-new-priority">
                  <SearchableSelect value={priority} onChange={setPriority} ariaLabel="Priority" placeholder="Priority"
                    options={priorityOptions} />
                </div>
                <VisOptionValues vis={vis} dropdown="priority" />
              </div>
            </div>
          </SheetSection>
        </VisSection>
      </div>

      <VisSection vis={vis} k="item_details" frame={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
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
          {/* Many lines scroll inside the table (owner, 2026-11-18); the header row stays on top. */}
          <div style={{ overflow: 'auto', maxHeight: 'max(220px, calc(100vh - 500px))', border: `1px solid ${SHEET.LINE}`, borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
              <thead>
                <tr>
                  {['SL', 'Item *', 'Make', 'Part Code', 'UOM', 'Qty *', 'Ship To', 'Files', 'Actions'].map((h, i) => ITEM_COL_KEYS[h] ? (
                    <VisTh key={h} vis={vis} table="form_items" k={ITEM_COL_KEYS[h]} style={th}>{h}</VisTh>
                  ) : (
                    <th key={h} style={th}>{h === 'Actions' ? <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>Actions</span> : h}{i === 0 && <RowCount count={items.length} />}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const m = item.store_item_id ? masterById.get(item.store_item_id) : undefined
                  const f = lineFilters[idx] || { type: '', category: '' }
                  // A line that already holds an item shows that item's type / category.
                  const lineType = effectiveType(f.type) || (m?.item_type && itemTypeOptions.includes(m.item_type) ? m.item_type : '')
                  const lineCategory = f.category || (m && m.item_type === lineType ? m.category || '' : '')
                  const lineCats = categoriesForType(lineType)
                  // Rule (owner, 2026-10-27): pick the type, then the category, then search the item.
                  const categoryReady = !!lineType
                  const itemReady = !!item.store_item_id || (categoryReady && (!!lineCategory || lineCats.length === 0))
                  const query = (f.q || '').trim().toLowerCase()
                  // Only items of the purpose's types (or the line's type pick); keep
                  // the picked item in the list even if it falls outside the filters.
                  const shown = masterItems.filter((i) =>
                    i.id === item.store_item_id
                    || ((lineType ? i.item_type === lineType : typeFits(i.item_type)) && (!lineCategory || i.category === lineCategory)
                      && (!query || matchesAllWords([i.item_code, i.item_name, i.category, ...(i.unit_names || []).map((u) => u.name), i.part_number, i.manufacturer_part_number, i.make, i.description, i.specification]
                        .filter(Boolean).join(' '), query))))
                  return (
                  <tr key={idx} style={{ borderTop: idx ? `1px solid ${SHEET.LINE}` : undefined, verticalAlign: 'top' }}>
                    <td style={{ padding: '14px 8px 6px', fontSize: 12.5, fontWeight: 600, color: SHEET.MUTED }}>{idx + 1}</td>
                    <td data-tour="pr-new-item-name" style={{ padding: '6px 8px', minWidth: 460 }}>
                      {/* Type, category and item on one line (owner, 2026-10-27). */}
                      {!item.store_item_id ? (() => {
                        // Typed by hand (owner, 2026-11-18: for now no Item Type and no Item Master list on the PR):
                        // category + item name are typed; Store gives the item a code on the GRN.
                        return (
                          <div data-tour="pr-new-item-manual" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            {/* Fixed two-line boxes (owner, 2026-11-18): long text wraps onto the 2nd line instead of scrolling out of view. */}
                            <div title="Category" style={{ flex: '0 0 130px', minWidth: 0 }}>
                              <GrowBox aria-label={`Category, line ${idx + 1}`} maxLength={100}
                                value={f.category} placeholder="1. Category *"
                                onChange={(e) => setLineFilter(idx, { category: oneLine(e.target.value) })} />
                            </div>
                            <div id={`pr-line-${idx + 1}-item`} style={{ flex: '1 1 180px', minWidth: 0 }}>
                              <GrowBox aria-label={`Item name, line ${idx + 1}`} maxLength={200}
                                value={item.item_name || ''} placeholder="2. Item name *"
                                onChange={(e) => updateItem(idx, 'item_name', e.target.value)} />
                            </div>
                            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                              <GrowBox data-tour="pr-new-item-spec" aria-label={`Technical details, line ${idx + 1}`} maxLength={250}
                                value={item.specification || ''} placeholder="Technical details" title="Size, grade, rating…"
                                onChange={(e) => updateItem(idx, 'specification', e.target.value)} />
                            </div>
                          </div>
                        )
                      })() : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <div title="Item Type" style={{ flex: '0 0 150px', minWidth: 0 }}>
                          <SearchableSelect
                            ariaLabel={`Item type, line ${idx + 1}`}
                            value={lineType}
                            onChange={(type) => setLineFilter(idx, { type, category: categoriesForType(type).includes(f.category) ? f.category : '', q: '' })}
                            options={itemTypeOptions.map((t) => ({ value: t, label: typeLabel(t) }))}
                            placeholder="1. Item type"
                          />
                        </div>
                        <div title="Category" style={{ flex: '0 0 160px', minWidth: 0 }}>
                          <SearchableSelect
                            ariaLabel={`Category filter, line ${idx + 1}`}
                            value={lineCategory}
                            onChange={(category) => setLineFilter(idx, { category, q: '' })}
                            options={lineCats.map((c) => ({ value: c, label: c }))}
                            disabled={!categoryReady}
                            placeholder={categoryReady ? (lineCats.length ? '2. Category' : 'No categories') : 'Pick the type first'}
                          />
                        </div>
                        <div id={`pr-line-${idx + 1}-item`} style={{ flex: '1 1 180px', minWidth: 0 }}>
                          <SearchableSelect
                            ariaLabel={`Item, line ${idx + 1}`}
                            value={item.store_item_id ? String(item.store_item_id) : ''}
                            onChange={(v) => pickItem(idx, v)}
                            onSearch={(q) => setLineFilter(idx, { q })}
                            searchable
                            disabled={!itemReady}
                            options={shown.slice(0, 200).map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}`, description: itemOptionDetail(i) }))}
                            onAdd={(q) => startManual(idx, q)}
                            addLabel="Not in the list — type it by hand"
                            placeholder={loadingMaster ? 'Loading items…' : !itemReady ? (categoryReady ? 'Pick the category first' : 'Pick the type first')
                              : `3. Search ${shown.length} item${shown.length === 1 ? '' : 's'} by code, name, part no. or technical details…`}
                          />
                        </div>
                        {/* Technical details of the picked item (Item Master › Technical Specification), read-only, same row. */}
                        {(() => {
                          const spec = m ? [m.description, m.specification].filter(Boolean).join(' · ') : ''
                          return (
                            <div title={spec || undefined} style={{ flex: '1 1 160px', minWidth: 0 }}>
                              <input data-tour="pr-new-item-spec" readOnly tabIndex={-1} aria-label={`Technical details, line ${idx + 1}`}
                                value={spec} placeholder={m ? 'No technical details' : 'Technical details'}
                                style={{ ...inputStyle, background: '#f8fafc', color: SHEET.BODY, cursor: 'default', textOverflow: 'ellipsis' }} />
                            </div>
                          )
                        })()}
                      </div>
                      )}
                    </td>
                    {!item.store_item_id ? (<>
                      <VisTd vis={vis} table="form_items" k="make" data-tour="pr-new-item-make" style={{ padding: '6px 8px', width: 108 }}>
                        <input aria-label={`Make, line ${idx + 1}`} style={{ ...inputStyle, width: 96 }} maxLength={100} value={item.make || ''} placeholder="Make"
                          onChange={(e) => updateItem(idx, 'make', e.target.value)} />
                      </VisTd>
                      <VisTd vis={vis} table="form_items" k="part_code" data-tour="pr-new-item-partcode" style={{ padding: '6px 8px', width: 108 }}>
                        <input aria-label={`Part code, line ${idx + 1}`} style={{ ...inputStyle, width: 96 }} maxLength={100} value={item.part_code || ''} placeholder="Part code"
                          onChange={(e) => updateItem(idx, 'part_code', e.target.value)} />
                      </VisTd>
                      <VisTd vis={vis} table="form_items" k="uom" data-tour="pr-new-item-unit" style={{ padding: '6px 8px', width: 110 }}>
                        <div style={{ width: 100 }}>
                          {/* Typed by hand for now (owner, 2026-11-18). */}
                          <input aria-label={`Unit, line ${idx + 1}`} style={inputStyle} maxLength={20} value={item.unit || ''} placeholder="UOM *"
                            onChange={(e) => updateItem(idx, 'unit', e.target.value.toUpperCase())} />
                        </div>
                      </VisTd>
                    </>) : (<>
                    <VisTd vis={vis} table="form_items" k="make" data-tour="pr-new-item-make" style={readCell}>{m?.make || '—'}</VisTd>
                    <VisTd vis={vis} table="form_items" k="part_code" data-tour="pr-new-item-partcode" style={readCell}>{m?.part_number || m?.manufacturer_part_number || '—'}</VisTd>
                    <VisTd vis={vis} table="form_items" k="uom" data-tour="pr-new-item-unit" style={readCell}>{m?.uom || '—'}</VisTd>
                    </>)}
                    {/* In Stock hidden for now (owner, 2026-11-18): PR lines are typed by hand, no Item Master item to check. */}
                    <td style={{ padding: '6px 8px', width: 96 }}>
                      <input data-tour="pr-new-item-qty" id={`pr-line-${idx + 1}-qty`} aria-label={`Quantity, line ${idx + 1}`} type="number" min={0} step="any" style={{ ...inputStyle, width: 88 }} value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} />
                    </td>
                    <VisTd vis={vis} table="form_items" k="ship_to" data-tour="pr-new-item-shipto" style={{ padding: '6px 8px', minWidth: 170 }}>
                      {(() => {
                        const plant = plants.find((b) => plantLabel(b) === item.ship_to)
                        const custom = f.custom || (!!item.ship_to && !plant)
                        return (
                          // Custom address (owner, 2026-11-18): the same box turns into the address field,
                          // with a list button to go back to the plants.
                          custom ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <GrowBox aria-label={`Ship to address, line ${idx + 1}`} value={item.ship_to} placeholder="Type the delivery address" autoFocus={!item.ship_to}
                                onChange={(e) => updateItem(idx, 'ship_to', e.target.value)} />
                              <button type="button" title="Pick a plant instead" aria-label={`Pick a plant for line ${idx + 1} instead`}
                                onClick={() => { setLineFilter(idx, { custom: false }); updateItem(idx, 'ship_to', '') }}
                                style={{ ...sheetBtn('secondary', SHEET.INK), padding: 0, width: 34, minWidth: 34, justifyContent: 'center', flex: 'none' }}>
                                <SheetIcon name="building" size={14} />
                              </button>
                            </div>
                          ) : (
                            <SearchableSelect
                              ariaLabel={`Ship to, line ${idx + 1}`}
                              value={plant ? String(plant.id) : ''}
                              onChange={(v) => {
                                if (v === '__custom') { setLineFilter(idx, { custom: true }); updateItem(idx, 'ship_to', ''); return }
                                const b = plants.find((x) => String(x.id) === v)
                                setLineFilter(idx, { custom: false })
                                updateItem(idx, 'ship_to', b ? plantLabel(b) : '')
                              }}
                              options={[...plants.map((b) => ({ value: String(b.id), label: plantLabel(b), group: 'Plant / branch' })),
                                { value: '__custom', label: 'Custom address…', group: 'Other' }]}
                              placeholder="Plant or custom address"
                            />
                          )
                        )
                      })()}
                    </VisTd>
                    <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                      <LineFiles line={idx + 1} files={lineFiles[idx] || []}
                        onChange={(fs) => setLineFiles((prev) => { const next = [...prev]; while (next.length <= idx) next.push([]); next[idx] = fs; return next })} />
                    </td>
                    {/* Remove: a trash icon at the row's right end (owner, 2026-11-18). */}
                    <td style={{ padding: '6px 8px', width: 50 }}>
                      {items.length > 1 && (
                        <button type="button" data-tour="pr-new-item-remove" aria-label={`Remove line ${idx + 1}`} title="Remove this line" onClick={() => removeItem(idx)}
                          style={{ ...sheetBtn('secondary', '#dc2626'), padding: 0, width: 34, minWidth: 34, justifyContent: 'center' }}>
                          <SheetIcon name="trash" size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p data-tour="pr-new-item-master-hint" style={sheetHint}>
            Type each item&apos;s category and name. Store gives the item a code when the goods arrive (GRN).
          </p>
        </SheetSection>
      </VisSection>

      {vis.anySection(['remarks']) && <div style={{ borderTop: `1px solid ${SHEET.LINE}` }}>
        <VisSection vis={vis} k="remarks" frame={{ minWidth: 0, padding: '20px 24px' }}>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea data-tour="pr-new-remarks" aria-label="Remarks" style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)}
              placeholder="Why it is needed, references, anything the buyer should know…" />
          </SheetSection>
        </VisSection>
      </div>}
    </FormPage>
  )
}
