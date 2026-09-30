'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi } from '@/lib/api'
import { ProductionBom, ProductionLookupOption } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import { secondaryBtnStyle } from '@/components/shared/ui'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ProductionNav from '@/components/production/ProductionNav'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, background: '#fdf1e6' }
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const toOptions = (rows: ProductionLookupOption[], none = '— None —') => [{ value: '', label: none }, ...rows.map((r) => ({ value: String(r.id), label: r.label }))]

export default function NewWorkOrderPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()
  const searchParams = useSearchParams()

  const [bomId, setBomId] = useState(searchParams.get('bom_id') || '')
  const [loadedBom, setLoadedBom] = useState<ProductionBom | null>(null)
  const [quantity, setQuantity] = useState(searchParams.get('quantity') || '1')
  // Raised from an RRV build page (?rrv_build_id=&build_role=) — the order is
  // linked to that vehicle and inherits its machine.
  const rrvBuildId = searchParams.get('rrv_build_id')
  const buildRole = searchParams.get('build_role') === 'main' ? 'main' : 'sub_assembly'
  const [priority, setPriority] = useState('normal')
  const [projectId, setProjectId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [supervisorId, setSupervisorId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [remarks, setRemarks] = useState('')

  const [boms, setBoms] = useState<ProductionLookupOption[]>([])
  const [projects, setProjects] = useState<ProductionLookupOption[]>([])
  const [branches, setBranches] = useState<ProductionLookupOption[]>([])
  const [locations, setLocations] = useState<ProductionLookupOption[]>([])
  const [users, setUsers] = useState<ProductionLookupOption[]>([])
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    const fail = (what: string) => (err: unknown) => setError(extractErrorMessages(err, `Failed to load ${what}.`))
    productionApi.lookupActiveBoms().then(setBoms).catch(fail('active BOMs'))
    productionApi.lookupProjects().then(setProjects).catch(fail('ERP machines'))
    productionApi.lookupBranches().then(setBranches).catch(fail('plants'))
    productionApi.lookupLocations().then(setLocations).catch(fail('store locations'))
    productionApi.lookupUsers().then(setUsers).catch(fail('users'))
  }, [isAuthorized])

  useEffect(() => {
    if (!bomId) return
    productionApi.getBom(Number(bomId)).then(setLoadedBom).catch((err) => setError(extractErrorMessages(err, 'Failed to load the selected BOM.')))
  }, [bomId])

  // Only show the BOM that matches the current pick (a stale one lingers while the next loads).
  const bom = bomId && loadedBom && String(loadedBom.id) === bomId ? loadedBom : null
  const qty = Number(quantity) || 0
  const factor = bom ? qty / (bom.base_quantity || 1) : 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!bomId) { setError('Pick the active BOM to build from.'); return }
    if (!(qty > 0)) { setError('Planned quantity must be more than zero.'); return }
    if (startDate && endDate && endDate < startDate) { setError('Planned end date is before the planned start date.'); return }
    setSaving(true)
    try {
      const wo = await productionApi.createWorkOrder({
        bom_id: Number(bomId),
        quantity_planned: qty,
        priority,
        erp_project_id: projectId ? Number(projectId) : null,
        branch_id: branchId ? Number(branchId) : null,
        source_location_id: sourceId ? Number(sourceId) : null,
        target_location_id: targetId ? Number(targetId) : null,
        supervisor_id: supervisorId ? Number(supervisorId) : null,
        planned_start_date: startDate || null,
        planned_end_date: endDate || null,
        remarks: remarks.trim() || null,
        ...(rrvBuildId ? { rrv_build_id: Number(rrvBuildId), build_role: buildRole } : {}),
      })
      router.push(rrvBuildId ? `/dashboard/production/rrv-builds/${rrvBuildId}` : `/dashboard/production/work-orders/${wo.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create work order.'))
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Production Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Work Order</h1>
        </div>
        <button onClick={() => router.push(rrvBuildId ? `/dashboard/production/rrv-builds/${rrvBuildId}` : '/dashboard/production/work-orders')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {rrvBuildId && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.2)', color: '#1e40af', fontSize: 13 }}>
          This work order will be linked to the RRV build as its <strong>{buildRole === 'main' ? 'main (final vehicle assembly)' : 'sub-assembly'}</strong> order and uses the build&apos;s machine — leave Machine blank.
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={sectionStyle}>
          <p style={sectionTitle}>What to build</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 320px', maxWidth: 480 }}>
              <label style={labelStyle}>Product / Active BOM *</label>
              <SearchableSelect value={bomId} onChange={setBomId} placeholder="Search product…" options={boms.map((b) => ({ value: String(b.id), label: b.label }))} />
            </div>
            <div style={{ flex: '0 1 130px', minWidth: 120 }}>
              <label style={labelStyle}>Quantity *</label>
              <input style={inputStyle} type="number" min={0} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 130px', minWidth: 120 }}>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          {boms.length === 0 && (
            <p style={{ fontSize: 12, color: '#b45309', margin: '10px 0 0' }}>
              No active BOMs yet. Create a BOM under BOM &amp; Routing and activate it before raising a work order.
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
            <div style={{ flex: '1 1 300px', maxWidth: 440 }}>
              <label style={labelStyle}>For Machine / Project (ERP)</label>
              <SearchableSelect value={projectId} onChange={setProjectId} placeholder="Serial number, model or client…" options={toOptions(projects, '— Stock build (no machine) —')} />
            </div>
            <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
              <label style={labelStyle}>Plant</label>
              <SearchableSelect value={branchId} onChange={setBranchId} placeholder="Select plant…" options={toOptions(branches)} />
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <p style={sectionTitle}>Schedule &amp; Store</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '0 1 170px', minWidth: 160 }}>
              <label style={labelStyle}>Planned Start</label>
              <DateField value={startDate} onChange={setStartDate} />
            </div>
            <div style={{ flex: '0 1 170px', minWidth: 160 }}>
              <label style={labelStyle}>Planned End</label>
              <DateField value={endDate} onChange={setEndDate} />
            </div>
            <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
              <label style={labelStyle}>Supervisor</label>
              <SearchableSelect value={supervisorId} onChange={setSupervisorId} placeholder="Select user…" options={toOptions(users)} />
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
            <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <label style={labelStyle}>Issue Materials From</label>
              <SearchableSelect value={sourceId} onChange={setSourceId} placeholder="Raw material store…" options={toOptions(locations)} />
            </div>
            <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <label style={labelStyle}>Receive Output Into</label>
              <SearchableSelect value={targetId} onChange={setTargetId} placeholder="Finished goods store…" options={toOptions(locations)} />
            </div>
          </div>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>Both store locations are required before the work order can be released to the shop floor.</p>
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Remarks</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>

        {bom && (
          <div style={sectionStyle}>
            <p style={sectionTitle}>Preview — {bom.bom_number} v{bom.version} × {qty || 0}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead><tr>{['Component', 'Required Qty', 'UOM'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {bom.items.map((i) => (
                      <tr key={i.id}>
                        <td style={tdStyle}>{i.item_code} — {i.item_name}</td>
                        <td style={tdStyle}>{+(i.quantity * factor * (1 + i.scrap_percent / 100)).toFixed(4)}</td>
                        <td style={tdStyle}>{i.uom || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead><tr>{['Seq', 'Operation', 'Workstation', 'Planned Hours'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {bom.operations.map((o) => (
                      <tr key={o.id}>
                        <td style={tdStyle}>{o.sequence}</td>
                        <td style={tdStyle}>{o.operation_name}{o.requires_inspection ? ' · quality gate' : ''}</td>
                        <td style={tdStyle}>{o.workstation_name || '—'}</td>
                        <td style={tdStyle}>{+(o.setup_hours + o.run_hours_per_unit * qty).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={saving} style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1,
            boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`,
          }}>
            {saving ? 'Creating…' : 'Create Draft Work Order'}
          </button>
        </div>
      </form>
    </div>
  )
}
