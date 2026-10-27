'use client'

import { useEffect, useState } from 'react'
import { productionEngineeringLookups } from '@/lib/productionEngineeringApi'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { productionApi } from '@/lib/api'
import { ProductionBom, ProductionLookupOption } from '@/types'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, Req, Optional, sheetBtn, sheetHint, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import ProductionNav from '@/components/production/ProductionNav'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath, useRecordId } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import OrderProjectPicker, { OrderProjectValue } from '@/components/sales/ProjectUnitPicker'
import Select from '@/components/shared/Select'
import { RowCount } from '@/components/shared/ui'

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11.5, fontWeight: 600, color: SHEET.MUTED, background: SHEET.SOFT, borderBottom: `1px solid ${SHEET.LINE}`, whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: SHEET.BODY, borderBottom: `1px solid ${SHEET.LINE}` }
const errorBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }
const toOptions = (rows: ProductionLookupOption[], none = '— None —') => [{ value: '', label: none }, ...rows.map((r) => ({ value: String(r.id), label: r.label }))]

export default function NewWorkOrderPage() {
  const { isAuthorized, isLoading } = useRequireApp('production')
  const router = useRouter()
  const searchParams = useSearchParams()

  // ?bom_id= / ?rrv_build_id= carry signed record refs (lib/recordRef.ts).
  const { id: presetBomId, error: bomLinkError } = useRecordId(searchParams.get('bom_id'))
  const [bomId, setBomId] = useState('')
  // Adopt the ?bom_id= preset once it resolves (state adjusted during render, not in an effect).
  const [seenPresetBom, setSeenPresetBom] = useState<number | null>(null)
  if (presetBomId && presetBomId !== seenPresetBom) {
    setSeenPresetBom(presetBomId)
    setBomId(String(presetBomId))
  }
  const [loadedBom, setLoadedBom] = useState<ProductionBom | null>(null)
  const [quantity, setQuantity] = useState(searchParams.get('quantity') || '1')
  // Raised from an RRV build page (?rrv_build_id=&build_role=) — the order is
  // linked to that vehicle and inherits its machine.
  const rrvBuildRef = searchParams.get('rrv_build_id')
  const { id: rrvBuildNum, error: rrvLinkError, loading: rrvLinkLoading } = useRecordId(rrvBuildRef)
  const rrvBuildId = rrvBuildNum ? String(rrvBuildNum) : null
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
  // CO01 sales-order assignment (make-to-order): the customer order line built for.
  const [soLineId, setSoLineId] = useState('')
  const [soLines, setSoLines] = useState<ProductionLookupOption[]>([])
  // Project unit (vehicle / lot) (required when the sales order has a project —
  // the server fills it in when the SO line has only one).
  const [orderProject, setOrderProject] = useState<OrderProjectValue | null>(null)

  const [boms, setBoms] = useState<ProductionLookupOption[]>([])
  const [projects, setProjects] = useState<ProductionLookupOption[]>([])
  const [branches, setBranches] = useState<ProductionLookupOption[]>([])
  const [locations, setLocations] = useState<ProductionLookupOption[]>([])
  const [users, setUsers] = useState<ProductionLookupOption[]>([])
  // Role assign-to rule (core/features/production.py) — the server enforces it on save too.
  const allowSupervisor = useAssigneeFilter('production:work_orders.supervisor')
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
    productionEngineeringLookups.salesOrderLines().then(setSoLines).catch(fail('sales order lines'))
  }, [isAuthorized])

  useEffect(() => {
    if (!bomId) return
    productionApi.getBom(Number(bomId)).then(setLoadedBom).catch((err) => setError(extractErrorMessages(err, 'Failed to load the selected BOM.')))
  }, [bomId])

  // Only show the BOM that matches the current pick (a stale one lingers while the next loads).
  const bom = bomId && loadedBom && String(loadedBom.id) === bomId ? loadedBom : null
  const qty = Number(quantity) || 0
  const factor = bom ? qty / (bom.base_quantity || 1) : 0

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
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
        sales_order_line_id: soLineId ? Number(soLineId) : null,
        order_project_element_id: !rrvBuildId && orderProject?.elementId ? orderProject.elementId : null,
        ...(rrvBuildId ? { rrv_build_id: Number(rrvBuildId), build_role: buildRole } : {}),
      })
      router.push(rrvBuildRef ? `/dashboard/production/rrv-builds/${rrvBuildRef}` : recordPath('/dashboard/production/work-orders', wo))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create work order.'))
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (bomLinkError || rrvLinkError) return (<div><ProductionNav /><InvalidRecordLink message={(bomLinkError || rrvLinkError) as string} listHref="/dashboard/production/work-orders" listLabel="Back to work orders" /></div>)
  if (rrvLinkLoading) return <div><ProductionNav /></div>

  const goBack = () => router.push(rrvBuildRef && rrvBuildId ? `/dashboard/production/rrv-builds/${rrvBuildRef}` : '/dashboard/production/work-orders')

  return (
    <form onSubmit={handleSubmit}>
      <FormPage nav={<ProductionNav />} tour="production-wo-new-form" icon="tool" title="New Work Order"
        subtitle="Build a quantity of one product from its active BOM — saved as a Draft first."
        onBack={goBack} backTour="production-wo-new-back-btn"
        footer={<>
          <button type="button" onClick={goBack} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
          <button data-tour="production-wo-new-submit-btn" type="submit" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name="plus" size={16} />{saving ? 'Creating…' : 'Create Draft Work Order'}
          </button>
        </>}>
        <SheetColumns
          left={<>
            {rrvBuildId && (
              <div data-tour="production-wo-new-rrv-banner" style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.2)', color: '#1e40af', fontSize: 13 }}>
                This work order will be linked to the RRV build as its <strong>{buildRole === 'main' ? 'main (final vehicle assembly)' : 'sub-assembly'}</strong> order and uses the build&apos;s machine — leave Machine blank.
              </div>
            )}
            {error && <div style={errorBox}>{Array.isArray(error) ? error.join(' ') : error}</div>}

            <SheetSection icon="box" title="What to Build">
              <div data-tour="production-wo-new-bom">
                <label style={sheetLabel}>Product / Active BOM <Req /></label>
                <SearchableSelect value={bomId} onChange={setBomId} placeholder="Search product…" options={boms.map((b) => ({ value: String(b.id), label: b.label }))} />
              </div>
              {boms.length === 0 && (
                <p style={{ ...sheetHint, color: '#b45309' }}>
                  No active BOMs yet. Create a BOM under BOM &amp; Routing and activate it before raising a work order.
                </p>
              )}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                <div data-tour="production-wo-new-qty" style={{ flex: '1 1 140px' }}>
                  <label style={sheetLabel}>Quantity <Req /></label>
                  <input style={sheetInput} type="number" min={0} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </div>
                <div data-tour="production-wo-new-priority" style={{ flex: '1 1 140px' }}>
                  <label style={sheetLabel}>Priority</label>
                  <Select style={sheetInput} value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </Select>
                </div>
              </div>
            </SheetSection>

            <SheetSection icon="building" title="Built For">
              <div data-tour="production-wo-new-machine">
                <label style={sheetLabel}>For Machine / Project (ERP)</label>
                <SearchableSelect value={projectId} onChange={setProjectId} placeholder="Serial number, model or client…" options={toOptions(projects, '— Stock build (no machine) —')} />
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                <div data-tour="production-wo-new-plant" style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>Plant</label>
                  <SearchableSelect value={branchId} onChange={setBranchId} placeholder="Select plant…" options={toOptions(branches)} />
                </div>
                <div style={{ flex: '1 1 240px' }}>
                  <label style={sheetLabel}>Sales Order Line</label>
                  <SearchableSelect value={soLineId} onChange={(v) => { setSoLineId(v); if (v) setOrderProject(null) }} placeholder="Make-to-order: pick the SO line…"
                    options={[{ value: '', label: '— None (stock build) —' }, ...soLines.map((l) => ({ value: String(l.id), label: l.label }))]} />
                </div>
              </div>
              {!rrvBuildId && (
                <div data-tour="production-wo-new-order-project" style={{ marginTop: 14 }}>
                  <label style={sheetLabel}>Project — Unit (vehicle / lot)</label>
                  <OrderProjectPicker value={orderProject}
                    onChange={(v) => { setOrderProject(v); if (v) setSoLineId('') }}
                    placeholder="Required for an order with a project — pick project / unit…" />
                  <p style={sheetHint}>Picking a vehicle / lot fills in its sales order line. Leave both blank for a stock build.</p>
                </div>
              )}
            </SheetSection>

            <SheetSection icon="calendar" title="Schedule & Responsibility">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div data-tour="production-wo-new-start" style={{ flex: '1 1 150px' }}>
                  <label style={sheetLabel}>Planned Start</label>
                  <DateField value={startDate} onChange={setStartDate} />
                </div>
                <div data-tour="production-wo-new-end" style={{ flex: '1 1 150px' }}>
                  <label style={sheetLabel}>Planned End</label>
                  <DateField value={endDate} onChange={setEndDate} />
                </div>
              </div>
              <div data-tour="production-wo-new-supervisor" style={{ marginTop: 14 }}>
                <label style={sheetLabel}>Supervisor</label>
                <SearchableSelect value={supervisorId} onChange={setSupervisorId} placeholder="Select user…" options={toOptions(users.filter((u) => allowSupervisor(u.id)))} />
              </div>
            </SheetSection>
          </>}
          right={<>
            <SheetSection icon="building" title="Store Locations">
              <div data-tour="production-wo-new-source">
                <label style={sheetLabel}>Issue Materials From</label>
                <SearchableSelect value={sourceId} onChange={setSourceId} placeholder="Raw material store…" options={toOptions(locations)} />
              </div>
              <div data-tour="production-wo-new-target" style={{ marginTop: 14 }}>
                <label style={sheetLabel}>Receive Output Into</label>
                <SearchableSelect value={targetId} onChange={setTargetId} placeholder="Finished goods store…" options={toOptions(locations)} />
              </div>
              <p style={sheetHint}>Both store locations are required before the work order can be released to the shop floor.</p>
            </SheetSection>
            <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
              <div data-tour="production-wo-new-remarks">
                <textarea style={{ ...sheetInput, minHeight: 100, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. customer special requirements" />
              </div>
            </SheetSection>
          </>}
        />

        {bom && (
          <div data-tour="production-wo-new-preview" style={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
            <SheetSection icon="list" title={`Preview — ${bom.bom_number} v${bom.version} × ${qty || 0}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ overflowX: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                    <thead><tr>{['Component', 'Required Qty', 'UOM'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={bom.items.length} />}</th>)}</tr></thead>
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
                <div style={{ overflowX: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                    <thead><tr>{['Seq', 'Operation', 'Workstation', 'Planned Hours'].map((h, i) => <th key={h} style={thStyle}>{h}{i === 0 && <RowCount count={bom.operations.length} />}</th>)}</tr></thead>
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
            </SheetSection>
          </div>
        )}
      </FormPage>
    </form>
  )
}
