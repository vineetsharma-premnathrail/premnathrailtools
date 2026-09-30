'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { ProductionBom } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import { secondaryBtnStyle, InfoRow } from '@/components/shared/ui'
import ProductionNav from '@/components/production/ProductionNav'
import BomForm from '@/components/production/BomForm'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Draft', active: 'Active', obsolete: 'Obsolete' }
const STATUS_HEX: Record<string, string> = { draft: '#F59E0B', active: '#16A34A', obsolete: '#78716c' }

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 12, border: 'none', cursor: 'pointer',
  background: GRADIENTS.primary, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
}
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

type PendingAction = 'activate' | 'obsolete' | 'delete' | null

export default function BomDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()
  const params = useParams()
  const bomId = Number(params.id)

  const [bom, setBom] = useState<ProductionBom | null>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [pending, setPending] = useState<PendingAction>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isAuthorized || !bomId) return
    productionApi.getBom(bomId)
      .then(setBom)
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load BOM.')))
  }, [isAuthorized, bomId])

  const run = async (fn: () => Promise<ProductionBom | void>, fallback: string) => {
    setError('')
    setBusy(true)
    try {
      const result = await fn()
      if (result) setBom(result)
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const confirmPending = async () => {
    const action = pending
    setPending(null)
    if (action === 'activate') await run(() => productionApi.activateBom(bomId), 'Failed to activate BOM.')
    if (action === 'obsolete') await run(() => productionApi.obsoleteBom(bomId), 'Failed to mark BOM obsolete.')
    if (action === 'delete') {
      await run(async () => { await productionApi.deleteBom(bomId); router.push('/dashboard/production/bom') }, 'Failed to delete BOM.')
    }
  }

  const newVersion = () => run(async () => {
    const created = await productionApi.newBomVersion(bomId)
    router.push(`/dashboard/production/bom/${created.id}`)
  }, 'Failed to create a new version.')

  if (isLoading || !isAuthorized) return null

  const unitCost = bom ? (bom.standard_material_cost + bom.standard_labour_cost) / (bom.base_quantity || 1) : 0

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module · BOM
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 20px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{bom ? `${bom.bom_number} · v${bom.version}` : 'BOM'}</h1>
            {bom && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[bom.status]}1a`, color: STATUS_HEX[bom.status], whiteSpace: 'nowrap' }}>
                {STATUS_LABELS[bom.status] || bom.status}
              </span>
            )}
          </div>
        </div>
        <button onClick={() => router.push('/dashboard/production/bom')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {bom && !editing && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {bom.status === 'draft' && (
            <>
              <button type="button" disabled={busy} style={primaryBtn} onClick={() => setPending('activate')}>Activate BOM</button>
              <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => setEditing(true)}>Edit</button>
              <button type="button" disabled={busy} style={{ ...secondaryBtnStyle, color: DANGER.primary, borderColor: DANGER.border }} onClick={() => setPending('delete')}>Delete Draft</button>
            </>
          )}
          {bom.status === 'active' && (
            <>
              <button type="button" disabled={busy} style={primaryBtn} onClick={() => router.push(`/dashboard/production/work-orders/new?bom_id=${bom.id}`)}>+ Raise Work Order</button>
              <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={newVersion}>New Version</button>
              <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={() => setPending('obsolete')}>Mark Obsolete</button>
            </>
          )}
          {bom.status === 'obsolete' && (
            <button type="button" disabled={busy} style={secondaryBtnStyle} onClick={newVersion}>New Version from this</button>
          )}
        </div>
      )}

      {bom && editing && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button type="button" style={secondaryBtnStyle} onClick={() => setEditing(false)}>Cancel Edit</button>
          </div>
          <BomForm
            initial={bom}
            submitLabel="Save Changes"
            onSubmit={async (payload) => {
              const updated = await productionApi.updateBom(bomId, payload)
              setBom(updated)
              setEditing(false)
            }}
          />
        </>
      )}

      {bom && !editing && (
        <>
          <div style={sectionStyle}>
            <p style={sectionTitle}>Summary</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              <InfoRow label="Product" value={`${bom.product_code} — ${bom.product_name}`} />
              <InfoRow label="Base Quantity" value={`${bom.base_quantity} ${bom.product_uom || ''}`} />
              <InfoRow label="Std Material Cost" value={inr(bom.standard_material_cost)} />
              <InfoRow label="Std Labour Cost" value={inr(bom.standard_labour_cost)} />
              <InfoRow label="Std Cost / Unit" value={inr(unitCost)} />
              <InfoRow label="Work Orders" value={String(bom.work_order_count)} />
              <InfoRow label="Created By" value={bom.created_by_name || '—'} />
              <InfoRow label="Activated" value={bom.activated_at ? `${formatDateTime(bom.activated_at)} by ${bom.activated_by_name || '—'}` : '—'} />
            </div>
            {bom.description && <div style={{ marginTop: 14 }}><InfoRow label="Description" value={bom.description} /></div>}
            {bom.remarks && <div style={{ marginTop: 14 }}><InfoRow label="Remarks" value={bom.remarks} /></div>}
            <p style={{ fontSize: 12, color: TEXT.muted, margin: '14px 0 0' }}>
              Standard costs use each component&apos;s Store standard cost (or moving-average cost) and each workstation&apos;s hourly rate.
            </p>
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitle}>Components ({bom.items.length})</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                <thead><tr>{['Item', 'Qty', 'UOM', 'Scrap %', 'Unit Cost', 'Line Cost', 'Remarks'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {bom.items.length === 0 ? (
                    <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No components.</td></tr>
                  ) : bom.items.map((i) => (
                    <tr key={i.id}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading }}>{i.item_code} — {i.item_name}</td>
                      <td style={tdStyle}>{i.quantity}</td>
                      <td style={tdStyle}>{i.uom || '—'}</td>
                      <td style={tdStyle}>{i.scrap_percent}%</td>
                      <td style={tdStyle}>{i.unit_cost ? inr(i.unit_cost) : <span style={{ color: '#b45309' }}>not set</span>}</td>
                      <td style={tdStyle}>{inr(i.quantity * (1 + i.scrap_percent / 100) * i.unit_cost)}</td>
                      <td style={tdStyle}>{i.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitle}>Routing ({bom.operations.length})</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr>{['Seq', 'Operation', 'Workstation', 'Setup hrs', 'Run hrs / unit', 'Quality Gate', 'Instructions'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {bom.operations.length === 0 ? (
                    <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No routing operations.</td></tr>
                  ) : bom.operations.map((o) => (
                    <tr key={o.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{o.sequence}</td>
                      <td style={{ ...tdStyle, color: TEXT.heading }}>{o.operation_name}</td>
                      <td style={tdStyle}>{o.workstation_name || '—'}</td>
                      <td style={tdStyle}>{o.setup_hours}</td>
                      <td style={tdStyle}>{o.run_hours_per_unit}</td>
                      <td style={tdStyle}>{o.requires_inspection ? <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: '#0d94881a', color: '#0d9488' }}>Inspection</span> : '—'}</td>
                      <td style={tdStyle}>{o.instructions || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending === 'activate' ? 'Activate this BOM?' : pending === 'obsolete' ? 'Mark BOM obsolete?' : 'Delete draft BOM?'}
        message={
          pending === 'activate'
            ? 'It becomes the active version for this product and locks for editing. Any currently active version becomes obsolete. Existing work orders keep their own material list.'
            : pending === 'obsolete'
              ? 'No new work orders can be raised from it. Existing work orders are not affected.'
              : 'This draft will be removed.'
        }
        confirmLabel={pending === 'activate' ? 'Activate' : pending === 'obsolete' ? 'Mark Obsolete' : 'Delete'}
        danger={pending !== 'activate'}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
