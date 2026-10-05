'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { organizationApi, storeApi } from '@/lib/api'
import { Department, StoreDocType, StoreItem, StoreLocation, StoreMaterialIssue } from '@/types'
import { TEXT } from '@/lib/theme'
import { Field, Section, Row, inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import MessageDialog from '@/components/erp/MessageDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'

interface Line { itemId: string; quantity: string; condition: string; batchNumber: string }

const RULE_LABELS: Record<string, string> = {
  warehouse_manager: 'Store in-charge',
  department_head: 'Department head',
  specific_users: 'Designated approver',
}

export default function NewMaterialReturnPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const router = useRouter()

  const [items, setItems] = useState<StoreItem[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [issues, setIssues] = useState<StoreMaterialIssue[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [sources, setSources] = useState<StoreDocType[]>([])
  const [conditions, setConditions] = useState<StoreDocType[]>([])

  const [locationId, setLocationId] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [sourceIssueId, setSourceIssueId] = useState('')
  const [sourceDescription, setSourceDescription] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<Line[]>([{ itemId: '', quantity: '', condition: '', batchNumber: '' }])

  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listItems().then(setItems).catch(() => setItems([]))
    storeApi.listLocations().then(setLocations).catch(() => setLocations([]))
    storeApi.listMaterialIssues().then(setIssues).catch(() => setIssues([]))
    organizationApi.listDepartments().then(setDepartments).catch(() => setDepartments([]))
    storeApi.listDocTypes('return_source').then((s) => { setSources(s); setSourceType((v) => v || s[0]?.value || '') }).catch(() => setSources([]))
    storeApi.listDocTypes('return_condition').then((c) => {
      setConditions(c)
      setLines((prev) => prev.map((l) => (l.condition ? l : { ...l, condition: c[0]?.value || '' })))
    }).catch(() => setConditions([]))
  }, [isAuthorized])

  const source = sources.find((s) => s.value === sourceType)
  const defaultCondition = conditions[0]?.value || ''
  const updateLine = (idx: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  const addLine = () => setLines((prev) => [...prev, { itemId: '', quantity: '', condition: defaultCondition, batchNumber: '' }])
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx))

  // Picking an issue pre-fills the department it was issued to (drives the
  // department-head approval rule); the user can still change it.
  const pickIssue = (id: string) => {
    setSourceIssueId(id)
    const issue = issues.find((i) => String(i.id) === id)
    if (issue?.department_id) setDepartmentId(String(issue.department_id))
  }

  // Live preview of who will have to approve — mirrors the server's rules.
  const usedTypes = [source, ...Array.from(new Set(lines.filter((l) => l.itemId).map((l) => l.condition))).map((c) => conditions.find((x) => x.value === c))]
    .filter((t): t is StoreDocType => !!t && t.approver_rule !== 'none')
  const approvalSteps = Object.values(usedTypes.reduce<Record<string, { rule: string; reasons: string[] }>>((acc, t) => {
    const key = t.approver_rule === 'specific_users' ? `${t.approver_rule}:${t.approver_user_ids.join(',')}` : t.approver_rule
    acc[key] = acc[key] || { rule: t.approver_rule, reasons: [] }
    acc[key].reasons.push(t.label)
    return acc
  }, {}))
  const needsDepartment = usedTypes.some((t) => t.approver_rule === 'department_head')
  const quarantineLines = lines.filter((l) => l.itemId && conditions.find((c) => c.value === l.condition)?.stock_effect === 'quarantine').length

  const save = async () => {
    const problems: string[] = []
    if (!locationId) problems.push('Store is required.')
    if (!source) problems.push('Source is required — pick where the material is coming back from.')
    if (source?.requires_issue && !sourceIssueId) problems.push(`'${source.label}' needs the Material Issue the material came from.`)
    if (needsDepartment && !departmentId) problems.push('Department is required — the department head must approve this return.')
    const validLines = lines.filter((l) => l.itemId && l.quantity)
    if (!validLines.length) problems.push('At least one item is required.')
    for (const l of validLines) {
      if (Number(l.quantity) <= 0) problems.push('Every item quantity must be greater than zero.')
    }
    if (problems.length) {
      setErrors(problems)
      return
    }
    setBusy(true)
    setErrors([])
    try {
      const ret = await storeApi.createMaterialReturn({
        location_id: Number(locationId),
        source_type: sourceType,
        source_issue_id: sourceIssueId ? Number(sourceIssueId) : undefined,
        source_description: !source?.requires_issue ? sourceDescription.trim() || undefined : undefined,
        department_id: departmentId ? Number(departmentId) : undefined,
        reason: reason.trim() || undefined,
        remarks: remarks.trim() || undefined,
        items: validLines.map((l) => ({
          item_id: Number(l.itemId),
          quantity: Number(l.quantity),
          condition: l.condition,
          batch_number: l.batchNumber.trim() || undefined,
        })),
      })
      router.push(`/dashboard/store/returns/${ret.id}`)
    } catch (err) {
      setErrors(extractErrorMessages(err, 'Failed to create material return.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <StoreNav />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Store &amp; Inventory
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>New Material Return</h1>
        </div>
        <button type="button" data-tour="return-back-btn" onClick={() => router.push('/dashboard/store/returns')} style={secondaryBtnStyle}>← Back</button>
      </div>

      <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Material Return" message={errors} onClose={() => setErrors([])} />

      <Section title="Return Details" style={{ marginBottom: 20 }}>
        <Row>
          <Field label="Store *">
            <select data-tour="return-location" style={inputStyle} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">— Select —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Source *">
            <select data-tour="return-source-type" style={inputStyle} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
              {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          {source?.requires_issue ? (
            <Field label="Material Issue *">
              <select data-tour="return-source-issue" style={inputStyle} value={sourceIssueId} onChange={(e) => pickIssue(e.target.value)}>
                <option value="">— Select —</option>
                {issues.map((i) => <option key={i.id} value={i.id}>{i.issue_number}{i.department_name ? ` — ${i.department_name}` : ''}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Source Description">
              <input style={inputStyle} value={sourceDescription} onChange={(e) => setSourceDescription(e.target.value)} placeholder="e.g. Site surplus return" />
            </Field>
          )}
          <Field label={needsDepartment ? 'Department *' : 'Department'}>
            <select data-tour="return-department" style={inputStyle} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">— Select —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="Reason">
            <input style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Row>
        <Field label="Remarks">
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </Section>

      <Section title="Items" style={{ marginBottom: 20 }}>
        {lines.map((line, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 4, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Item</label>
              <div {...(idx === 0 ? { 'data-tour': 'return-item' } : {})}>
                <SearchableSelect value={line.itemId} onChange={(v) => updateLine(idx, { itemId: v })} placeholder="Search item code or name…"
                  options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
              </div>
            </div>
            <div style={{ flex: '0 0 110px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Quantity</label>
              <input {...(idx === 0 ? { 'data-tour': 'return-quantity' } : {})} type="number" style={inputStyle} value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
            </div>
            <div style={{ flex: '0 0 240px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Condition</label>
              <select {...(idx === 0 ? { 'data-tour': 'return-condition' } : {})} style={inputStyle} value={line.condition} onChange={(e) => updateLine(idx, { condition: e.target.value })}>
                {conditions.map((c) => <option key={c.value} value={c.value}>{c.label} — {c.stock_effect === 'quarantine' ? 'to quarantine' : 'to usable stock'}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 0 130px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }}>Batch #</label>
              <input style={inputStyle} value={line.batchNumber} onChange={(e) => updateLine(idx, { batchNumber: e.target.value })} />
            </div>
            <button type="button" onClick={() => removeLine(idx)} disabled={lines.length === 1} style={{ ...secondaryBtnStyle, padding: '10px 14px', opacity: lines.length === 1 ? 0.4 : 1 }}>×</button>
          </div>
        ))}
        <button type="button" data-tour="return-add-item-btn" onClick={addLine} style={{ ...secondaryBtnStyle, padding: '7px 14px', fontSize: 12.5, marginTop: 8 }}>+ Add Item</button>
      </Section>

      <div data-tour="return-approval-preview" style={{ padding: '12px 16px', marginBottom: 20, borderRadius: 12, background: approvalSteps.length ? 'rgba(217,119,6,0.08)' : 'rgba(22,163,74,0.08)', border: `1px solid ${approvalSteps.length ? 'rgba(217,119,6,0.25)' : 'rgba(22,163,74,0.25)'}`, fontSize: 13, color: TEXT.body }}>
        {approvalSteps.length ? (
          <>
            <b>Needs approval before stock changes:</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {approvalSteps.map((s, i) => <li key={i}>{RULE_LABELS[s.rule]} — for {s.reasons.join(', ')}</li>)}
            </ul>
          </>
        ) : <b>No approval needed — stock updates as soon as you record this return.</b>}
        {quarantineLines > 0 && <div style={{ marginTop: 6, color: '#92400e' }}>{quarantineLines} line(s) go to quarantine, not usable stock — clear them later from the Stock page.</div>}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button data-tour="return-save-btn" disabled={busy} onClick={save} style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : approvalSteps.length ? 'Submit for Approval' : 'Record Return'}</button>
        <button disabled={busy} onClick={() => router.push('/dashboard/store/returns')} style={{ ...secondaryBtnStyle, opacity: busy ? 0.6 : 1 }}>Cancel</button>
      </div>
    </div>
  )
}
