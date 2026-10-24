'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { organizationApi, storeApi } from '@/lib/api'
import { Department, StoreDocType, StoreItem, StoreLocation, StoreMaterialIssue } from '@/types'
import { FormPage, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import StoreNav from '@/components/store/StoreNav'
import { recordPath } from '@/lib/recordRef'
import MessageDialog from '@/components/erp/MessageDialog'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import Select from '@/components/shared/Select'

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
  const [loadErrors, setLoadErrors] = useState<string[]>([])

  // Load failures go to the error dialog with the server's reason, so an
  // empty dropdown never hides why (e.g. a Store data-access 403).
  const loadFailed = (what: string) => (err: unknown) =>
    setLoadErrors((prev) => [...prev, ...extractErrorMessages(err, 'The server did not respond — check your connection and reload the page.').map((m) => `Couldn't load ${what}: ${m}`)])

  useEffect(() => {
    if (!isAuthorized) return
    storeApi.listItems().then(setItems).catch(loadFailed('items'))
    storeApi.listLocations().then(setLocations).catch(loadFailed('stores'))
    storeApi.listMaterialIssues().then(setIssues).catch(loadFailed('material issues'))
    organizationApi.listDepartments().then(setDepartments).catch(loadFailed('departments'))
    storeApi.listDocTypes('return_source').then((s) => { setSources(s); setSourceType((v) => v || s[0]?.value || '') }).catch(loadFailed('return sources'))
    storeApi.listDocTypes('return_condition').then((c) => {
      setConditions(c)
      setLines((prev) => prev.map((l) => (l.condition ? l : { ...l, condition: c[0]?.value || '' })))
    }).catch(loadFailed('return conditions'))
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

  // Live preview of who approves by default. The actual approvers come from
  // Organization › Approval Workflows › Material return (the server routes it).
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
      router.push(recordPath('/dashboard/store/returns', ret))
    } catch (err) {
      setErrors(extractErrorMessages(err, 'Failed to create material return.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <FormPage nav={<StoreNav />} icon="undo" title="New Material Return" subtitle="Material coming back into a store — from an issue, a site or a vendor challan."
      onBack={() => router.push('/dashboard/store/returns')} backTour="return-back-btn"
      footer={<>
        <button data-tour="return-cancel-btn" type="button" disabled={busy} onClick={() => router.push('/dashboard/store/returns')} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button data-tour="return-save-btn" type="button" disabled={busy} onClick={save} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name={approvalSteps.length ? 'send' : 'check'} size={16} />{busy ? 'Saving…' : approvalSteps.length ? 'Submit for Approval' : 'Record Return'}</button>
      </>}>
      <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Material Return" message={errors} onClose={() => setErrors([])} />
      <MessageDialog open={loadErrors.length > 0} variant="error" title="Couldn't Load Form Data" message={loadErrors} onClose={() => setLoadErrors([])} />

      <SheetColumns
        left={
          <SheetSection icon="list" title="Return Details">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={sheetLabel}>Store <Req /></label>
                <Select data-tour="return-location" style={sheetInput} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">— Select —</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={sheetLabel}>Source <Req /></label>
                <Select data-tour="return-source-type" style={sheetInput} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
                  {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
              {source?.requires_issue ? (
                <div style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>Material Issue <Req /></label>
                  <Select data-tour="return-source-issue" style={sheetInput} value={sourceIssueId} onChange={(e) => pickIssue(e.target.value)}>
                    <option value="">— Select —</option>
                    {issues.map((i) => <option key={i.id} value={i.id}>{i.issue_number}{i.department_name ? ` — ${i.department_name}` : ''}</option>)}
                  </Select>
                </div>
              ) : (
                <div style={{ flex: '1 1 200px' }}>
                  <label style={sheetLabel}>Source Description</label>
                  <input data-tour="return-source-description" style={sheetInput} value={sourceDescription} onChange={(e) => setSourceDescription(e.target.value)} placeholder="e.g. Site surplus return" />
                </div>
              )}
              <div style={{ flex: '1 1 200px' }}>
                <label style={sheetLabel}>Department {needsDepartment ? <Req /> : <Optional />}</label>
                <Select data-tour="return-department" style={sheetInput} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">— Select —</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </div>
            </div>
            <label style={{ ...sheetLabel, marginTop: 14 }}>Reason <Optional /></label>
            <input data-tour="return-reason" style={sheetInput} value={reason} onChange={(e) => setReason(e.target.value)} />
          </SheetSection>
        }
        right={<>
          <SheetSection icon="shield" title="Approval">
            <div data-tour="return-approval-preview" style={{ padding: '12px 14px', borderRadius: 12, background: approvalSteps.length ? 'rgba(217,119,6,0.08)' : 'rgba(22,163,74,0.08)', border: `1px solid ${approvalSteps.length ? 'rgba(217,119,6,0.25)' : 'rgba(22,163,74,0.25)'}`, fontSize: 13, color: SHEET.BODY }}>
              {approvalSteps.length ? (
                <>
                  <b>Needs approval before stock changes</b> (default routing — an admin can change it in Organization › Approval Workflows):
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {approvalSteps.map((s, i) => <li key={i}>{RULE_LABELS[s.rule]} — for {s.reasons.join(', ')}</li>)}
                  </ul>
                </>
              ) : <b>No approval needed — stock updates as soon as you record this return.</b>}
              {quarantineLines > 0 && <div style={{ marginTop: 6, color: '#92400e' }}>{quarantineLines} line(s) go to quarantine, not usable stock — clear them later from the Stock page.</div>}
            </div>
          </SheetSection>
          <SheetSection icon="chat" title="Remarks" extra={<Optional />}>
            <textarea data-tour="return-remarks" style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </SheetSection>
        </>}
      />

      <div style={{ padding: '20px 24px', borderTop: `1px solid ${SHEET.LINE}` }}>
        <SheetSection icon="box" title="Items">
          {lines.map((line, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 260px' }}>
                {idx === 0 && <label style={sheetLabel}>Item <Req /></label>}
                <div {...(idx === 0 ? { 'data-tour': 'return-item' } : {})}>
                  <SearchableSelect value={line.itemId} onChange={(v) => updateLine(idx, { itemId: v })} placeholder="Search item code or name…"
                    options={items.map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
                </div>
              </div>
              <div style={{ flex: '0 0 120px' }}>
                {idx === 0 && <label style={sheetLabel}>Quantity <Req /></label>}
                <input {...(idx === 0 ? { 'data-tour': 'return-quantity' } : {})} type="number" style={sheetInput} value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
              </div>
              <div style={{ flex: '0 0 250px' }}>
                {idx === 0 && <label style={sheetLabel}>Condition</label>}
                <Select {...(idx === 0 ? { 'data-tour': 'return-condition' } : {})} style={sheetInput} value={line.condition} onChange={(e) => updateLine(idx, { condition: e.target.value })}>
                  {conditions.map((c) => <option key={c.value} value={c.value}>{c.label} — {c.stock_effect === 'quarantine' ? 'to quarantine' : 'to usable stock'}</option>)}
                </Select>
              </div>
              <div style={{ flex: '0 0 140px' }}>
                {idx === 0 && <label style={sheetLabel}>Batch #</label>}
                <input {...(idx === 0 ? { 'data-tour': 'return-batch' } : {})} style={sheetInput} value={line.batchNumber} onChange={(e) => updateLine(idx, { batchNumber: e.target.value })} />
              </div>
              <button type="button" aria-label="Remove line" {...(idx === 0 ? { 'data-tour': 'return-remove-line-btn' } : {})} onClick={() => removeLine(idx)} disabled={lines.length === 1}
                style={{ ...sheetBtn('secondary', SHEET.INK, lines.length === 1), padding: 0, width: 38, height: 38, justifyContent: 'center', flex: 'none' }}><SheetIcon name="trash" size={15} /></button>
            </div>
          ))}
          <button type="button" data-tour="return-add-item-btn" onClick={addLine} style={sheetBtn('ghost', SHEET.BLUE)}><SheetIcon name="plus" size={15} />Add Item</button>
        </SheetSection>
      </div>
    </FormPage>
  )
}
