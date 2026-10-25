'use client'

import Select from '@/components/shared/Select'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useRequireOrgTab } from '@/app/dashboard/organization/_lib/useRequireOrgTab'
import { useCan } from '@/lib/permissions'
import { approvalsApi, usersApi } from '@/lib/api'
import { ApprovalStageDef, ApprovalTransactionType, ApprovalWorkflowCheck, ApprovalWorkflowDef, ApprovalWorkflowMeta, DirectoryUser } from '@/types'
import { BORDER, TEXT } from '@/lib/theme'
import { FormPage, SheetSection, SheetIcon, SheetIconName, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import OrganizationNav from '@/components/organization/OrganizationNav'
import UserChipsPicker from '@/components/organization/UserChipsPicker'
import Checkbox from '@/components/Checkbox'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'
import { formatDateTime } from '@/lib/format'
import { chipBtnStyle, smallSecondaryBtnStyle } from '@/components/shared/ui'

// Blocks inside the FormPage body (plain white cards — no glass inside the page sheet).
const cardStyle: React.CSSProperties = {
  borderRadius: 14, background: '#fff', border: `1px solid ${SHEET.LINE}`, padding: 16, marginBottom: 14,
}
const hint: React.CSSProperties = { ...sheetHint, fontSize: 11.5, margin: '4px 0 0' }
const inputStyle = sheetInput
const subHead: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '14px 0 6px' }
const linkBtn = (color: string, disabled = false): React.CSSProperties => ({ fontSize: 12, fontWeight: 600, color: disabled ? '#94A3B8' : color, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1, background: 'none', border: 'none', padding: '3px 2px', minHeight: 24 })

const LEVEL = {
  error: { label: 'Must fix', color: '#b91c1c', bg: 'rgba(220,38,38,0.08)', border: 'rgba(220,38,38,0.25)' },
  warning: { label: 'Weak control', color: '#92400e', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)' },
  info: { label: 'Suggestion', color: '#1e40af', bg: 'rgba(59,130,246,0.07)', border: 'rgba(59,130,246,0.2)' },
} as const

const blankStage = (): ApprovalStageDef => ({
  name: '', approver_rule: 'department_head', rule_config: {}, approval_mode: 'any', conditions: [],
  skip_if_no_approver: false, escalate_after_hours: null, escalation_rule: null, escalation_config: {},
})

// Ready-made starting points. Applying one replaces the stages on screen
// (nothing is saved until "Save workflow"); every field stays editable.
type Template = { id: string; label: string; help: string; needsAmount?: boolean; stages: (amount: number) => ApprovalStageDef[] }
const esc = (hours: number, rule: string) => ({ escalate_after_hours: hours, escalation_rule: rule, escalation_config: {} })
const stage = (name: string, approver_rule: string, extra: Partial<ApprovalStageDef> = {}): ApprovalStageDef => ({ ...blankStage(), name, approver_rule, ...extra })
const overAmount = (amount: number) => [{ field: 'amount', op: 'gt', value: amount }]
const TEMPLATES: Template[] = [
  { id: 'dept', label: 'Department head', help: 'One check by the requester’s department head; escalates to their manager after 48 h.',
    stages: () => [stage('Department head', 'department_head', esc(48, 'approver_manager'))] },
  { id: 'dept_partner', label: 'Department head, then a Partner above an amount', needsAmount: true,
    help: 'Every document: department head. Above the amount: also any one Partner.',
    stages: (a) => [stage('Department head', 'department_head', esc(48, 'approver_manager')), stage('Partner (final approval)', 'partner', { conditions: overAmount(a) })] },
  { id: 'purchase_partner', label: 'Purchase head, then a Partner above an amount', needsAmount: true,
    help: 'Every document: anyone flagged Purchase head. Above the amount: also any one Partner. Purchase head escalates to the Partners after 48 h.',
    stages: (a) => [stage('Purchase head', 'user_flag', { rule_config: { flag: 'is_purchase_head' }, ...esc(48, 'partner') }), stage('Partner (final approval)', 'partner', { conditions: overAmount(a) })] },
  { id: 'manager_dept', label: 'Reporting manager, then department head',
    help: 'Two checks on every document: the requester’s manager, then their department head.',
    stages: () => [stage('Reporting manager', 'reporting_manager', esc(48, 'department_head')), stage('Department head', 'department_head', esc(48, 'partner'))] },
  { id: 'partner', label: 'Any one Partner', help: 'A single final approval by any Partner.',
    stages: () => [stage('Partner (final approval)', 'partner')] },
]

type Preview = { sequence: number; name: string; approval_mode: string; approvers: { id: number; name: string }[]; problem?: string | null; skipped: boolean }[]
type History = { id: number; summary: string | null; performed_by: string; performed_at: string | null }[]

/** Field with the sheet's label style. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={sheetLabel}>{label}</label>
      {children}
    </div>
  )
}

/** A numbered section of the editor: heading + one-line help, then its content. */
function Step({ n, icon, title, help, children }: { n: number; icon: SheetIconName; title: string; help: string; children: React.ReactNode }) {
  return (
    <SheetSection icon={icon} title={`${n}. ${title}`}>
      <p style={{ ...sheetHint, margin: '-6px 0 12px' }}>{help}</p>
      {children}
    </SheetSection>
  )
}

