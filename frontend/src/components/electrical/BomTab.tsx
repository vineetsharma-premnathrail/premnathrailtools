'use client'

import Select from '@/components/shared/Select'
// Electrical BOM tab — one list that carries four scope stages: the BOM
// itself, Component Selection (make + part number), Component Specification
// (rating + spec text) and Purchase Requirement (procurement status + the
// P2P purchase requisition the line is bought on).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { electricalApi } from '@/lib/api'
import { useRecordId } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { useAuth } from '@/hooks/useAuth'
import { TEXT } from '@/lib/theme'
import { SheetColumns, SheetSection, sheetInput, sheetLabel, sheetHint, Req } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import {
  ElectricalBomItem, ElectricalJobDetail, ElectricalLookupOption, ElectricalMeta, ElectricalPanel,
} from '@/types'
import {
  sectionStyle, sectionTitle, thStyle, tdStyle, primaryBtn, smallBtn, smallDangerBtn, linkStyle,
  tableWrap, Pill, ErrorBanner, NoticeBanner, Modal, ModalFooter, F, rowStyle,
  SELECTION_LABELS, SELECTION_HEX, PROCUREMENT_LABELS, PROCUREMENT_HEX, numOrNull, strOrNull, useJobFeatures,
} from './shared'

type Msg = string | string[]
type BomForm = {
  category: string; description: string; store_item_id: string; make: string; part_number: string
  rating: string; specification: string; quantity: string; uom: string; estimated_unit_cost: string
  panel_id: string; selection_status: string; procurement_status: string; remarks: string
}

// Panels feed the Panel picker; skipped for a role without the job's Panels feature.
const fetchBom = (jobId: number, withPanels: boolean) =>
  Promise.all([electricalApi.listBom(jobId), withPanels ? electricalApi.listPanels(jobId) : Promise.resolve([])]) as Promise<[ElectricalBomItem[], ElectricalPanel[]]>

const fmtQty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 })
const fmtMoney = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const small: React.CSSProperties = { fontSize: 11, color: TEXT.muted, marginTop: 2 }
// Pending central approval request of a line's component selection (Organization › Approval Workflows).
const approvalRequestId = (i: ElectricalBomItem) => (i as ElectricalBomItem & { approval_request_id?: number | null }).approval_request_id ?? null

