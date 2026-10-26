'use client'

import Select from '@/components/shared/Select'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { designApi } from '@/lib/api'
import { DesignLookupOption, DesignMilestoneEvidence, DesignRequest, DesignRequestDeliverable } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import DateField from '@/components/erp/DateField'
import { primaryBtnStyle, smallSecondaryBtnStyle, chipBtnStyle, RowCount, pillStyle } from '@/components/shared/ui'
import { PRIORITY_LABELS, REQUEST_SOURCE_LABELS, REQUEST_STATUS_LABELS, toOptions } from '@/components/design/designMeta'
import { FormSheet, SheetColumns, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'
import OrderProjectPicker, { OrderProjectChip, OrderProjectValue } from '@/components/sales/OrderProjectPicker'

// Requests tab: work brought to Design (BD / project / R&D / internal),
// the milestone evidence Design submits to Project Management, and the
// Project Management milestone/task workflow for this department.

const STATUS_HEX: Record<string, string> = {
  open: '#2563EB', accepted: '#7C3AED', in_progress: '#0f766e', on_hold: '#b45309', completed: '#16A34A', cancelled: '#a8a29e',
}
const PRIORITY_HEX: Record<string, string> = { low: '#78716c', medium: '#2563EB', high: '#b45309', urgent: '#DC2626' }
const DELIVERABLE_HEX: Record<string, string> = {
  draft: '#78716c', in_review: '#2563EB', in_approval: '#7C3AED', approved: '#0891b2', released: '#16A34A', revising: '#0f766e',
  obsolete: '#DC2626', customer_rejected: '#DC2626',
}

const MILESTONE_STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', submitted: 'Submitted', achieved: 'Achieved', cancelled: 'Cancelled',
}
const MILESTONE_STATUS_HEX: Record<string, string> = {
  not_started: '#78716c', in_progress: '#2563EB', submitted: '#7C3AED', achieved: '#16A34A', cancelled: '#a8a29e',
}

const STATUS_FILTERS = [
  { key: 'open,accepted,in_progress,on_hold', label: 'Active' },
  { key: 'open', label: 'Open' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'on_hold', label: 'On hold' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: '', label: 'All' },
]

const filterInput: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 14px' }
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }
const smallLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }

function badge(label: string, hex: string) {
  return (
    <span style={pillStyle(hex)}>{label}</span>
  )
}

const EMPTY_FORM = {
  title: '', source: 'project', crm_source: 'inquiry', crm_record_id: '', customer_id: '', pm_project_id: '', pm_milestone_id: '',
  requirement: '', priority: 'medium', due_date: '', lead_designer_id: '',
  order_project: null as OrderProjectValue | null,
}