export default function WorkflowEditorPage() {
  const { isAuthorized, isLoading } = useRequireOrgTab('workflows')
  const { can, canFeature, user: me } = useCan()
  // Switches that remove an approval control are admin-only (the server refuses anyone else).
  const isAdminUser = !!me && (me.role === 'admin' || !!(me as { is_azure_admin?: boolean }).is_azure_admin)
  // Workflow features (core/features/organization.py): check & preview, reset, change history.
  const maySimulate = canFeature('organization', 'workflows', 'simulate', 'view')
  const mayReset = canFeature('organization', 'workflows', 'reset', 'edit')
  const seeHistory = canFeature('organization', 'workflows', 'history', 'view')
  const router = useRouter()
  const key = decodeURIComponent(String(useParams().key))
  const [type, setType] = useState<ApprovalTransactionType | null>(null)
  const [wf, setWf] = useState<ApprovalWorkflowDef | null>(null)
  const [meta, setMeta] = useState<ApprovalWorkflowMeta | null>(null)
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [askReset, setAskReset] = useState(false)
  const [saveConfirm, setSaveConfirm] = useState<{ title: string; message: string; label: string } | null>(null)
  const [blockers, setBlockers] = useState<string[]>([])
  const [pvUser, setPvUser] = useState<number[]>([])
  const [pvCtx, setPvCtx] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [check, setCheck] = useState<ApprovalWorkflowCheck | null>(null)
  const [checkError, setCheckError] = useState('')
  const [checking, setChecking] = useState(false)
  const [history, setHistory] = useState<History | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [tplId, setTplId] = useState('')
  const [tplAmount, setTplAmount] = useState('1000000')
  const [askTemplate, setAskTemplate] = useState(false)
  const stageRefs = useRef<(HTMLDivElement | null)[]>([])
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  // JSON snapshot of the workflow as last loaded / saved / reset; the screen is dirty when it differs.
  const [baseline, setBaseline] = useState<string | null>(null)
  const [leaveTo, setLeaveTo] = useState<string | null>(null)
  const [removeStageAt, setRemoveStageAt] = useState<number | null>(null)

  const payloadOf = (w: ApprovalWorkflowDef) => ({
    stages: w.stages, is_active: w.is_active, allow_self_approval: w.allow_self_approval,
    distinct_approvers: w.distinct_approvers, require_permission: w.require_permission,
  })
  const snapOf = (w: ApprovalWorkflowDef) => JSON.stringify(payloadOf(w))
  const dirty = !!wf && baseline !== null && snapOf(wf) !== baseline

  useEffect(() => {
    if (!isAuthorized) return
    let alive = true
    setLoadError('')
    Promise.all([approvalsApi.getWorkflow(key), approvalsApi.workflowMeta(), usersApi.directory()])
      .then(([w, m, dir]) => {
        if (!alive) return
        setType(w.type); setWf(w.workflow); setBaseline(snapOf(w.workflow)); setMeta(m); setUsers(dir)
      })
      .catch((e) => { if (alive) setLoadError(extractErrorMessages(e, 'Check your connection and try again.').join(' ')) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, key, reloadTick])

  // Closing the tab or reloading while edits are unsaved.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // Clicks on any in-app link (sidebar, Organization nav, ...) while edits are unsaved: ask first.
  // Capture phase on document runs before Next's Link handler; the link is only stopped, not changed.
  useEffect(() => {
    if (!dirty) return
    const h = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      const here = window.location
      if (url.pathname === here.pathname && url.search === here.search) return
      e.preventDefault(); e.stopPropagation()
      setLeaveTo(url.pathname + url.search + url.hash)
    }
    document.addEventListener('click', h, true)
    return () => document.removeEventListener('click', h, true)
  }, [dirty])

  // Re-check the setup as it is edited (debounced) — problems show before saving.
  useEffect(() => {
    if (!wf || !maySimulate) return
    const t = setTimeout(async () => {
      setChecking(true)
      try {
        setCheck(await approvalsApi.checkWorkflow(key, payloadOf(wf)))
        setCheckError('')
      } catch (e) {
        // An incomplete stage (no name yet, no role picked…) — say what, keep the last result.
        setCheckError(extractErrorMessages(e, 'Could not check this setup.').join(' '))
      } finally {
        setChecking(false)
      }
    }, 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf, key])

  if (isLoading || !isAuthorized) return null
  const readOnly = !can('organization', 'workflows', 'edit')

  const setStage = (i: number, patch: Partial<ApprovalStageDef>) =>
    setWf((w) => (w ? { ...w, stages: w.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : w))
  const moveStage = (i: number, d: -1 | 1) => setWf((w) => {
    if (!w) return w
    const st = [...w.stages]
    const j = i + d
    if (j < 0 || j >= st.length) return w
    ;[st[i], st[j]] = [st[j], st[i]]
    return { ...w, stages: st }
  })

  const errorsFor = (i: number | null) => (check?.issues || []).filter((x) => x.stage === i && x.level === 'error').length
  const totalErrors = (check?.issues || []).filter((x) => x.level === 'error').length

  const doSave = async () => {
    if (!wf) return
    setSaveConfirm(null)
    setSaving(true); setError('')
    try {
      const out = await approvalsApi.saveWorkflow(key, payloadOf(wf))
      setWf(out.workflow)
      setBaseline(snapOf(out.workflow))
      setHistory(null)
      setPreview(null)
      setCheckError('')
      setNotice('Workflow saved. It applies to documents submitted from now on; documents already waiting keep their approvers.')
    } catch (e) {
      setError(extractErrorMessages(e, 'Could not save the workflow.').join(' '))
    } finally {
      setSaving(false)
    }
  }
  // Save first runs the setup check on what is on screen NOW (not the debounced
  // result, which can be a moment old): mistakes in the workflow itself stop the
  // save; people-dependent errors and weak controls ask for a confirmation.
  const save = async () => {
    if (!wf) return
    if (!maySimulate) { doSave(); return }
    setSaving(true); setError('')
    let result: ApprovalWorkflowCheck
    try {
      result = await approvalsApi.checkWorkflow(key, payloadOf(wf))
      setCheck(result); setCheckError('')
    } catch (e) {
      setSaving(false)
      setError(extractErrorMessages(e, 'The setup could not be checked, so nothing was saved.').join(' '))
      return
    }
    setSaving(false)
    const block = result.issues.filter((x) => x.blocking)
    if (block.length) { setBlockers(block.map((x) => x.message)); return }
    const errors = result.issues.filter((x) => x.level === 'error')
    const warnings = result.issues.filter((x) => x.level === 'warning')
    if (errors.length) {
      setSaveConfirm({ title: 'Save with problems?', label: 'Save anyway',
        message: `The setup check found ${errors.length} problem(s) marked "Must fix" — the people listed there would be refused when they submit. Fix them first (see section 3), or save anyway if you are fixing the people's setup next.` })
    } else if (warnings.length) {
      setSaveConfirm({ title: 'Save with weak controls?', label: 'Save anyway',
        message: `The setup check raised ${warnings.length} warning(s), e.g. "${warnings[0].message.slice(0, 160)}${warnings[0].message.length > 160 ? '…' : ''}" Save anyway, or review section 3 first?` })
    } else {
      doSave()
    }
  }
  const reset = async () => {
    setAskReset(false)
    try {
      const out = await approvalsApi.resetWorkflow(key)
      setWf(out.workflow)
      setBaseline(snapOf(out.workflow))
      setHistory(null)
      setPreview(null)
      setCheckError('')
      setNotice('Workflow reset to the module default. It is live now for documents submitted from now on; documents already waiting keep their approvers.')
    } catch (e) {
      setError(extractErrorMessages(e, 'Could not reset the workflow.').join(' '))
    }
  }
  const runPreview = async () => {
    if (!pvUser[0]) { setError('Pick the requester to preview as.'); return }
    const context: Record<string, unknown> = {}
    Object.entries(pvCtx).forEach(([k, v]) => {
      if (v === '') return
      const f = type?.context_fields[k]
      context[k] = f?.type === 'number' || f?.type === 'user' ? Number(v) : f?.type === 'bool' ? v === 'true' : v
    })
    try {
      // Previews the workflow as edited on screen, so a change can be tried before saving.
      const out = await approvalsApi.previewWorkflow(key, { requester_id: pvUser[0], context, draft: wf ? payloadOf(wf) : undefined })
      setPreview(out.stages)
    } catch (e) {
      setError(extractErrorMessages(e, 'Could not preview.').join(' '))
    }
  }
  const template = TEMPLATES.find((t) => t.id === tplId)
  const applyTemplate = () => {
    setAskTemplate(false)
    if (!wf || !template) return
    const amount = Number(tplAmount)
    if (template.needsAmount && !(amount > 0)) { setError('Enter the amount (₹) above which the Partner stage applies, e.g. 1000000 for ₹10 lakh.'); return }
    const stages = template.stages(amount)
    // Several stages → each a separate person; four-eyes always on in templates.
    setWf({ ...wf, is_active: true, stages, allow_self_approval: false, distinct_approvers: stages.length > 1 ? true : wf.distinct_approvers })
    setPreview(null)
    setNotice(`Template “${template.label}” applied on screen. Adjust anything you need, check section 3, then Save workflow — nothing is saved yet.`)
  }
  const toggleHistory = async () => {
    const next = !showHistory
    setShowHistory(next)
    if (next && history === null) {
      try { setHistory(await approvalsApi.workflowHistory(key)) } catch (e) { setError(extractErrorMessages(e, 'Could not load the change history.').join(' ')) }
    }
  }

  const fields = type ? Object.entries(type.context_fields) : []
  const userFields = fields.filter(([, f]) => f.type === 'user')

  // One line per stage for the flow diagram: who, how many must sign, when.
  const whoText = (s: ApprovalStageDef) => {
    if (!meta) return ''
    if (s.approver_rule === 'role') return `Role: ${meta.roles.find((r) => r.id === s.rule_config.role_id)?.name || '—'}`
    if (s.approver_rule === 'user_flag') return meta.approver_flags[s.rule_config.flag || ''] || 'Approval flag'
    if (s.approver_rule === 'permission') return `Holders of ${permWords(s.rule_config.permission) || '—'}`
    if (s.approver_rule === 'specific_users') return `${(s.rule_config.user_ids || []).length} named user(s)`
    return meta.approver_rules[s.approver_rule] || s.approver_rule
  }
  // Permission codes in words — "Procurement › Purchase Requisitions — Approve".
  const permWords = (code?: string) => {
    const o = meta?.approval_permission_options?.find((x) => x.value === code)
    if (o) return `${o.module} › ${o.label}`
    // Not in the picker list: show the parts in words rather than the raw code.
    return (code || '').split(':').map((x) => x.replace(/_/g, ' ')).join(' › ')
  }
  // Grouped picker options: this workflow's own module first, then the rest.
  const permGroups = () => {
    const opts = meta?.approval_permission_options || []
    const mods = Array.from(new Set(opts.map((o) => o.module_key)))
      .sort((a, b) => (a === type?.module_key ? -1 : b === type?.module_key ? 1 : 0))
    return mods.map((mk) => (
      <optgroup key={mk} label={opts.find((o) => o.module_key === mk)?.module}>
        {opts.filter((o) => o.module_key === mk).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </optgroup>
    ))
  }
  const condText = (s: ApprovalStageDef) => s.conditions.length === 0 ? 'Always'
    : s.conditions.map((c) => {
      const f = type?.context_fields[c.field]
      const shown = (Array.isArray(c.value) ? c.value : [c.value ?? '']).map((v) => f?.choice_labels?.[String(v)] || String(v)).join(', ')
      return `${f?.label || c.field} ${meta?.condition_ops[c.op] || c.op}${c.op === 'true' || c.op === 'false' ? '' : ` ${shown}`}`
    }).join(' and ')

  // The whole workflow as plain sentences — what an auditor or a new admin reads first.
  const userName = (id: number) => users.find((u) => u.id === id)?.name || 'a user who is no longer listed'
  const whoPlain = (s: ApprovalStageDef): { who: string; single: boolean } => {
    const cfg = s.rule_config
    switch (s.approver_rule) {
      case 'reporting_manager': return { who: 'the requester’s reporting manager', single: true }
      case 'department_head': return { who: 'the requester’s department head', single: false }
      case 'plant_head': return { who: 'the plant head', single: true }
      case 'partner': return { who: 'the Partners', single: false }
      case 'director': return { who: 'the Directors', single: false }
      case 'user_flag': return { who: `everyone flagged “${meta?.approver_flags[cfg.flag || ''] || 'an approval flag'}”`, single: false }
      case 'specific_users': return { who: (cfg.user_ids || []).map(userName).join(', ') || 'the named users (none picked yet)', single: (cfg.user_ids || []).length === 1 }
      case 'role': return { who: `holders of the role “${meta?.roles.find((r) => r.id === cfg.role_id)?.name || 'not picked yet'}”`, single: false }
      case 'permission': return { who: `holders of ${cfg.permission ? permWords(cfg.permission) : 'a permission (not picked yet)'}`, single: false }
      case 'record_field': return { who: `the person chosen as “${type?.context_fields[cfg.field || '']?.label || 'approver'}” on the document`, single: true }
      default: return { who: meta?.approver_rules[s.approver_rule] || s.approver_rule, single: false }
    }
  }
  const escPlain = (s: ApprovalStageDef) => {
    if (!s.escalate_after_hours) return ''
    const to = s.escalation_rule === 'specific_users' ? (s.escalation_config.user_ids || []).map(userName).join(', ') || 'the picked users'
      : ({ approver_manager: 'the late approver’s reporting manager', department_head: 'the requester’s department head', partner: 'any Partner', director: 'any Director' } as Record<string, string>)[s.escalation_rule || ''] || 'the escalation contact'
    return ` If nobody decides within ${s.escalate_after_hours} hours, ${to} can decide it too.`
  }
  const summary: string[] = !wf || !type ? [] : !wf.is_active
    ? [`Approval is switched off — every ${type.label} is approved the moment it is submitted.`]
    : wf.stages.length === 0 ? ['No stages yet — add one, or switch “Approval required” off.']
      : [
          ...wf.stages.map((s, i) => {
            const { who, single } = whoPlain(s)
            const when = s.conditions.length ? `If ${condText(s)}, ` : ''
            const lead = i === 0 ? 'it goes to' : 'it then goes to'
            const how = single ? '' : s.approval_mode === 'all' ? ' — every one of them must approve' : ' — any one of them approves'
            const plant = s.rule_config.same_plant ? ' (same plant only)' : ''
            const extra = s.rule_config.plus_permission ? ` Holders of ${permWords(s.rule_config.plus_permission)} may also decide.` : ''
            const skip = s.skip_if_no_approver ? ' The stage is skipped if nobody matches.' : ''
            return `${i + 1}. ${when}${when ? lead : lead.charAt(0).toUpperCase() + lead.slice(1)} ${who}${plant}${how}.${extra}${escPlain(s)}${skip}`
          }),
          [
            wf.allow_self_approval ? 'The requester MAY approve their own document.' : 'Nobody approves their own document.',
            wf.stages.length > 1 ? (wf.distinct_approvers ? 'Each stage needs a different person.' : 'One person may approve more than one stage.') : '',
            wf.require_permission ? `Approvers must also hold the Approve permission on ${type.module_label} › ${type.subtab_label}.` : 'Being the stage’s approver is enough — no extra permission needed.',
            wf.stages.every((s) => s.conditions.length) ? 'A document matching none of the conditions is approved at once.' : '',
            'Approvals are final once the last stage approves; Return sends it back for changes and Reject stops it.',
          ].filter(Boolean).join(' '),
        ]

  const guardNav = (href: string) => { if (dirty) setLeaveTo(href); else router.push(href) }

  const subtitle = [type ?`${type.module_label} › ${type.subtab_label}` : 'Approval workflow', type?.description].filter(Boolean).join(' — ')

  return (
    <FormPage nav={<OrganizationNav />} icon="flag" title={type?.label || 'Approval workflow'} subtitle={subtitle}
      onBack={() => guardNav('/dashboard/organization/workflows')} backTour="org-workflow-back"
      footer={readOnly ? (
        <span style={{ fontSize: 12.5, color: SHEET.MUTED, marginRight: 'auto' }}>You can view this workflow; changing it needs Organization › Approval Workflows › Edit.</span>
      ) : (<>
        {dirty && <span role="status" style={{ fontSize: 12.5, fontWeight: 600, color: '#92400e', marginRight: 'auto' }}>Unsaved changes</span>}
        {mayReset && <button type="button" style={sheetBtn('secondary')} onClick={() => setAskReset(true)}><SheetIcon name="undo" size={15} />Reset to default</button>}
        <button type="button" style={sheetBtn('primary', SHEET.BLUE, saving || !wf)} disabled={saving || !wf} onClick={save}>
          <SheetIcon name="check" size={16} />{saving ? 'Saving…' : totalErrors ? `Save workflow (${totalErrors} to fix)` : 'Save workflow'}
        </button>
      </>)}>
      <MessageDialog open={!!error} variant="error" title="Approval workflow" message={error} onClose={() => setError('')} />
      <MessageDialog open={!!notice} variant="success" title={notice.startsWith('Template') ? 'Template applied' : 'Saved'} message={notice} onClose={() => setNotice('')} />
      <ConfirmDialog open={askTemplate} danger={false} title="Apply template" confirmLabel="Replace stages"
        message={`Replace the ${wf?.stages.length || 0} stage(s) on screen with “${template?.label}”? Nothing is saved until you click Save workflow.`}
        onConfirm={applyTemplate} onCancel={() => setAskTemplate(false)} />
      <ConfirmDialog open={askReset} title="Reset to default now?" confirmLabel="Reset now"
        message="This replaces the saved workflow straight away for documents submitted from now on, and discards your unsaved edits. Documents already waiting keep their approvers."
        onConfirm={reset} onCancel={() => setAskReset(false)} />
      <ConfirmDialog open={leaveTo !== null} danger={false} title="Leave without saving?" confirmLabel="Leave"
        message="Your changes to this workflow have not been saved."
        onConfirm={() => { const to = leaveTo; setLeaveTo(null); if (to) { setBaseline(null); router.push(to) } }} onCancel={() => setLeaveTo(null)} />
      <ConfirmDialog open={removeStageAt !== null} title="Remove this stage?" confirmLabel="Remove stage"
        message={`Stage ${(removeStageAt ?? 0) + 1}${wf?.stages[removeStageAt ?? -1]?.name ? ` “${wf.stages[removeStageAt ?? -1].name}”` : ''} will be taken out of the workflow on screen. Nothing is saved until you click Save workflow.`}
        onConfirm={() => { const i = removeStageAt; setRemoveStageAt(null); if (wf && i !== null) setWf({ ...wf, stages: wf.stages.filter((_, j) => j !== i) }) }}
        onCancel={() => setRemoveStageAt(null)} />

      {!wf && (
        <div style={{ padding: '20px 24px' }}>
          {loadError ? (
            <div role="alert" style={{ ...cardStyle, borderColor: 'rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.05)' }}>
              <p style={{ margin: '0 0 10px', fontSize: 13.5, color: '#b91c1c', fontWeight: 600 }}>This workflow could not be opened: {loadError}</p>
              <button type="button" style={smallSecondaryBtnStyle} onClick={() => setReloadTick((n) => n + 1)}>Try again</button>
            </div>
          ) : <p role="status" style={{ fontSize: 13, color: TEXT.muted }}>Loading workflow…</p>}
        </div>
      )}
      <MessageDialog open={blockers.length > 0} variant="error" title="Not saved — fix these first"
        message={[...blockers, 'Nothing was saved. Fix the stage(s) marked in section 3, then save again.']} onClose={() => setBlockers([])} />
      <ConfirmDialog open={!!saveConfirm} title={saveConfirm?.title || ''} confirmLabel={saveConfirm?.label || 'Save'}
        message={saveConfirm?.message || ''} onConfirm={doSave} onCancel={() => setSaveConfirm(null)} />

      {wf && meta && type && (
        <div style={{ padding: '20px 24px' }}>
          {/* Visual flow: what happens to a document, start to finish. */}
          <div style={{ ...cardStyle, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
              <FlowNode title="Submitted" sub="by the requester" tone="muted" />
              {!wf.is_active ? (
                <><Arrow /><FlowNode title="Approval off" sub="approved at once" tone="warn" /></>
              ) : wf.stages.map((s, i) => (
                <Fragment key={i}>
                  <Arrow />
                  <FlowNode
                    title={`${i + 1}. ${s.name || 'Unnamed stage'}`}
                    sub={`${whoText(s)} · ${s.approval_mode === 'all' ? 'all must sign' : 'any one signs'}`}
                    foot={`When: ${condText(s)}${s.escalate_after_hours ? ` · escalates after ${s.escalate_after_hours}h` : ''}${s.skip_if_no_approver ? ' · skippable' : ''}`}
                    tone={errorsFor(i) ? 'error' : s.conditions.length ? 'cond' : 'normal'}
                    badge={errorsFor(i) ? `${errorsFor(i)} to fix` : undefined}
                    onClick={() => stageRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  />
                </Fragment>
              ))}
              <Arrow />
              <FlowNode title="Approved" sub="the module moves on" tone="ok" />
            </div>
          </div>

          {/* The same workflow in plain words — updates as you edit. */}
          <div style={{ ...cardStyle, background: 'rgba(255,106,42,0.035)' }}>
            <p style={{ ...subHead, margin: '0 0 8px' }}>In plain words</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {summary.map((line, i) => (
                <p key={i} style={{ fontSize: 13, color: i === summary.length - 1 && wf.is_active && wf.stages.length ? TEXT.secondary : TEXT.body, margin: 0, lineHeight: 1.5 }}>{line}</p>
              ))}
            </div>
          </div>

          <Step n={1} icon="gear" title="General settings" help="Rules that apply to every stage of this approval.">
          <div style={cardStyle}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
              {([
                ['is_active', 'Approval required', 'Off = documents are approved as soon as they are submitted.'],
                ['allow_self_approval', 'Requester may approve own document', 'Off = the person who raised it can never approve it (a second person must). Recommended off.'],
                ['distinct_approvers', 'Different person per stage', 'One person can approve only one stage of the same document.'],
                ['require_permission', 'Approver also needs the Approve permission', `On (recommended) = the approver must also have the Approve permission on ${type.module_label} › ${type.subtab_label}, so losing the permission stops them approving. Off = being the stage's approver is enough — only where the person is the authority (e.g. a manager approving leave).`],
              ] as const).map(([k, label, help]) => (
                <div key={k} style={{ flex: '1 1 220px', maxWidth: 320 }}>
                  <span role="group" aria-label={label} aria-describedby={!isAdminUser ? 'wf-admin-only' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: TEXT.heading, fontWeight: 600 }}>
                    <Checkbox asSwitch checked={!!wf[k]} disabled={readOnly || !isAdminUser} onChange={() => setWf({ ...wf, [k]: !wf[k] })} /> {label}
                  </span>
                  <p style={hint}>{help}</p>
                </div>
              ))}
            </div>
            {!isAdminUser && <p id="wf-admin-only" style={{ ...hint, marginTop: 14 }}>Only an administrator can change this.</p>}
            <p style={{ ...hint, marginTop: 14 }}>
              An approver going on leave sets a delegate in{' '}
              <Link href="/dashboard/organization/delegations" style={{ color: '#C2410C', fontWeight: 600 }}
                onClick={(e) => { if (dirty) { e.preventDefault(); setLeaveTo('/dashboard/organization/delegations') } }}>Organization › Delegations</Link>
              {' '}— their pending approvals reach the delegate for those dates. Every decision, delegation and escalation is kept on the document&apos;s approval history.
            </p>
          </div>
          </Step>

          <Step n={2} icon="list" title="Approval stages" help="Stages run in order. Each stage: who approves, when it applies, and what happens if nobody matches or nobody acts.">
          {!readOnly && (
            <div style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 300px', maxWidth: 400 }}>
                <Field label="Start from a template (optional)">
                  <Select style={inputStyle} value={tplId} onChange={(e) => setTplId(e.target.value)}>
                    <option value="">Pick a template…</option>
                    {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </Select>
                </Field>
              </div>
              {template?.needsAmount && (
                <div style={{ flex: '0 1 170px', minWidth: 150 }}>
                  <Field label="Partner above (₹)"><input type="number" min={1} style={inputStyle} value={tplAmount} onChange={(e) => setTplAmount(e.target.value)} /></Field>
                </div>
              )}
              <button type="button" style={sheetBtn('secondary', undefined, !template)} disabled={!template} onClick={() => setAskTemplate(true)}><SheetIcon name="doc" size={15} />Apply template</button>
              {template && <p style={{ ...hint, flexBasis: '100%' }}>{template.help}</p>}
            </div>
          )}
          {wf.stages.map((s, i) => (
            <div key={i} ref={(el) => { stageRefs.current[i] = el }} style={{ ...cardStyle, borderLeft: errorsFor(i) ? '3px solid #DC2626' : cardStyle.border }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: TEXT.heading }}>
                  Stage {i + 1}{s.name ? ` — ${s.name}` : ''}
                  {errorsFor(i) > 0 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: '#b91c1c' }}>⚠ {errorsFor(i)} to fix — see section 3</span>}
                </span>
                {!readOnly && (
                  <span style={{ display: 'flex', gap: 14 }}>
                    <button type="button" aria-label={`Move stage ${i + 1} up`} style={linkBtn(TEXT.secondary, i === 0)} onClick={() => moveStage(i, -1)} disabled={i === 0}>↑ Up</button>
                    <button type="button" aria-label={`Move stage ${i + 1} down`} style={linkBtn(TEXT.secondary, i === wf.stages.length - 1)} onClick={() => moveStage(i, 1)} disabled={i === wf.stages.length - 1}>↓ Down</button>
                    <button type="button" aria-label={`Remove stage ${i + 1}`} style={linkBtn('#B91C1C')}
                      onClick={() => { if (s.name.trim()) setRemoveStageAt(i); else setWf({ ...wf, stages: wf.stages.filter((_, j) => j !== i) }) }}>Remove</button>
                  </span>
                )}
              </div>

              <p style={subHead}>Who approves</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
                  <Field label="Stage name *"><input style={inputStyle} disabled={readOnly} value={s.name} onChange={(e) => setStage(i, { name: e.target.value })} placeholder="e.g. Department head" /></Field>
                </div>
                <div style={{ flex: '1 1 260px', maxWidth: 340 }}>
                  <Field label="Approver">
                    <Select style={inputStyle} disabled={readOnly} value={s.approver_rule} onChange={(e) => setStage(i, { approver_rule: e.target.value, rule_config: {} })}>
                      {Object.entries(meta.approver_rules).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </Field>
                </div>
                <div style={{ flex: '0 1 220px', minWidth: 200 }}>
                  <Field label="When several people match">
                    <Select style={inputStyle} disabled={readOnly} value={s.approval_mode} onChange={(e) => setStage(i, { approval_mode: e.target.value as 'any' | 'all' })}>
                      <option value="any">Any one of them approves</option>
                      <option value="all">Every one must approve</option>
                    </Select>
                  </Field>
                </div>
              </div>

              <div style={{ marginTop: 10, maxWidth: 560 }}>
                {s.approver_rule === 'specific_users' && (
                  <Field label="Users"><UserChipsPicker users={users} disabled={readOnly} value={s.rule_config.user_ids || []} onChange={(ids) => setStage(i, { rule_config: { ...s.rule_config, user_ids: ids } })} /></Field>
                )}
                {s.approver_rule === 'role' && (
                  <Field label="Role">
                    <Select style={inputStyle} disabled={readOnly} value={s.rule_config.role_id || ''} onChange={(e) => setStage(i, { rule_config: { ...s.rule_config, role_id: Number(e.target.value) } })}>
                      <option value="">Pick a role…</option>
                      {meta.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </Select>
                  </Field>
                )}
                {s.approver_rule === 'permission' && (
                  <Field label="Permission">
                    <Select style={inputStyle} disabled={readOnly} value={s.rule_config.permission || ''} onChange={(e) => setStage(i, { rule_config: { ...s.rule_config, permission: e.target.value } })}>
                      <option value="">Pick a permission…</option>
                      {meta.approval_permission_options ? permGroups() : meta.approval_permissions.map((p) => <option key={p} value={p}>{permWords(p)}</option>)}
                    </Select>
                  </Field>
                )}
                {s.approver_rule === 'user_flag' && (
                  <Field label="Approval flag">
                    <Select style={inputStyle} disabled={readOnly} value={s.rule_config.flag || ''} onChange={(e) => setStage(i, { rule_config: { ...s.rule_config, flag: e.target.value } })}>
                      <option value="">Pick a flag…</option>
                      {Object.entries(meta.approver_flags).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </Field>
                )}
                {s.approver_rule === 'record_field' && (
                  <Field label="Person on the document">
                    <Select style={inputStyle} disabled={readOnly} value={s.rule_config.field || ''} onChange={(e) => setStage(i, { rule_config: { ...s.rule_config, field: e.target.value } })}>
                      <option value="">{userFields.length ? 'Pick…' : 'This document names no people'}</option>
                      {userFields.map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
                    </Select>
                  </Field>
                )}
                <div style={{ marginTop: 8 }}>
                  <Field label="Also allow holders of (optional)">
                    <Select style={inputStyle} disabled={readOnly} value={s.rule_config.plus_permission || ''}
                      onChange={(e) => setStage(i, { rule_config: { ...s.rule_config, plus_permission: e.target.value || undefined } })}>
                      <option value="">Nobody else</option>
                      {meta.approval_permission_options ? permGroups() : meta.approval_permissions.map((p) => <option key={p} value={p}>{permWords(p)}</option>)}
                    </Select>
                  </Field>
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: TEXT.heading, marginTop: 8 }}>
                  <Checkbox asSwitch checked={!!s.rule_config.same_plant} disabled={readOnly}
                    onChange={() => setStage(i, { rule_config: { ...s.rule_config, same_plant: !s.rule_config.same_plant || undefined } })} />
                  Same plant only — keep approvers whose plant is the document&apos;s plant
                </span>
              </div>

              <p style={subHead}>Applies when</p>
              <div>
                {s.conditions.length === 0 && <span style={{ fontSize: 12, color: TEXT.muted }}>Always — every document goes through this stage.</span>}
                {s.conditions.map((c, ci) => {
                  const f = type.context_fields[c.field]
                  return (
                    <div key={ci} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                      {ci > 0 && <span style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.muted }}>AND</span>}
                      <Select style={{ ...inputStyle, width: 200 }} disabled={readOnly} value={c.field}
                        onChange={(e) => setStage(i, { conditions: s.conditions.map((x, j) => (j === ci ? { ...x, field: e.target.value, value: '' } : x)) })}>
                        {fields.map(([k, fd]) => <option key={k} value={k}>{fd.label}</option>)}
                      </Select>
                      <Select style={{ ...inputStyle, width: 150 }} disabled={readOnly} value={c.op}
                        onChange={(e) => setStage(i, { conditions: s.conditions.map((x, j) => (j === ci ? { ...x, op: e.target.value } : x)) })}>
                        {Object.entries(meta.condition_ops)
                          .filter(([v]) => (['gt', 'gte', 'lt', 'lte'].includes(v) ? f?.type === 'number' : ['true', 'false'].includes(v) ? f?.type === 'bool' : f?.type !== 'bool'))
                          .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </Select>
                      {c.op !== 'true' && c.op !== 'false' && (
                        f?.choices?.length && (c.op === 'eq' || c.op === 'ne') ? (
                          <Select style={{ ...inputStyle, width: 180 }} disabled={readOnly} value={String(c.value ?? '')}
                            onChange={(e) => setStage(i, { conditions: s.conditions.map((x, j) => (j === ci ? { ...x, value: e.target.value } : x)) })}>
                            <option value="">Pick…</option>
                            {f.choices.map((ch) => <option key={ch} value={ch}>{f.choice_labels?.[ch] || ch}</option>)}
                          </Select>
                        ) : f?.choices?.length ? (
                          // "is one of" / "is not one of" on a choice field: tick the values (shown in words).
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 520 }}>
                            {f.choices.map((ch) => {
                              const picked = (Array.isArray(c.value) ? c.value : String(c.value ?? '').split(',')).map((v) => String(v).trim()).filter(Boolean)
                              const on = picked.includes(ch)
                              return (
                                <button key={ch} type="button" disabled={readOnly}
                                  onClick={() => setStage(i, { conditions: s.conditions.map((x, j) => (j === ci ? { ...x, value: on ? picked.filter((v) => v !== ch) : [...picked, ch] } : x)) })}
                                  style={{ ...chipBtnStyle(on), cursor: readOnly ? 'default' : 'pointer' }}>
                                  {on ? '✓ ' : ''}{f.choice_labels?.[ch] || ch}
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <input style={{ ...inputStyle, width: 180 }} disabled={readOnly} value={Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '')}
                            placeholder={c.op === 'in' || c.op === 'not_in' ? (f?.choices?.length ? f.choices.slice(0, 3).join(', ') : 'a, b, c') : f?.type === 'number' ? '500000' : 'value'}
                            onChange={(e) => setStage(i, { conditions: s.conditions.map((x, j) => (j === ci ? { ...x, value: f?.type === 'number' && !['in', 'not_in'].includes(c.op) ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value } : x)) })} />
                        )
                      )}
                      {!readOnly && <button type="button" aria-label={`Remove condition ${ci + 1}`} style={{ ...linkBtn('#B91C1C'), minWidth: 24 }} onClick={() => setStage(i, { conditions: s.conditions.filter((_, j) => j !== ci) })}>×</button>}
                    </div>
                  )
                })}
                {!readOnly && fields.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <button type="button" style={linkBtn('#C2410C')} onClick={() => {
                      const [fk, fd] = fields[0]
                      setStage(i, { conditions: [...s.conditions, { field: fk, op: fd.type === 'number' ? 'gt' : fd.type === 'bool' ? 'true' : 'eq', value: '' }] })
                    }}>+ Add condition</button>
                  </div>
                )}
              </div>

              <p style={subHead}>If nobody matches · if nobody acts</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
                <div style={{ maxWidth: 340 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: TEXT.heading }}>
                    <Checkbox asSwitch checked={s.skip_if_no_approver} disabled={readOnly} onChange={() => setStage(i, { skip_if_no_approver: !s.skip_if_no_approver })} />
                    Skip this stage if nobody matches
                  </span>
                  <p style={hint}>Off (recommended) = submission is refused with the reason, so the gap gets fixed. A document is never approved with every stage skipped.</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ width: 130 }}>
                    <Field label="Escalate after (hours)">
                      <input type="number" min={1} style={inputStyle} disabled={readOnly} value={s.escalate_after_hours ?? ''}
                        onChange={(e) => setStage(i, { escalate_after_hours: e.target.value === '' ? null : Number(e.target.value), escalation_rule: s.escalation_rule || 'approver_manager' })} placeholder="off" />
                    </Field>
                  </div>
                  {s.escalate_after_hours ? (
                    <div style={{ width: 260 }}>
                      <Field label="Escalate to">
                        <Select style={inputStyle} disabled={readOnly} value={s.escalation_rule || ''} onChange={(e) => setStage(i, { escalation_rule: e.target.value })}>
                          {Object.entries(meta.escalation_rules).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </Select>
                      </Field>
                    </div>
                  ) : null}
                </div>
              </div>
              {s.escalate_after_hours && s.escalation_rule === 'specific_users' ? (
                <div style={{ maxWidth: 560, marginTop: 8 }}>
                  <Field label="Escalation users"><UserChipsPicker users={users} disabled={readOnly} value={s.escalation_config.user_ids || []} onChange={(ids) => setStage(i, { escalation_config: { user_ids: ids } })} /></Field>
                </div>
              ) : null}
            </div>
          ))}
          {!readOnly && (
            <button type="button" style={{ ...sheetBtn('secondary'), marginBottom: 6 }} onClick={() => setWf({ ...wf, stages: [...wf.stages, blankStage()] })}><SheetIcon name="plus" size={15} />Add stage</button>
          )}
          {!readOnly && wf.stages.length === 0 && (
            <p style={{ ...hint, color: '#b91c1c' }}>No stages — switch &ldquo;Approval required&rdquo; off if this document should not need approval.</p>
          )}

          </Step>

          {maySimulate && <Step n={3} icon="shield" title="Check & preview" help="The setup is checked against everyone who can raise this document, as you edit — before you save.">
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <h3 style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Setup check</h3>
              <span style={{ fontSize: 11.5, color: TEXT.muted }}>
                {checking ? 'Checking…' : check ? `Checked against ${check.checked_users} people who can raise this document` : ''}
              </span>
            </div>
            <div role="status" aria-live="polite">
            {checkError && <p style={{ fontSize: 12.5, color: '#b91c1c', margin: '0 0 8px' }}>Can&apos;t check yet: {checkError}</p>}
            {check && check.issues.length === 0 && (
              <p style={{ fontSize: 13, color: '#15803d', margin: 0 }}>✓ No problems — everyone who can raise this document would find an approver at every stage.</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {check?.issues.map((x, k) => {
                const lv = LEVEL[x.level]
                return (
                  <div key={k} role={x.blocking ? 'alert' : undefined} style={{ fontSize: 12.5, color: lv.color, background: lv.bg, border: `1px solid ${lv.border}`, borderRadius: 10, padding: '8px 12px' }}>
                    <b style={{ marginRight: 6 }}>{lv.label}:</b>{x.message}
                    {x.stage !== null && (
                      <button type="button" style={{ ...linkBtn(lv.color), marginLeft: 8, textDecoration: 'underline' }}
                        onClick={() => stageRefs.current[x.stage!]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Go to stage</button>
                    )}
                  </div>
                )
              })}
            </div>
            </div>

            <h3 style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading, margin: '18px 0 4px' }}>Try it</h3>
            <p style={{ ...hint, marginBottom: 10 }}>Pick a requester and fill in the document&apos;s values (e.g. amount) to see exactly who would approve it — uses the workflow <b>as edited above</b>, so you can try a change before saving.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 260px', maxWidth: 360 }}>
                <Field label="Requester"><UserChipsPicker users={users} value={pvUser} onChange={setPvUser} max={1} placeholder="Type a name…" /></Field>
              </div>
              {fields.filter(([, f]) => f.type !== 'user').map(([k, f]) => (
                <div key={k} style={{ width: 170 }}>
                  <Field label={f.label}>
                    {f.type === 'bool' ? (
                      <Select style={inputStyle} value={pvCtx[k] || ''} onChange={(e) => setPvCtx({ ...pvCtx, [k]: e.target.value })}>
                        <option value="">—</option><option value="true">Yes</option><option value="false">No</option>
                      </Select>
                    ) : f.choices?.length ? (
                      <Select style={inputStyle} value={pvCtx[k] || ''} onChange={(e) => setPvCtx({ ...pvCtx, [k]: e.target.value })}>
                        <option value="">—</option>{f.choices.map((c) => <option key={c} value={c}>{f.choice_labels?.[c] || c}</option>)}
                      </Select>
                    ) : (
                      <input style={inputStyle} type={f.type === 'number' ? 'number' : 'text'} value={pvCtx[k] || ''} onChange={(e) => setPvCtx({ ...pvCtx, [k]: e.target.value })} />
                    )}
                  </Field>
                </div>
              ))}
              <button type="button" style={sheetBtn('secondary')} onClick={runPreview}><SheetIcon name="search" size={15} />Preview</button>
            </div>
            {preview && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {preview.length === 0 && <span style={{ fontSize: 13, color: TEXT.muted }}>No stage applies — the document would be approved on submit.</span>}
                {preview.map((p) => (
                  <div key={p.sequence} style={{ fontSize: 13, color: TEXT.body, borderLeft: `3px solid ${p.problem && !p.skipped ? '#DC2626' : BORDER.normal}`, paddingLeft: 10 }}>
                    <b>{p.sequence}. {p.name}</b>{' '}
                    {p.approvers.length ? `— ${p.approvers.map((a) => a.name).join(', ')} (${p.approval_mode === 'all' ? 'all' : 'any one'})`
                      : p.skipped ? <span style={{ color: TEXT.muted }}>— skipped: {p.problem}</span>
                        : <span style={{ color: '#b91c1c' }}>— submission would be refused: {p.problem}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          </Step>}

          {seeHistory && <Step n={4} icon="history" title="History" help="Changes apply to documents submitted after saving. Every save is recorded.">
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" aria-expanded={showHistory} style={linkBtn(TEXT.secondary)} onClick={toggleHistory}>{showHistory ? '▾ Hide change history' : '▸ Show change history'}</button>
            </div>
            {showHistory && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {history === null && <span style={{ fontSize: 12.5, color: TEXT.muted }}>Loading…</span>}
                {history?.length === 0 && <span style={{ fontSize: 12.5, color: TEXT.muted }}>Not changed since it was set up — it runs on the module default.</span>}
                {history?.map((h) => (
                  <div key={h.id} style={{ fontSize: 12.5, color: TEXT.body, borderLeft: `3px solid ${BORDER.normal}`, paddingLeft: 10 }}>
                    <b>{h.performed_by}</b> · {h.performed_at ? formatDateTime(h.performed_at) : '—'}
                    <div style={{ color: TEXT.secondary }}>{h.summary}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </Step>}
        </div>
      )}
    </FormPage>
  )
}

function Arrow() {
  return <span aria-hidden style={{ alignSelf: 'center', color: TEXT.muted, fontSize: 16, flex: '0 0 auto' }}>→</span>
}

function FlowNode({ title, sub, foot, tone, badge, onClick }: {
  title: string; sub: string; foot?: string; tone: 'muted' | 'normal' | 'cond' | 'error' | 'ok' | 'warn'; badge?: string; onClick?: () => void
}) {
  const colors = {
    muted: { bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.25)' },
    normal: { bg: 'rgba(255,106,42,0.07)', border: 'rgba(255,106,42,0.3)' },
    cond: { bg: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.3)' },
    error: { bg: 'rgba(220,38,38,0.07)', border: 'rgba(220,38,38,0.4)' },
    ok: { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.3)' },
    warn: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.35)' },
  }[tone]
  const Tag = (onClick ? 'button' : 'div') as React.ElementType
  return (
    <Tag {...(onClick ? { type: 'button' as const, onClick } : {})}
      style={{ flex: '0 0 auto', minWidth: 150, maxWidth: 240, padding: '8px 12px', borderRadius: 12, background: colors.bg, border: `1px solid ${colors.border}`, cursor: onClick ? 'pointer' : 'default', textAlign: 'left', fontFamily: 'inherit' }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.heading }}>
        {title}{badge && <span style={{ marginLeft: 6, fontSize: 10.5, color: '#b91c1c' }}>⚠ {badge}</span>}
      </div>
      <div style={{ fontSize: 11.5, color: TEXT.secondary, marginTop: 2 }}>{sub}</div>
      {foot && <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 3 }}>{foot}</div>}
    </Tag>
  )
}
