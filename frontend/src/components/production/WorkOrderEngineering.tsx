'use client'

// Work order detail — engineering-change flag (CC01/ECM), sales-order and
// parent links (CO01), dependent sub-assembly orders (CS11), and job-work
// challans for external operations (CA01 control key).
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { productionEngineeringApi, productionEngineeringLookups } from '@/lib/productionEngineeringApi'
import { ProductionDependentOrder, ProductionLookupOption, ProductionWorkOrder, ProductionWorkOrderOperation } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle, InfoRow } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormSheet, SheetSection, SheetIcon, SHEET, Req, sheetBtn, sheetLabel, SheetError } from '@/components/shared/FormSheet'
import ReasonSheet from '@/components/shared/ReasonSheet'
import Checkbox from '@/components/Checkbox'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'
import { OrderProjectChip } from '@/components/sales/OrderProjectPicker'
import { useCan } from '@/lib/permissions'

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: 0 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const errorBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const STATUS_LABELS: Record<string, string> = { draft: 'Draft', released: 'Released', in_progress: 'In Progress', completed: 'Completed', closed: 'Closed', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { draft: '#F59E0B', released: '#2563eb', in_progress: '#9333ea', completed: '#16A34A', closed: '#78716c', cancelled: '#78716c' }

export function ChangeFlagBanner({ wo, canEdit, onChanged }: { wo: ProductionWorkOrder; canEdit: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  if (!wo.change_flag) return null
  const cleared = !!wo.change_flag_cleared_at
  return (
    <div style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 12, background: cleared ? 'rgba(22,163,74,0.07)' : 'rgba(245,158,11,0.09)', border: `1px solid ${cleared ? 'rgba(22,163,74,0.25)' : 'rgba(245,158,11,0.3)'}`, fontSize: 13, color: TEXT.body }}>
      {error && <div style={errorBox}>{Array.isArray(error) ? error.join(' ') : error}</div>}
      <b style={{ color: cleared ? '#15803d' : '#b45309' }}>{cleared ? 'Engineering change reviewed' : 'Engineering change on this order'}</b>
      <div style={{ marginTop: 4 }}>{wo.change_flag}</div>
      {cleared ? (
        <div style={{ marginTop: 6, color: TEXT.secondary }}>Resolution ({wo.change_flag_cleared_at ? formatDateTime(wo.change_flag_cleared_at) : ''}): {wo.change_flag_resolution}</div>
      ) : canEdit && (
        <button type="button" style={{ ...secondaryBtnStyle, marginTop: 8 }} onClick={() => setOpen(true)}>Record resolution &amp; clear</button>
      )}
      <ReasonSheet
        open={open}
        icon="check"
        iconColor="#16A34A"
        title="Clear Engineering-Change Flag"
        subtitle={`Work order ${wo.wo_number}`}
        label="Resolution"
        hint="Say what was done with this order and its WIP (e.g. reworked to the new revision, old parts used up, re-raised on the new BOM)."
        placeholder="Resolution…"
        confirmLabel="Clear Flag"
        busyLabel="Clearing…"
        requireValue
        requiredMessage="Write a short resolution (at least 3 characters)."
        onConfirm={async (text) => {
          if (text.length < 3) return 'Write a short resolution (at least 3 characters).'
          try {
            await productionEngineeringApi.clearChangeFlag(wo.id, text)
            setOpen(false)
            setError('')
            onChanged()
          } catch (err) {
            return extractErrorMessages(err, 'Failed to clear the flag.')
          }
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  )
}

export function WorkOrderLinks({ wo }: { wo: ProductionWorkOrder }) {
  const router = useRouter()
  const { can } = useCan()
  if (!wo.sales_order_label && !wo.parent_work_order_id && !wo.order_project_number) return null
  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16, alignItems: 'flex-start' }}>
      {wo.order_project_number && wo.order_project_id && (
        <div>
          <p className="info-row-label" style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Order Project</p>
          <OrderProjectChip opNumber={wo.order_project_number} elementNo={wo.order_project_element_no} label={wo.order_project_element_label}
            onClick={can('projects', 'order_projects', 'view') ? () => router.push(recordPath('/dashboard/projects/order-projects', wo, 'order_project_id')) : undefined} />
        </div>
      )}
      {wo.sales_order_label && <InfoRow label="Sales Order" value={wo.sales_order_label} />}
      {wo.parent_work_order_id && (
        <div style={{ cursor: 'pointer' }} onClick={() => router.push(recordPath('/dashboard/production/work-orders', { id: wo.parent_work_order_id as number }))}>
          <InfoRow label="Parent Work Order" value={`${wo.parent_wo_number || `#${wo.parent_work_order_id}`} →`} />
        </div>
      )}
    </div>
  )
}

