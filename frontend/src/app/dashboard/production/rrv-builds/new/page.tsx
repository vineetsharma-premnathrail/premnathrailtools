'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { productionApi, rrvApi } from '@/lib/api'
import { ProductionLookupOption } from '@/types'
import ProductionNav from '@/components/production/ProductionNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, Req, Optional, sheetBtn, sheetHint, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import { RRV_DEFAULT_REQUIRED_TESTS, RRV_PRIORITY_LABELS, RRV_TEST_TYPES, toOptions } from '@/components/production/rrvMeta'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import Select from '@/components/shared/Select'

const errorBox: React.CSSProperties = { padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }

export default function NewRrvBuildPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('production')
  const router = useRouter()

  const [machines, setMachines] = useState<ProductionLookupOption[]>([])
  const [users, setUsers] = useState<ProductionLookupOption[]>([])
  // Role assign-to rule (core/features/production.py) — the server enforces it on save too.
  const allowManager = useAssigneeFilter('production:rrv_builds.build_manager')
  const [branches, setBranches] = useState<ProductionLookupOption[]>([])
  const [form, setForm] = useState({
    rrv_model: '', customer_name: '', customer_po_number: '', customer_po_date: '', order_reference: '',
    erp_project_id: '', vehicle_serial_number: '', chassis_number: '', engine_number: '', year_of_manufacture: '',
    branch_id: '', build_manager_id: '', priority: 'normal', planned_start_date: '', target_completion_date: '',
    target_handover_date: '', warranty_months: '12', remarks: '',
  })
  const [tests, setTests] = useState<string[]>(RRV_DEFAULT_REQUIRED_TESTS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([productionApi.lookupProjects(), productionApi.lookupUsers(), productionApi.lookupBranches()])
      .then(([m, u, b]) => { setMachines(m); setUsers(u); setBranches(b) })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the form options.')))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))
  const managerId = form.build_manager_id || (user ? String(user.id) : '')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.rrv_model.trim().length < 2) { setError('Enter the RRV model (e.g. PR-RRV 4x4 Tower Wagon).'); return }
    if (!tests.length) { setError('Pick at least one vehicle test the RRV must pass before handover.'); return }
    const months = Number(form.warranty_months)
    if (!Number.isInteger(months) || months < 0 || months > 120) { setError('Warranty must be a whole number of months between 0 and 120.'); return }
    setSaving(true)
    const blank = (v: string) => (v.trim() ? v.trim() : null)
    try {
      const build = await rrvApi.create({
        rrv_model: form.rrv_model.trim(), customer_name: blank(form.customer_name), customer_po_number: blank(form.customer_po_number),
        customer_po_date: form.customer_po_date || null, order_reference: blank(form.order_reference),
        erp_project_id: form.erp_project_id ? Number(form.erp_project_id) : null,
        vehicle_serial_number: blank(form.vehicle_serial_number), chassis_number: blank(form.chassis_number),
        engine_number: blank(form.engine_number), year_of_manufacture: blank(form.year_of_manufacture),
        branch_id: form.branch_id ? Number(form.branch_id) : null, build_manager_id: managerId ? Number(managerId) : null,
        priority: form.priority, planned_start_date: form.planned_start_date || null,
        target_completion_date: form.target_completion_date || null, target_handover_date: form.target_handover_date || null,
        warranty_months: months, required_tests: tests, remarks: blank(form.remarks),
      })
      router.push(recordPath('/dashboard/production/rrv-builds', build))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create the RRV build.'))
      setSaving(false)
    }
  }

  const goBack = () => router.push('/dashboard/production/rrv-builds')

  return (
    <form onSubmit={submit}>
      <FormPage nav={<ProductionNav />} tour="production-rrv-new-form" icon="truck" title="New RRV Build"
        subtitle="Creates the build with its 12-stage checklist. Work orders, tests and handover are added from the build page."
        onBack={goBack} backTour="production-rrv-new-back-btn"
        footer={<>
          <button data-tour="production-rrv-new-cancel-btn" type="button" onClick={goBack} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
          <button data-tour="production-rrv-new-submit-btn" type="submit" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name="plus" size={16} />{saving ? 'Creating…' : 'Create RRV Build'}
          </button>
        </>}>
        <SheetColumns
          left={<>
            {error && <div style={errorBox}>{Array.isArray(error) ? error.join(' ') : error}</div>}

            <SheetSection icon="building" title="Vehicle & Order">
              <div data-tour="production-rrv-new-model">
                <label style={sheetLabel}>RRV model <Req /></label>
                <input style={sheetInput} value={form.rrv_model} onChange={(e) => set('rrv_model')(e.target.value)} placeholder="e.g. PR-RRV 4x4 Tower Wagon" />
              </div>
              <div data-tour="production-rrv-new-customer" style={{ marginTop: 14 }}>
                <label style={sheetLabel}>Customer</label>
                <input style={sheetInput} value={form.customer_name} onChange={(e) => set('customer_name')(e.target.value)} placeholder="e.g. Northern Railway" />
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                <div data-tour="production-rrv-new-po-no" style={{ flex: '1 1 160px' }}>
                  <label style={sheetLabel}>Customer PO no.</label>
                  <input style={sheetInput} value={form.customer_po_number} onChange={(e) => set('customer_po_number')(e.target.value)} />
                </div>
                <div data-tour="production-rrv-new-po-date" style={{ flex: '1 1 150px' }}>
                  <label style={sheetLabel}>PO date</label>
                  <DateField value={form.customer_po_date} onChange={set('customer_po_date')} />
                </div>
              </div>
              <div data-tour="production-rrv-new-order-ref" style={{ marginTop: 14 }}>
                <label style={sheetLabel}>Order / tender ref.</label>
                <input style={sheetInput} value={form.order_reference} onChange={(e) => set('order_reference')(e.target.value)} placeholder="LOI / tender / inquiry no." />
              </div>
            </SheetSection>

            <SheetSection icon="truck" title="Vehicle Identity">
              <div data-tour="production-rrv-new-machine">
                <label style={sheetLabel}>Existing machine in ERP <Optional /></label>
                <SearchableSelect value={form.erp_project_id} onChange={set('erp_project_id')} options={toOptions(machines, 'None — register at completion')} placeholder="Select machine…" />
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                <div data-tour="production-rrv-new-serial" style={{ flex: '1 1 180px' }}>
                  <label style={sheetLabel}>Vehicle serial no.</label>
                  <input style={sheetInput} value={form.vehicle_serial_number} onChange={(e) => set('vehicle_serial_number')(e.target.value)} disabled={!!form.erp_project_id} placeholder={form.erp_project_id ? 'from machine' : 'e.g. PR-RRV-2026-014'} />
                </div>
                <div data-tour="production-rrv-new-chassis" style={{ flex: '1 1 160px' }}>
                  <label style={sheetLabel}>Chassis no.</label>
                  <input style={sheetInput} value={form.chassis_number} onChange={(e) => set('chassis_number')(e.target.value)} />
                </div>
                <div data-tour="production-rrv-new-engine" style={{ flex: '1 1 160px' }}>
                  <label style={sheetLabel}>Engine no.</label>
                  <input style={sheetInput} value={form.engine_number} onChange={(e) => set('engine_number')(e.target.value)} />
                </div>
                <div data-tour="production-rrv-new-year" style={{ flex: '1 1 100px' }}>
                  <label style={sheetLabel}>Year</label>
                  <input style={sheetInput} value={form.year_of_manufacture} onChange={(e) => set('year_of_manufacture')(e.target.value)} placeholder={String(new Date().getFullYear())} maxLength={10} />
                </div>
              </div>
              <p style={sheetHint}>If no machine is picked, the vehicle is registered in the ERP machine registry automatically at RRV Completion, using the serial and chassis numbers — so Service can raise warranty tickets against it after handover.</p>
            </SheetSection>

            <SheetSection icon="calendar" title="Plan">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div data-tour="production-rrv-new-manager" style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>Build manager</label>
                  <SearchableSelect value={managerId} onChange={set('build_manager_id')} options={toOptions(users.filter((u) => allowManager(u.id)))} placeholder="Select manager…" />
                </div>
                <div data-tour="production-rrv-new-plant" style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>Plant</label>
                  <SearchableSelect value={form.branch_id} onChange={set('branch_id')} options={toOptions(branches, 'None')} placeholder="Select plant…" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                <div data-tour="production-rrv-new-priority" style={{ flex: '1 1 120px' }}>
                  <label style={sheetLabel}>Priority</label>
                  <Select style={sheetInput} value={form.priority} onChange={(e) => set('priority')(e.target.value)}>
                    {Object.entries(RRV_PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </div>
                <div data-tour="production-rrv-new-start" style={{ flex: '1 1 150px' }}>
                  <label style={sheetLabel}>Planned start</label>
                  <DateField value={form.planned_start_date} onChange={set('planned_start_date')} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
                <div data-tour="production-rrv-new-target-completion" style={{ flex: '1 1 150px' }}>
                  <label style={sheetLabel}>Target completion</label>
                  <DateField value={form.target_completion_date} onChange={set('target_completion_date')} />
                </div>
                <div data-tour="production-rrv-new-target-handover" style={{ flex: '1 1 150px' }}>
                  <label style={sheetLabel}>Target handover</label>
                  <DateField value={form.target_handover_date} onChange={set('target_handover_date')} />
                </div>
              </div>
            </SheetSection>
          </>}
          right={<>
            <SheetSection icon="shield" title="Required Vehicle Tests">
              <div data-tour="production-rrv-new-tests">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(RRV_TEST_TYPES).map(([k, v]) => (
                    <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: SHEET.BODY, cursor: 'pointer' }}>
                      <input type="checkbox" checked={tests.includes(k)} onChange={(e) => setTests((prev) => (e.target.checked ? [...prev, k] : prev.filter((t) => t !== k)))} />
                      {v}
                    </label>
                  ))}
                </div>
                <p style={sheetHint}>The Vehicle Testing stage can only be completed once the latest record of each ticked test is a pass. This can be changed later on the build.</p>
              </div>
            </SheetSection>
            <SheetSection icon="clock" title="Warranty">
              <div data-tour="production-rrv-new-warranty">
                <label style={sheetLabel}>Warranty (months)</label>
                <input style={sheetInput} value={form.warranty_months} onChange={(e) => set('warranty_months')(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" />
              </div>
            </SheetSection>
            <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
              <div data-tour="production-rrv-new-remarks">
                <textarea style={{ ...sheetInput, minHeight: 90, resize: 'vertical' }} value={form.remarks} onChange={(e) => set('remarks')(e.target.value)} placeholder="Special customer requirements, variant, deviations…" />
              </div>
            </SheetSection>
          </>}
        />
      </FormPage>
    </form>
  )
}
