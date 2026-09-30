'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { productionApi, rrvApi } from '@/lib/api'
import { ProductionLookupOption } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import ProductionNav from '@/components/production/ProductionNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { RRV_DEFAULT_REQUIRED_TESTS, RRV_PRIORITY_LABELS, RRV_TEST_TYPES, toOptions } from '@/components/production/rrvMeta'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const hintStyle: React.CSSProperties = { fontSize: 12, color: TEXT.muted, margin: '6px 0 0' }

export default function NewRrvBuildPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('production')
  const router = useRouter()

  const [machines, setMachines] = useState<ProductionLookupOption[]>([])
  const [users, setUsers] = useState<ProductionLookupOption[]>([])
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
      router.push(`/dashboard/production/rrv-builds/${build.id}`)
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create the RRV build.'))
      setSaving(false)
    }
  }

  return (
    <div>
      <ProductionNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Production Module</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>New RRV Build</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>Creates the build with its 12-stage checklist. Work orders, tests and handover are added from the build page.</p>
        </div>
        <button onClick={() => router.push('/dashboard/production/rrv-builds')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <form onSubmit={submit}>
        <div style={sectionStyle}>
          <p style={sectionTitle}>Vehicle & order</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 260px', maxWidth: 380 }}>
              <label style={labelStyle}>RRV model *</label>
              <input style={inputStyle} value={form.rrv_model} onChange={(e) => set('rrv_model')(e.target.value)} placeholder="e.g. PR-RRV 4x4 Tower Wagon" />
            </div>
            <div style={{ flex: '1 1 240px', maxWidth: 340 }}>
              <label style={labelStyle}>Customer</label>
              <input style={inputStyle} value={form.customer_name} onChange={(e) => set('customer_name')(e.target.value)} placeholder="e.g. Northern Railway" />
            </div>
            <div style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={labelStyle}>Customer PO no.</label>
              <input style={inputStyle} value={form.customer_po_number} onChange={(e) => set('customer_po_number')(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>PO date</label>
              <DateField value={form.customer_po_date} onChange={set('customer_po_date')} />
            </div>
            <div style={{ flex: '0 1 200px', minWidth: 170 }}>
              <label style={labelStyle}>Order / tender ref.</label>
              <input style={inputStyle} value={form.order_reference} onChange={(e) => set('order_reference')(e.target.value)} placeholder="LOI / tender / inquiry no." />
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <p style={sectionTitle}>Vehicle identity</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 280px', maxWidth: 400 }}>
              <label style={labelStyle}>Existing machine in ERP (optional)</label>
              <SearchableSelect value={form.erp_project_id} onChange={set('erp_project_id')} options={toOptions(machines, 'None — register at completion')} placeholder="Select machine…" />
            </div>
            <div style={{ flex: '0 1 200px', minWidth: 180 }}>
              <label style={labelStyle}>Vehicle serial no.</label>
              <input style={inputStyle} value={form.vehicle_serial_number} onChange={(e) => set('vehicle_serial_number')(e.target.value)} disabled={!!form.erp_project_id} placeholder={form.erp_project_id ? 'from machine' : 'e.g. PR-RRV-2026-014'} />
            </div>
            <div style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={labelStyle}>Chassis no.</label>
              <input style={inputStyle} value={form.chassis_number} onChange={(e) => set('chassis_number')(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 180px', minWidth: 160 }}>
              <label style={labelStyle}>Engine no.</label>
              <input style={inputStyle} value={form.engine_number} onChange={(e) => set('engine_number')(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 110px', minWidth: 100 }}>
              <label style={labelStyle}>Year</label>
              <input style={inputStyle} value={form.year_of_manufacture} onChange={(e) => set('year_of_manufacture')(e.target.value)} placeholder={String(new Date().getFullYear())} maxLength={10} />
            </div>
          </div>
          <p style={hintStyle}>If no machine is picked, the vehicle is registered in the ERP machine registry automatically at RRV Completion, using the serial and chassis numbers — so Service can raise warranty tickets against it after handover.</p>
        </div>

        <div style={sectionStyle}>
          <p style={sectionTitle}>Plan</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 220px', maxWidth: 300 }}>
              <label style={labelStyle}>Build manager</label>
              <SearchableSelect value={managerId} onChange={set('build_manager_id')} options={toOptions(users)} placeholder="Select manager…" />
            </div>
            <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
              <label style={labelStyle}>Plant</label>
              <SearchableSelect value={form.branch_id} onChange={set('branch_id')} options={toOptions(branches, 'None')} placeholder="Select plant…" />
            </div>
            <div style={{ flex: '0 1 130px', minWidth: 120 }}>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={form.priority} onChange={(e) => set('priority')(e.target.value)}>
                {Object.entries(RRV_PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 1 160px', minWidth: 150 }}>
              <label style={labelStyle}>Planned start</label>
              <DateField value={form.planned_start_date} onChange={set('planned_start_date')} />
            </div>
            <div style={{ flex: '0 1 170px', minWidth: 160 }}>
              <label style={labelStyle}>Target completion</label>
              <DateField value={form.target_completion_date} onChange={set('target_completion_date')} />
            </div>
            <div style={{ flex: '0 1 170px', minWidth: 160 }}>
              <label style={labelStyle}>Target handover</label>
              <DateField value={form.target_handover_date} onChange={set('target_handover_date')} />
            </div>
            <div style={{ flex: '0 1 130px', minWidth: 120 }}>
              <label style={labelStyle}>Warranty (months)</label>
              <input style={inputStyle} value={form.warranty_months} onChange={(e) => set('warranty_months')(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Remarks</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.remarks} onChange={(e) => set('remarks')(e.target.value)} placeholder="Special customer requirements, variant, deviations…" />
          </div>
        </div>

        <div style={sectionStyle}>
          <p style={sectionTitle}>Vehicle tests required before handover</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
            {Object.entries(RRV_TEST_TYPES).map(([k, v]) => (
              <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.body, cursor: 'pointer', flex: '0 1 300px' }}>
                <input type="checkbox" checked={tests.includes(k)} onChange={(e) => setTests((prev) => (e.target.checked ? [...prev, k] : prev.filter((t) => t !== k)))} />
                {v}
              </label>
            ))}
          </div>
          <p style={hintStyle}>The Vehicle Testing stage can only be completed once the latest record of each ticked test is a pass. This can be changed later on the build.</p>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => router.push('/dashboard/production/rrv-builds')} style={secondaryBtnStyle} disabled={saving}>Cancel</button>
          <button type="submit" disabled={saving} style={{
            padding: '12px 22px', borderRadius: 12, border: 'none', cursor: saving ? 'wait' : 'pointer',
            background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, boxShadow: `0 8px 20px ${SHADOWS.glowOrange}`, opacity: saving ? 0.7 : 1,
          }}>
            {saving ? 'Creating…' : 'Create RRV Build'}
          </button>
        </div>
      </form>
    </div>
  )
}