export function DependentOrdersSection({ wo, canCreate, onChanged }: { wo: ProductionWorkOrder; canCreate: boolean; onChanged: () => void }) {
  const router = useRouter()
  const [rows, setRows] = useState<ProductionDependentOrder[]>([])
  const [netStock, setNetStock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const load = useCallback(() => {
    productionEngineeringApi.listDependents(wo.id).then(setRows).catch((err) => setError(extractErrorMessages(err, 'Failed to load dependent orders.')))
  }, [wo.id])
  useEffect(() => { load() }, [load])
  const open = ['draft', 'released', 'in_progress'].includes(wo.status)

  const create = async () => {
    setError('')
    setBusy(true)
    try {
      setRows(await productionEngineeringApi.createSubOrders(wo.id, { net_free_stock: netStock }))
      onChanged()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create sub-assembly work orders.'))
    } finally {
      setBusy(false)
    }
  }

  if (!rows.length && !(open && canCreate)) return null
  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <p style={sectionTitle}>Sub-assembly Work Orders ({rows.length})</p>
        {open && canCreate && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: TEXT.secondary }}>
              <Checkbox checked={netStock} onChange={(e) => setNetStock(e.target.checked)} /> Net free stock
            </label>
            <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={create}>{busy ? 'Exploding…' : 'Create sub-assembly orders'}</button>
          </div>
        )}
      </div>
      <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 10px' }}>
        Make items in this order&apos;s BOM tree (components with their own active BOM) get their own draft work orders, linked here and to the same machine / sales order. Running it again only adds what&apos;s missing.
      </p>
      {error && <div style={errorBox}>{Array.isArray(error) ? error.join(' ') : error}</div>}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
            <thead><tr>{['Level', 'Work Order', 'Product', 'Qty', 'Status'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => router.push(recordPath('/dashboard/production/work-orders', r))}>
                  <td style={tdStyle}>{r.level}</td>
                  <td style={{ ...tdStyle, paddingLeft: 12 + (r.level - 1) * 18, fontWeight: 600, color: TEXT.heading }}>{r.wo_number}</td>
                  <td style={tdStyle}>{r.product_code} — {r.product_name}</td>
                  <td style={tdStyle}>{r.quantity_planned}</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[r.status] || '#78716c'}1a`, color: STATUS_HEX[r.status] || '#78716c', whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[r.status] || r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Portal dialog: pick the Store job-work challan for an external operation. */
export function JobWorkLinkDialog({ wo, op, onClose, onLinked }: {
  wo: ProductionWorkOrder; op: ProductionWorkOrderOperation | null; onClose: () => void; onLinked: () => void
}) {
  // Keyed by operation so each opening starts with a blank pick.
  return op ? <JobWorkLinkSheet key={op.id} wo={wo} op={op} onClose={onClose} onLinked={onLinked} /> : null
}
function JobWorkLinkSheet({ wo, op, onClose, onLinked }: {
  wo: ProductionWorkOrder; op: ProductionWorkOrderOperation; onClose: () => void; onLinked: () => void
}) {
  const [challans, setChallans] = useState<ProductionLookupOption[]>([])
  const [pick, setPick] = useState('')
  const [error, setError] = useState<string | string[]>('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    productionEngineeringLookups.jobWorkChallans(op.vendor_id).then(setChallans).catch((err) => setError(extractErrorMessages(err, 'Failed to load job-work challans.')))
  }, [op])

  const save = async () => {
    if (!pick) { setError('Pick the job-work challan the material went out on.'); return }
    setBusy(true)
    try {
      await productionEngineeringApi.linkJobWork(wo.id, op.id, Number(pick))
      onLinked()
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to link the challan.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet width={580} icon="link" iconColor="#9333ea" title="Link Job-Work Challan" subtitle={`Op ${op.sequence} ${op.operation_name} · ${wo.wo_number}`} onClose={onClose} busy={busy}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="button" onClick={save} disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="link" size={16} />{busy ? 'Linking…' : 'Link Challan'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        <SheetSection icon="truck" title="Job-Work Challan">
          <p style={{ fontSize: 12.5, color: SHEET.MUTED, margin: '0 0 12px' }}>
            Vendor: <b style={{ color: SHEET.INK }}>{op.vendor_name || '—'}</b>. Issue the material in Store › Issues (type Job Work) first; the step can be confirmed once it comes back (Material Return / Job Work Receipt).
          </p>
          <label style={sheetLabel}>Challan <Req /></label>
          <SearchableSelect value={pick} onChange={setPick} placeholder="Search challan…" options={challans.map((c) => ({ value: String(c.id), label: c.label }))} />
        </SheetSection>
      </div>
    </FormSheet>
  )
}