export default function DesignRequestsPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()

  const [requests, setRequests] = useState<DesignRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | string[]>('')
  const [statusFilter, setStatusFilter] = useState(STATUS_FILTERS[0].key)
  const [sourceFilter, setSourceFilter] = useState('')
  const [waitingFilter, setWaitingFilter] = useState('')
  const [mine, setMine] = useState(false)
  const [search, setSearch] = useState('')
  const [opFilter, setOpFilter] = useState<OrderProjectValue | null>(null)
  const [reload, setReload] = useState(0)

  const [milestones, setMilestones] = useState<DesignMilestoneEvidence[]>([])
  const [milestonesLoading, setMilestonesLoading] = useState(true)
  const [milestoneError, setMilestoneError] = useState<string | string[]>('')
  const [includeClosed, setIncludeClosed] = useState(false)

  // Create form
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [formError, setFormError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [customers, setCustomers] = useState<DesignLookupOption[]>([])
  const [crmRecords, setCrmRecords] = useState<DesignLookupOption[]>([])
  const [milestoneOptions, setMilestoneOptions] = useState<DesignLookupOption[]>([])
  const [lookupsLoaded, setLookupsLoaded] = useState(false)

  useEffect(() => {
    if (!isAuthorized) return
    const params: Record<string, unknown> = {}
    if (statusFilter) params.status = statusFilter
    if (sourceFilter) params.source = sourceFilter
    if (waitingFilter) params.waiting_on = waitingFilter
    if (mine) params.mine = true
    if (search.trim()) params.search = search.trim()
    if (opFilter) params.order_project_id = opFilter.projectId
    const handle = setTimeout(() => {
      setLoading(true)
      designApi.listRequests(params)
        .then((data) => { setRequests(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load design requests.')))
        .finally(() => setLoading(false))
    }, search ? 250 : 0)
    return () => clearTimeout(handle)
  }, [isAuthorized, statusFilter, sourceFilter, waitingFilter, mine, search, opFilter, reload])

  useEffect(() => {
    if (!isAuthorized) return
    designApi.listMilestones(includeClosed)
      .then((data) => { setMilestones(Array.isArray(data) ? data : []); setMilestoneError('') })
      .catch((err) => setMilestoneError(extractErrorMessages(err, 'Failed to load design WBS elements.')))
      .finally(() => setMilestonesLoading(false))
  }, [isAuthorized, includeClosed])

  // Form lookups load the first time the form opens.
  useEffect(() => {
    if (!isAuthorized || !formOpen || lookupsLoaded) return
    Promise.all([designApi.lookupUsers(), designApi.lookupProjects(), designApi.lookupCustomers()])
      .then(([u, p, c]) => { setUsers(u); setProjects(p); setCustomers(c); setLookupsLoaded(true) })
      .catch((err) => setFormError(extractErrorMessages(err, 'Failed to load the form options.')))
  }, [isAuthorized, formOpen, lookupsLoaded])

  // CRM inquiries / tenders for BD requests.
  useEffect(() => {
    if (!isAuthorized || !formOpen || form.source !== 'bd') return
    designApi.lookupCrmRecords(form.crm_source as 'inquiry' | 'tender')
      .then(setCrmRecords)
      .catch((err) => setFormError(extractErrorMessages(err, `Failed to load CRM ${form.crm_source}s.`)))
  }, [isAuthorized, formOpen, form.source, form.crm_source])

  // Milestones of the chosen project.
  useEffect(() => {
    if (!isAuthorized || !form.pm_project_id) return
    designApi.lookupMilestones(Number(form.pm_project_id))
      .then(setMilestoneOptions)
      .catch((err) => setFormError(extractErrorMessages(err, 'Failed to load the project\'s WBS elements.')))
  }, [isAuthorized, form.pm_project_id])

  // Role "Assign to" rule (Role & Permissions › Design › Requests › Accept & progress): who may be lead designer.
  const allowLead = useAssigneeFilter('design:project_work.request_progress')
  const userOptions = useMemo(() => toOptions(users.filter((u) => allowLead(u.id)).map((u) => ({ id: u.id, label: u.code ? `${u.label} — ${u.code}` : u.label })), 'Not assigned yet'), [users, allowLead])

  if (isLoading || !isAuthorized) return null

  const set = (patch: Partial<typeof EMPTY_FORM>) => setForm((f) => ({ ...f, ...patch }))

  const pickCrmRecord = (value: string) => {
    const rec = crmRecords.find((r) => String(r.id) === value)
    // The inquiry/tender's organisation becomes the customer unless one is already picked.
    const orgId = rec?.extra && /^\d+$/.test(rec.extra) ? rec.extra : ''
    set({ crm_record_id: value, customer_id: form.customer_id || orgId })
  }

  const createRequest = async () => {
    setFormError('')
    if (form.title.trim().length < 3) { setFormError('Give the request a title (at least 3 characters).'); return }
    if (form.requirement.trim().length < 5) { setFormError('Describe the technical requirement (at least 5 characters) — this is what Design works to.'); return }
    if (form.pm_milestone_id && !form.pm_project_id) { setFormError('Pick the project before its WBS.'); return }
    setSaving(true)
    try {
      const created = await designApi.createRequest({
        title: form.title.trim(),
        source: form.source,
        crm_source: form.source === 'bd' && form.crm_record_id ? form.crm_source : null,
        crm_record_id: form.source === 'bd' && form.crm_record_id ? Number(form.crm_record_id) : null,
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        pm_project_id: form.pm_project_id ? Number(form.pm_project_id) : null,
        pm_milestone_id: form.pm_milestone_id ? Number(form.pm_milestone_id) : null,
        requirement: form.requirement.trim(),
        priority: form.priority,
        due_date: form.due_date || null,
        lead_designer_id: form.lead_designer_id ? Number(form.lead_designer_id) : null,
        order_project_id: form.order_project?.projectId ?? null,
        order_project_element_id: form.order_project?.elementId ?? null,
      })
      router.push(recordPath('/dashboard/design/requests', created))
    } catch (err) {
      setFormError(extractErrorMessages(err, 'Creating the design request failed.'))
      setSaving(false)
    }
  }

  const deliverableChip = (d: DesignRequestDeliverable) => {
    const hex = DELIVERABLE_HEX[d.status] || '#78716c'
    return (
      <span key={`${d.kind}-${d.id}`} onClick={() => router.push(d.kind === 'bom' ? recordPath('/dashboard/design/boms', d) : recordPath('/dashboard/design/documents', d))}
        title={d.title}
        style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 9999, margin: '0 6px 6px 0', cursor: 'pointer', background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
        {d.number}{d.released_revision_label ? ` ${d.released_revision_label}` : ''}
      </span>
    )
  }

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Requests</h1>
          <p style={{ fontSize: 13.5, color: TEXT.muted, margin: 0 }}>
            Work brought to Design by BD, projects and R&amp;D, the evidence for each design WBS, and your Project Management WBS elements and tasks.
          </p>
        </div>
        <button
          type="button"
          data-tour="design-req-new-btn"
          onClick={() => { setForm({ ...EMPTY_FORM }); setFormError(''); setFormOpen(true) }}
          style={primaryBtnStyle}
        >
          + New Request
        </button>
      </div>

      {/* New request popup */}
      {formOpen && (
        <FormSheet tour="design-reqnew-form" icon="plus" title="New design request" busy={saving} onClose={() => setFormOpen(false)}
          subtitle="Record what Design is being asked to produce and to what requirement. The Design head is notified to accept it."
          footer={<>
            <button type="button" data-tour="design-reqnew-cancel-btn" disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)} onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" data-tour="design-reqnew-save-btn" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)} onClick={createRequest}>
              <SheetIcon name="check" size={16} />{saving ? 'Creating…' : 'Create Request'}
            </button>
          </>}>
          <SheetColumns
            left={<>
              <SheetError error={formError} />
              <SheetSection icon="doc" title="Request">
                <div data-tour="design-reqnew-title" style={{ marginBottom: 14 }}>
                  <label style={sheetLabel}>Title <Req /></label>
                  <input style={sheetInput} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Ballast regulator — hopper redesign for RDSO spec" autoFocus />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <div data-tour="design-reqnew-source" style={{ flex: '1 1 170px', maxWidth: 220 }}>
                    <label style={sheetLabel}>Source <Req /></label>
                    <Select style={sheetInput} value={form.source} onChange={(e) => set({ source: e.target.value, crm_record_id: '' })}>
                      {Object.entries(REQUEST_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </div>
                  <div data-tour="design-reqnew-priority" style={{ flex: '0 1 130px', minWidth: 120 }}>
                    <label style={sheetLabel}>Priority</label>
                    <Select style={sheetInput} value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
                      {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </div>
                  <div data-tour="design-reqnew-due" style={{ flex: '0 1 160px', minWidth: 150 }}>
                    <label style={sheetLabel}>Due date <Optional /></label>
                    <DateField value={form.due_date} onChange={(v) => set({ due_date: v })} />
                  </div>
                </div>
              </SheetSection>

              <SheetSection icon="list" title="Technical requirement">
                <div data-tour="design-reqnew-requirement">
                  <label style={sheetLabel}>Requirement <Req /></label>
                  <textarea style={{ ...sheetInput, minHeight: 150, resize: 'vertical' }} value={form.requirement} onChange={(e) => set({ requirement: e.target.value })}
                    placeholder="What must be designed: scope, key dimensions/loads, standards (RDSO/IS/EN), customer specification references, interfaces, deliverables expected…" />
                  <p style={sheetHint}>Later changes are made as revisions with a change note — the lead designer is asked to review each one.</p>
                </div>
              </SheetSection>
            </>}
            right={<>
              {form.source === 'bd' && (
                <SheetSection icon="tag" title="CRM reference">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <div data-tour="design-reqnew-crm-kind" style={{ flex: '0 1 120px', minWidth: 110 }}>
                      <label style={sheetLabel}>Record</label>
                      <Select style={sheetInput} value={form.crm_source} onChange={(e) => set({ crm_source: e.target.value, crm_record_id: '' })}>
                        <option value="inquiry">Inquiry</option>
                        <option value="tender">Tender</option>
                      </Select>
                    </div>
                    <div data-tour="design-reqnew-crm-record" style={{ flex: '1 1 160px', minWidth: 0 }}>
                      <label style={sheetLabel}>{form.crm_source === 'tender' ? 'Tender' : 'Inquiry'} <Optional /></label>
                      <SearchableSelect value={form.crm_record_id} onChange={pickCrmRecord} options={toOptions(crmRecords, 'None')} placeholder={`Select ${form.crm_source}…`} />
                    </div>
                  </div>
                  <p style={sheetHint}>Its customer is filled in automatically.</p>
                </SheetSection>
              )}

              <SheetSection icon="link" title="Links">
                <div data-tour="design-reqnew-order-project" style={{ marginBottom: 14 }}>
                  <label style={sheetLabel}>Order project <Optional /></label>
                  <OrderProjectPicker value={form.order_project} requireElement={false} onChange={(v) => set({ order_project: v })} />
                  <p style={sheetHint}>The confirmed sales order this design is for — pick a vehicle for a vehicle-specific variant.</p>
                </div>
                <div data-tour="design-reqnew-customer" style={{ marginBottom: 14 }}>
                  <label style={sheetLabel}>Customer <Optional /></label>
                  <SearchableSelect value={form.customer_id} onChange={(v) => set({ customer_id: v })} options={toOptions(customers, 'None')} placeholder="Select customer…" />
                </div>
                <div data-tour="design-reqnew-project" style={{ marginBottom: 14 }}>
                  <label style={sheetLabel}>Project <Optional /></label>
                  <SearchableSelect value={form.pm_project_id} onChange={(v) => { setMilestoneOptions([]); set({ pm_project_id: v, pm_milestone_id: '' }) }} options={toOptions(projects, 'None')} placeholder="Select project…" />
                </div>
                <div data-tour="design-reqnew-milestone">
                  <label style={sheetLabel}>WBS <Optional /></label>
                  <SearchableSelect value={form.pm_milestone_id} onChange={(v) => set({ pm_milestone_id: v })} options={toOptions(milestoneOptions, 'None')}
                    placeholder={form.pm_project_id ? 'Select WBS…' : 'Pick a project first'} disabled={!form.pm_project_id} />
                </div>
              </SheetSection>

              <SheetSection icon="user" title="Lead designer">
                <div data-tour="design-reqnew-lead">
                  <SearchableSelect value={form.lead_designer_id} onChange={(v) => set({ lead_designer_id: v })} options={userOptions} placeholder="Select designer…" />
                  <p style={sheetHint}>Optional — the Design head can assign this when accepting.</p>
                </div>
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {/* Requests register */}
      <div data-tour="design-reqs-status-tabs" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map((t) => {
          const active = statusFilter === t.key
          return (
            <button key={t.label} type="button" onClick={() => setStatusFilter(t.key)} style={chipBtnStyle(active)}>
              {t.label}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input data-tour="design-reqs-search" style={{ ...filterInput, flex: '1 1 260px', minWidth: 200, maxWidth: 400 }} placeholder="Search by request number, title or CRM reference…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select data-tour="design-reqs-source" style={{ ...filterInput, flex: '0 1 170px' }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">All sources</option>
          {Object.entries(REQUEST_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select data-tour="design-reqs-waiting" style={{ ...filterInput, flex: '0 1 190px' }} value={waitingFilter} onChange={(e) => setWaitingFilter(e.target.value)}>
          <option value="">Waiting on anyone</option>
          <option value="design">Waiting on Design</option>
          <option value="requester">Waiting on requester</option>
        </Select>
        <div data-tour="design-reqs-order-project" style={{ flex: '0 1 280px', minWidth: 220 }}>
          <OrderProjectPicker value={opFilter} requireElement={false} placeholder="All order projects" onChange={(v) => setOpFilter(v ? { projectId: v.projectId, elementId: null } : null)} />
        </div>
        <label data-tour="design-reqs-mine" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT.secondary, cursor: 'pointer' }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine (lead / raised by me)
        </label>
        <span style={{ fontSize: 12, color: TEXT.muted }}>{loading ? '' : `${requests.length} request${requests.length === 1 ? '' : 's'}`}</span>
        <span style={{ flex: 1 }} />
        <button type="button" data-tour="design-reqs-refresh-btn" style={{ ...smallSecondaryBtnStyle }} onClick={() => setReload((n) => n + 1)}>Refresh</button>
      </div>

      <div data-tour="design-reqs-table" style={{
        borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
        border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 320px)', marginBottom: 24,
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1320 }}>
          <thead>
            <tr>
              {['Request', 'Title', 'Source', 'Customer / CRM', 'Project / WBS', 'Lead Designer', 'Due', 'Waiting On', 'Status', 'Deliverables', ''].map((h, hi) => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap' }}>
                  {h}{hi === 0 && <RowCount count={requests.length} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
            ) : requests.length === 0 ? (
              <tr><td colSpan={11} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
                No design requests match these filters.{statusFilter !== '' && ' Try the “All” tab.'}
              </td></tr>
            ) : (
              requests.map((r) => (
                <tr key={r.id} onClick={() => router.push(recordPath('/dashboard/design/requests', r))} style={{ cursor: 'pointer' }}>
                  <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>
                    {r.request_number}
                    <div style={{ marginTop: 4 }}>{badge(PRIORITY_LABELS[r.priority] || r.priority, PRIORITY_HEX[r.priority] || '#78716c')}</div>
                  </td>
                  <td style={{ ...cellStyle, maxWidth: 280 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                    {r.changed_since_review && (
                      <span style={{ ...pillStyle('#DC2626'), marginTop: 4 }}>
                        Requirement changed · rev {r.requirement_revision}
                      </span>
                    )}
                  </td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{REQUEST_SOURCE_LABELS[r.source] || r.source}</td>
                  <td style={{ ...cellStyle, maxWidth: 220 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.customer_name || '—'}</div>
                    {r.crm_reference && <div style={{ fontSize: 11.5, color: TEXT.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.crm_reference}</div>}
                  </td>
                  <td style={{ ...cellStyle, maxWidth: 240 }}>
                    {r.order_project_number && <div style={{ marginBottom: 4 }}><OrderProjectChip opNumber={r.order_project_number} elementNo={r.order_project_element_no} label={r.order_project_element_label} /></div>}
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.pm_project_label || r.erp_project_label || (r.order_project_number ? '' : '—')}</div>
                    {r.pm_milestone_label && <div style={{ fontSize: 11.5, color: TEXT.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.pm_milestone_label}</div>}
                  </td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{r.lead_designer_name || <span style={{ color: '#b45309' }}>Not assigned</span>}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap', color: r.is_overdue ? '#DC2626' : TEXT.body, fontWeight: r.is_overdue ? 700 : 400 }}>
                    {r.due_date ? formatDate(r.due_date) : '—'}{r.is_overdue && <div style={{ fontSize: 11 }}>overdue</div>}
                  </td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                    {['completed', 'cancelled'].includes(r.status) ? <span style={{ color: TEXT.muted }}>—</span>
                      : r.waiting_on === 'design' ? badge('Design', '#2563EB') : badge('Requester', '#b45309')}
                  </td>
                  <td style={cellStyle}>{badge(REQUEST_STATUS_LABELS[r.status] || r.status, STATUS_HEX[r.status] || '#78716c')}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                    {r.document_count ? <><strong>{r.released_count}</strong> / {r.document_count} released</> : <span style={{ color: TEXT.muted }}>none yet</span>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={cellStyle}>
                    <span onClick={() => router.push(recordPath('/dashboard/design/requests', r))} style={{ fontSize: 12, fontWeight: 600, color: '#FF6A2A', cursor: 'pointer' }}>View</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Design milestones — evidence for the milestone submission */}
      <div data-tour="design-reqs-milestones" style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
          <p style={{ ...sectionTitle, margin: 0, flex: 1 }}>Design WBS elements</p>
          <label data-tour="design-reqs-include-closed" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: TEXT.secondary, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeClosed} onChange={(e) => { setMilestonesLoading(true); setIncludeClosed(e.target.checked) }} /> Include closed
          </label>
        </div>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px' }}>
          Released drawings and BOMs are the evidence when you submit a WBS in Project Management. Pending documents and open customer approvals hold it back.
        </p>
        {milestoneError && (
          <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {Array.isArray(milestoneError) ? milestoneError.join(' ') : milestoneError}
          </div>
        )}
        {milestonesLoading ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
        ) : milestones.length === 0 ? (
          <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No Design WBS elements{includeClosed ? '' : ' open'} in Project Management.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {milestones.map((m) => {
              const released = [...m.released_documents, ...m.released_boms]
              const ready = m.pending_documents.length === 0 && m.customer_approvals_pending === 0 && released.length > 0
              const overdue = !!m.target_date && new Date(m.target_date + 'T23:59:59') < new Date() && !['submitted', 'achieved', 'cancelled'].includes(m.status)
              return (
                <div key={m.milestone_id} style={{ padding: '12px 14px', borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,.55)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                    <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                      <p style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{m.milestone_title}</p>
                      <p style={{ fontSize: 12, color: TEXT.muted, margin: 0 }}>{m.project_label || '—'}</p>
                    </div>
                    <span style={{ fontSize: 12.5, color: overdue ? '#DC2626' : TEXT.secondary, fontWeight: overdue ? 700 : 500 }}>
                      Target {m.target_date ? formatDate(m.target_date) : '—'}{overdue ? ' · overdue' : ''}
                    </span>
                    {badge(MILESTONE_STATUS_LABELS[m.status] || m.status, MILESTONE_STATUS_HEX[m.status] || '#78716c')}
                    {ready ? badge('Evidence complete', '#16A34A') : null}
                  </div>
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <p style={smallLabel}>Released drawings &amp; BOMs · {released.length}</p>
                      {released.length ? released.map(deliverableChip) : <span style={{ fontSize: 12.5, color: TEXT.muted }}>None yet</span>}
                    </div>
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <p style={smallLabel}>Pending documents · {m.pending_documents.length}</p>
                      {m.pending_documents.length ? m.pending_documents.map(deliverableChip) : <span style={{ fontSize: 12.5, color: TEXT.muted }}>None</span>}
                    </div>
                    <div style={{ flex: '0 1 200px' }}>
                      <p style={smallLabel}>Customer approvals pending</p>
                      <span style={{ fontSize: 14, fontWeight: 700, color: m.customer_approvals_pending ? '#b45309' : '#16A34A' }}>{m.customer_approvals_pending}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