export default function BomTab({ job, meta, canEdit, onChanged }: { job: ElectricalJobDetail; meta: ElectricalMeta; canEdit: boolean; onChanged: () => void }) {
  const router = useRouter()
  const { user } = useAuth()
  const canRaisePr = !!user?.apps?.includes('p2p')
  // Electrical › RRV Electrical Jobs › BOM / BOM costs (canEdit = job open + BOM edit).
  const { jf, sees } = useJobFeatures()
  const isOpen = ['draft', 'in_progress', 'handed_over'].includes(job.status)
  const canSubmit = jf('bom', 'submit')
  const canApprove = jf('bom', 'approve')
  const canAdd = isOpen && jf('bom', 'create')
  const canRemove = isOpen && jf('bom', 'delete')
  const seeCosts = sees('costs')
  const seePanels = sees('panels')
  // ?focus=<line id> (from an approval link) opens that line's approval.
  const { id: focusId } = useRecordId(useSearchParams().get('focus'))
  const [reviewing, setReviewing] = useState<ElectricalBomItem | null>(null)

  const [items, setItems] = useState<ElectricalBomItem[]>([])
  const [panels, setPanels] = useState<ElectricalPanel[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<Msg>('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // Add / edit modal
  const categoryKeys = Object.keys(meta.component_categories || {})
  const defaultCategory = categoryKeys.includes('other') ? 'other' : (categoryKeys[0] || 'other')
  const blankForm = (): BomForm => ({
    category: defaultCategory, description: '', store_item_id: '', make: '', part_number: '', rating: '',
    specification: '', quantity: '1', uom: 'NOS', estimated_unit_cost: '', panel_id: '',
    selection_status: 'proposed', procurement_status: 'required', remarks: '',
  })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ElectricalBomItem | null>(null)
  const [form, setForm] = useState<BomForm>(blankForm)
  const [formError, setFormError] = useState<Msg>('')
  const [storeItems, setStoreItems] = useState<ElectricalLookupOption[] | null>(null)

  // Row actions
  const [deleting, setDeleting] = useState<ElectricalBomItem | null>(null)
  const [unlinking, setUnlinking] = useState<ElectricalBomItem | null>(null)
  const [linking, setLinking] = useState<ElectricalBomItem | null>(null)
  const [prOptions, setPrOptions] = useState<ElectricalLookupOption[]>([])
  const [prChoice, setPrChoice] = useState('')
  const [linkError, setLinkError] = useState<Msg>('')
  // Server-side search for the pickers — the lookups return only the first
  // 500 Store items / newest 100 PRs, so typing here reaches the rest.
  const [storeSearch, setStoreSearch] = useState('')
  const [prSearch, setPrSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchBom(job.id, seePanels)
      .then(([b, p]) => {
        if (cancelled) return
        setItems(b)
        setPanels(p)
        const hit = focusId ? b.find((i) => i.id === focusId) : undefined
        if (hit) setReviewing(hit)
      })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, `Could not load the electrical BOM for ${job.job_number}.`)) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [job.id, job.job_number, focusId, seePanels])

  const reload = useCallback(async () => {
    try {
      const [b, p] = await fetchBom(job.id, seePanels)
      setItems(b)
      setPanels(p)
    } catch (err) {
      setError(extractErrorMessages(err, `Could not reload the electrical BOM for ${job.job_number}.`))
    }
  }, [job.id, job.job_number, seePanels])

  /** Runs a mutation, then reloads the list and tells the parent to re-fetch the job. */
  const mutate = async (fn: () => Promise<unknown>, fallback: string, opts: { success?: string; onError?: (m: Msg) => void } = {}) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await fn()
      await reload()
      onChanged()
      if (opts.success) setNotice(opts.success)
      return true
    } catch (err) {
      const msg = extractErrorMessages(err, fallback)
      if (opts.onError) opts.onError(msg)
      else setError(msg)
      return false
    } finally {
      setBusy(false)
    }
  }

  const stats = useMemo(() => ({
    toBuy: items.filter((i) => i.procurement_status === 'required').length,
    cost: items.reduce((sum, i) => sum + (i.quantity || 0) * (i.estimated_unit_cost || 0), 0),
  }), [items])

  const set = (k: keyof BomForm, v: string) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!formOpen) return
    let cancelled = false
    const q = storeSearch.trim()
    const t = setTimeout(() => {
      electricalApi.lookupItems(q || undefined)
        .then((rows: ElectricalLookupOption[]) => { if (!cancelled) setStoreItems(rows) })
        .catch((err) => {
          if (cancelled) return
          setStoreItems([])
          setFormError(extractErrorMessages(err, q
            ? `Could not search Store items for "${q}". Try a different search, or add the line without linking a Store item.`
            : 'Could not load Store items for the item picker. You can still add the line without linking a Store item.'))
        })
    }, q ? 300 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [formOpen, storeSearch])

  const linkingId = linking?.id
  useEffect(() => {
    if (!linkingId) return
    let cancelled = false
    const q = prSearch.trim()
    const t = setTimeout(() => {
      electricalApi.lookupPurchaseRequisitions(q || undefined)
        .then((rows: ElectricalLookupOption[]) => { if (!cancelled) setPrOptions(rows) })
        .catch((err) => {
          if (!cancelled) setLinkError(extractErrorMessages(err, q
            ? `Could not search purchase requisitions for "${q}". Check the PR number and try again.`
            : 'Could not load purchase requisitions from Procurement. Type the PR number in the search box to try again.'))
        })
    }, q ? 300 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [linkingId, prSearch])

  const openAdd = () => {
    setEditing(null)
    setForm(blankForm())
    setFormError('')
    setStoreSearch('')
    setFormOpen(true)
  }

  const openEdit = (i: ElectricalBomItem) => {
    setEditing(i)
    setForm({
      category: i.category, description: i.description, store_item_id: i.store_item_id ? String(i.store_item_id) : '',
      make: i.make || '', part_number: i.part_number || '', rating: i.rating || '', specification: i.specification || '',
      quantity: String(i.quantity), uom: i.uom || 'NOS',
      estimated_unit_cost: i.estimated_unit_cost == null ? '' : String(i.estimated_unit_cost),
      panel_id: i.panel_id ? String(i.panel_id) : '', selection_status: i.selection_status,
      procurement_status: i.procurement_status, remarks: i.remarks || '',
    })
    setFormError('')
    setStoreSearch('')
    setFormOpen(true)
  }

  const storeOptions = useMemo(() => {
    const opts = [{ value: '', label: '— Not a Store item —' }, ...(storeItems || []).map((r) => ({ value: String(r.id), label: r.label }))]
    // Keep the current link visible even when it isn't in the current lookup rows.
    if (form.store_item_id && !opts.some((o) => o.value === form.store_item_id)) {
      opts.push({ value: form.store_item_id, label: editing?.store_item_code || `Store item #${form.store_item_id}` })
    }
    return opts
  }, [storeItems, form.store_item_id, editing])

  const pickStoreItem = (v: string) => {
    const row = (storeItems || []).find((r) => String(r.id) === v)
    setForm((f) => {
      const next = { ...f, store_item_id: v }
      if (row && !f.description.trim()) {
        const parts = row.label.split(' — ')
        next.description = parts.length > 1 ? parts.slice(1).join(' — ') : row.label
      }
      if (row?.extra && (!f.uom.trim() || f.uom.trim().toUpperCase() === 'NOS')) next.uom = row.extra
      return next
    })
  }

  const save = async () => {
    setFormError('')
    const qty = Number(form.quantity)
    const problems: string[] = []
    if (!form.description.trim()) problems.push('Enter a description for the component.')
    if (!form.quantity.trim() || !Number.isFinite(qty) || qty <= 0) problems.push('Quantity must be a number greater than 0.')
    const cost = numOrNull(form.estimated_unit_cost)
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) problems.push('Estimated unit cost must be 0 or more (leave it blank if not known yet).')
    if ((form.selection_status === 'selected' || form.selection_status === 'approved') && !(form.make.trim() && form.part_number.trim())) {
      problems.push(`Enter both the make and the part number before marking the component as ${SELECTION_LABELS[form.selection_status].toLowerCase()}.`)
    }
    if (problems.length) { setFormError(problems); return }

    const payload = {
      category: form.category,
      description: form.description.trim(),
      store_item_id: form.store_item_id ? Number(form.store_item_id) : null,
      make: strOrNull(form.make),
      part_number: strOrNull(form.part_number),
      rating: strOrNull(form.rating),
      specification: strOrNull(form.specification),
      quantity: qty,
      uom: form.uom.trim() || 'NOS',
      estimated_unit_cost: cost,
      panel_id: form.panel_id ? Number(form.panel_id) : null,
      selection_status: form.selection_status,
      procurement_status: form.procurement_status,
      remarks: strOrNull(form.remarks),
    }
    const ok = await mutate(
      () => editing ? electricalApi.updateBomItem(job.id, editing.id, payload) : electricalApi.createBomItem(job.id, payload),
      editing ? `Could not save BOM line ${editing.line_no}.` : 'Could not add the component to the BOM.',
      { success: editing ? `BOM line ${editing.line_no} updated.` : `Added "${payload.description}" to the BOM.`, onError: setFormError },
    )
    if (ok) setFormOpen(false)
  }

  const openLink = (i: ElectricalBomItem) => {
    setLinking(i)
    setPrChoice('')
    setLinkError('')
    setPrOptions([])
    setPrSearch('')
  }

  const prSelectOptions = useMemo(() => {
    const opts = prOptions
      .filter((r) => !!r.code)
      .map((r) => ({ value: String(r.code), label: r.extra ? `${r.label} · ${r.extra.replace(/_/g, ' ')}` : r.label }))
    // Keep the picked PR visible after the search text changes.
    if (prChoice && !opts.some((o) => o.value === prChoice)) opts.push({ value: prChoice, label: prChoice })
    return opts
  }, [prOptions, prChoice])

  // 'PR Raised' / 'Ordered' must be backed by a linked requisition (the
  // backend enforces it). Without a PR everything except those two is
  // offered (a Store-held line can still go In Stock → Issued); once linked,
  // the purchase lifecycle statuses are. The line's current status is always
  // kept so an older line isn't silently changed.
  const linkedPr = editing?.p2p_request_id ? (editing.p2p_number || `PR #${editing.p2p_request_id}`) : null
  const procurementOptions = useMemo(() => {
    const keys = linkedPr ? ['pr_raised', 'ordered', 'received', 'issued'] : ['required', 'in_stock', 'received', 'issued']
    if (form.procurement_status && !keys.includes(form.procurement_status)) keys.push(form.procurement_status)
    return keys.filter((k) => PROCUREMENT_LABELS[k]).map((k) => [k, PROCUREMENT_LABELS[k]] as const)
  }, [linkedPr, form.procurement_status])

  const confirmLink = async () => {
    if (!linking) return
    if (!prChoice) { setLinkError('Pick the purchase requisition this line is being bought on.'); return }
    const item = linking
    const ok = await mutate(
      () => electricalApi.linkPr(job.id, item.id, prChoice),
      `Could not link ${prChoice} to BOM line ${item.line_no}.`,
      { success: `Linked ${prChoice} to BOM line ${item.line_no}.`, onError: setLinkError },
    )
    if (ok) setLinking(null)
  }

  const raisePr = (i: ElectricalBomItem) => {
    // PR lines are Item Master items: the BOM line must point at one first.
    if (!i.store_item_id) {
      setError(`BOM line ${i.line_no} isn't linked to an Item Master item, so a requisition can't be raised for it. Edit the line and pick its Store item (add the item in Store › Item Master first if it's new), then use Raise PR.`)
      return
    }
    const params = new URLSearchParams({
      store_item_id: String(i.store_item_id),
      make: i.make || '',
      quantity: String(Math.ceil(i.quantity)),
      remarks: `Electrical BOM line ${i.line_no} for ${job.job_number} (${job.title}).`,
    })
    router.push(`/dashboard/p2p/new?${params.toString()}`)
  }

  const headers = ['#', 'Category', 'Description', 'Make / Part No.', 'Qty', 'Panel', 'Selection', 'Procurement', ...(canEdit ? [''] : [])]

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <p style={{ ...sectionTitle, margin: 0 }}>Electrical BOM</p>
          <span data-tour="elec-bom-summary" style={{ fontSize: 12, color: TEXT.muted }}>
            {items.length} line{items.length === 1 ? '' : 's'}
            {' · '}<span style={{ color: stats.toBuy ? '#DC2626' : TEXT.muted, fontWeight: stats.toBuy ? 600 : 400 }}>{stats.toBuy} to buy</span>
            {seeCosts && <>{' · '}Est. cost <strong style={{ color: TEXT.heading }}>{fmtMoney(stats.cost)}</strong></>}
          </span>
        </div>
        {canAdd && <button data-tour="elec-bom-add-btn" type="button" style={primaryBtn} onClick={openAdd}>+ Add Component</button>}
      </div>
      {canEdit && (
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>
          {canRaisePr ? 'Use "Raise PR" on a To Buy line to open a pre-filled purchase requisition; once it is submitted, come back and use "Link PR" with its PR number.' : 'Once Procurement raises a purchase requisition for a line, use "Link PR" to attach its PR number.'}
          {' '}Mark a line Selected only after entering its make and part number.
        </p>
      )}
      {!canEdit && <div style={{ marginBottom: 12 }} />}

      <ErrorBanner error={error} />
      <NoticeBanner notice={notice} />

      <div data-tour="elec-bom-table" style={tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: canEdit ? 1180 : 1000 }}>
          <thead>
            <tr>{headers.map((h, idx) => <th key={`${h}-${idx}`} style={thStyle}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr><td colSpan={headers.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading BOM…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={headers.length} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>
                No components on this job&apos;s BOM yet.{canEdit ? ' Use "+ Add Component" to start the list.' : ''}
              </td></tr>
            ) : items.map((i) => (
              <tr key={i.id}>
                <td style={{ ...tdStyle, color: TEXT.muted, width: 40 }}>{i.line_no}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{meta.component_categories?.[i.category] || i.category}</td>
                <td style={{ ...tdStyle, minWidth: 220 }}>
                  <div style={{ fontWeight: 600, color: TEXT.heading }}>{i.description}</div>
                  {(i.store_item_code || i.rating) && (
                    <div style={small}>{[i.store_item_code, i.rating].filter(Boolean).join(' · ')}</div>
                  )}
                </td>
                <td style={tdStyle}>
                  {i.make || i.part_number ? (
                    <>
                      <div>{i.make || '—'}</div>
                      <div style={small}>{i.part_number || 'No part number'}</div>
                    </>
                  ) : <span style={{ color: TEXT.muted }}>—</span>}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtQty(i.quantity)} {i.uom}</td>
                <td style={tdStyle}>{i.panel_tag || <span style={{ color: TEXT.muted }}>—</span>}</td>
                <td data-tour="elec-bom-selection-cell" style={tdStyle}>
                  <Pill value={i.selection_status} labels={SELECTION_LABELS} hex={SELECTION_HEX} />
                  {approvalRequestId(i) && (
                    <div style={small}>
                      <button type="button" style={{ ...linkStyle, fontSize: 11 }} onClick={() => setReviewing(i)}>Awaiting approval · Review</button>
                    </div>
                  )}
                </td>
                <td data-tour="elec-bom-procurement-cell" style={tdStyle}>
                  <Pill value={i.procurement_status} labels={PROCUREMENT_LABELS} hex={PROCUREMENT_HEX} />
                  {i.p2p_number && (
                    <div style={small}>{i.p2p_number}{i.p2p_status ? ` · ${i.p2p_status.replace(/_/g, ' ')}` : ''}</div>
                  )}
                </td>
                {canEdit && (
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button data-tour="elec-bom-edit-btn" type="button" style={smallBtn} disabled={busy} onClick={() => openEdit(i)}>Edit</button>
                      {i.selection_status === 'selected' && !approvalRequestId(i) && canSubmit && (
                        <button
                          data-tour="elec-bom-submit-btn" type="button" style={smallBtn} disabled={busy}
                          title="Send this line's make and part number for approval"
                          onClick={() => mutate(() => electricalApi.submitBomItem(job.id, i.id), `Could not submit BOM line ${i.line_no} for approval.`, { success: `BOM line ${i.line_no} submitted for approval.` })}
                        >
                          Submit for approval
                        </button>
                      )}
                      {i.p2p_request_id ? (
                        <button data-tour="elec-bom-unlink-pr-btn" type="button" style={smallBtn} disabled={busy} onClick={() => setUnlinking(i)}>Unlink PR</button>
                      ) : (
                        <button data-tour="elec-bom-link-pr-btn" type="button" style={smallBtn} disabled={busy} onClick={() => openLink(i)}>Link PR</button>
                      )}
                      {i.procurement_status === 'required' && canRaisePr && (
                        <button data-tour="elec-bom-raise-pr-btn" type="button" style={linkStyle} onClick={() => raisePr(i)}>Raise PR</button>
                      )}
                      {canRemove && <button data-tour="elec-bom-delete-btn" type="button" style={smallDangerBtn} disabled={busy} onClick={() => setDeleting(i)}>Delete</button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / edit component */}
      <Modal
        open={formOpen} width={960} flush busy={busy} tour="elec-bom-form"
        icon={editing ? 'edit' : 'box'} title={editing ? `Edit BOM Line ${editing.line_no}` : 'Add Component'}
        subtitle={editing ? `${editing.description} — ${job.job_number}` : `New line on ${job.job_number}'s electrical BOM.`}
        onClose={() => setFormOpen(false)}
        footer={<ModalFooter onCancel={() => setFormOpen(false)} onSubmit={save} busy={busy} icon={editing ? 'check' : 'plus'}
          label={editing ? 'Save Changes' : 'Add Component'} cancelTour="elec-bom-form-cancel" submitTour="elec-bom-form-save" />}
      >
        <SheetColumns
          left={<>
            <ErrorBanner error={formError} />
            <SheetSection icon="box" title="Component">
              <div style={rowStyle}>
                <F tour="elec-bom-category" label="Category" basis={190}>
                  <Select style={sheetInput} value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {Object.entries(meta.component_categories || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </F>
                <F tour="elec-bom-store-item" label="Store Item" optional basis={240} grow>
                  <input style={{ ...sheetInput, marginBottom: 6 }} value={storeSearch} onChange={(e) => setStoreSearch(e.target.value)}
                    placeholder="Search Store items by code or name…" aria-label="Search Store items" />
                  <SearchableSelect value={form.store_item_id} onChange={pickStoreItem} options={storeOptions}
                    placeholder={storeItems === null ? 'Loading Store items…' : 'Pick a Store item…'} />
                </F>
              </div>
              <div style={{ ...rowStyle, marginBottom: 0 }}>
                <F tour="elec-bom-description" label="Description" req basis={320} grow>
                  <input style={sheetInput} value={form.description} maxLength={255} onChange={(e) => set('description', e.target.value)}
                    placeholder="e.g. MCB 2-pole 16A, Type C" />
                </F>
              </div>
            </SheetSection>
            <SheetSection icon="tag" title="Selection & Specification">
              <div style={rowStyle}>
                <F tour="elec-bom-make" label="Make" basis={150} grow max={240}>
                  <input style={sheetInput} value={form.make} maxLength={150} onChange={(e) => set('make', e.target.value)} placeholder="e.g. Schneider" />
                </F>
                <F tour="elec-bom-part-number" label="Part Number" basis={150} grow max={240}>
                  <input style={sheetInput} value={form.part_number} maxLength={150} onChange={(e) => set('part_number', e.target.value)} />
                </F>
                <F tour="elec-bom-rating" label="Rating" basis={140} grow max={200}>
                  <input style={sheetInput} value={form.rating} maxLength={150} onChange={(e) => set('rating', e.target.value)} placeholder="e.g. 24V DC, 16A" />
                </F>
              </div>
              <div style={{ ...rowStyle, marginBottom: 0 }}>
                <F tour="elec-bom-specification" label="Specification" basis={320} grow>
                  <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={form.specification}
                    onChange={(e) => set('specification', e.target.value)} placeholder="Technical specification — standards, IP rating, mounting, etc." />
                </F>
              </div>
              <p style={sheetHint}>Mark a line Selected only after entering its make and part number.</p>
            </SheetSection>
          </>}
          right={<>
            <SheetSection icon="rupee" title="Quantity & Cost">
              <div style={{ ...rowStyle, marginBottom: 0 }}>
                <F tour="elec-bom-quantity" label="Quantity" req basis={100}>
                  <input style={sheetInput} type="number" min={0} step="any" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
                </F>
                <F tour="elec-bom-uom" label="UOM" basis={90}>
                  <input style={sheetInput} value={form.uom} maxLength={20} onChange={(e) => set('uom', e.target.value)} />
                </F>
                {seeCosts && (
                  <F tour="elec-bom-cost" label="Est. Unit Cost (₹)" basis={140} grow>
                    <input style={sheetInput} type="number" min={0} step="any" value={form.estimated_unit_cost} onChange={(e) => set('estimated_unit_cost', e.target.value)} />
                  </F>
                )}
              </div>
            </SheetSection>
            <SheetSection icon="flag" title="Panel & Status">
              <div style={rowStyle}>
                <F tour="elec-bom-panel" label="Panel" basis={240} grow>
                  <Select style={sheetInput} value={form.panel_id} onChange={(e) => set('panel_id', e.target.value)}>
                    <option value="">— Not panel-mounted —</option>
                    {panels.map((p) => <option key={p.id} value={String(p.id)}>{p.panel_tag} — {p.name}</option>)}
                  </Select>
                </F>
              </div>
              {!panels.length && (
                <p style={{ ...sheetHint, margin: '-4px 0 12px' }}>No panels on this job yet — add them on the Panels tab to mount components in a panel.</p>
              )}
              <div style={rowStyle}>
                <F tour="elec-bom-selection" label="Selection" basis={130} grow>
                  <Select style={sheetInput} value={form.selection_status} onChange={(e) => set('selection_status', e.target.value)}>
                    {Object.entries(SELECTION_LABELS)
                      .filter(([k]) => k !== 'approved' || canApprove || form.selection_status === 'approved')
                      .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </F>
                <F tour="elec-bom-procurement" label="Procurement" basis={130} grow>
                  <Select style={sheetInput} value={form.procurement_status} onChange={(e) => set('procurement_status', e.target.value)}>
                    {procurementOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </F>
              </div>
              <p style={{ ...sheetHint, margin: '-4px 0 12px' }}>
                {linkedPr ? `Linked to ${linkedPr}` : 'Use Link PR / Raise PR for PR Raised or Ordered'}
              </p>
              <div style={{ ...rowStyle, marginBottom: 0 }}>
                <F tour="elec-bom-remarks" label="Remarks" basis={240} grow>
                  <textarea style={{ ...sheetInput, minHeight: 56, resize: 'vertical' }} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
                </F>
              </div>
            </SheetSection>
          </>}
        />
      </Modal>

      {/* Approval of a line's component selection */}
      <Modal
        open={!!reviewing} width={680} icon="shield" iconColor="#16A34A"
        title={reviewing ? `Component selection — Line ${reviewing.line_no}` : 'Component selection'}
        subtitle={reviewing ? `${reviewing.description} · ${reviewing.make || '—'} ${reviewing.part_number || ''} · ${fmtQty(reviewing.quantity)} ${reviewing.uom}` : ''}
        onClose={() => setReviewing(null)}
      >
        {reviewing && (
          <ApprovalPanel
            entityType="electrical_bom_item"
            entityId={reviewing.id}
            onChanged={() => { reload(); onChanged() }}
          />
        )}
      </Modal>

      {/* Link a P2P purchase requisition */}
      <Modal
        open={!!linking} width={580} icon="link" busy={busy}
        title={linking ? `Link PR — Line ${linking.line_no}` : 'Link PR'}
        subtitle={linking ? `${linking.description} · ${fmtQty(linking.quantity)} ${linking.uom}` : ''}
        onClose={() => setLinking(null)}
        footer={<ModalFooter onCancel={() => setLinking(null)} onSubmit={confirmLink} busy={busy} busyLabel="Linking…" icon="link" label="Link PR" disabled={!prChoice} />}
      >
        <ErrorBanner error={linkError} />
        <SheetSection icon="cart" title="Purchase Requisition">
          <label style={sheetLabel}>Requisition <Req /></label>
          <input style={{ ...sheetInput, marginBottom: 6 }} value={prSearch} onChange={(e) => setPrSearch(e.target.value)}
            placeholder="Search by PR number or project…" aria-label="Search purchase requisitions" />
          <SearchableSelect value={prChoice} onChange={setPrChoice} options={prSelectOptions} placeholder="Pick a purchase requisition…" />
          <p style={sheetHint}>
            Only live requisitions are listed (Electrical ones first) — search to reach older ones. Linking moves a To Buy / In Stock line to PR Raised.
          </p>
        </SheetSection>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete BOM line?"
        message={deleting ? `Remove line ${deleting.line_no} (${deleting.description}) from ${job.job_number}'s BOM?` : ''}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const item = deleting
          setDeleting(null)
          if (item) mutate(() => electricalApi.deleteBomItem(job.id, item.id), `Could not delete BOM line ${item.line_no}.`, { success: `BOM line ${item.line_no} deleted.` })
        }}
      />
      <ConfirmDialog
        open={!!unlinking}
        title="Unlink purchase requisition?"
        message={unlinking ? `Detach ${unlinking.p2p_number || 'the PR'} from line ${unlinking.line_no} (${unlinking.description})? The requisition itself stays in Procurement; a PR Raised or Ordered line goes back to To Buy.` : ''}
        confirmLabel="Unlink"
        danger
        onCancel={() => setUnlinking(null)}
        onConfirm={() => {
          const item = unlinking
          setUnlinking(null)
          if (item) mutate(() => electricalApi.unlinkPr(job.id, item.id), `Could not unlink the PR from BOM line ${item.line_no}.`, { success: `PR unlinked from BOM line ${item.line_no}.` })
        }}
      />
    </div>
  )
}
