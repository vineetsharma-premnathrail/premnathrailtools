'use client'

/** Finance → Masters & Setup.
 *  Company & FY (read from Company Info), the chart of accounts (account
 *  groups + ledgers), ledger settings for automatic postings, GST rates,
 *  bank & cash accounts, vendors, internal orders and the one-time
 *  opening-balance voucher. One component per sub-tab below. */
import Select from '@/components/shared/Select'
import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi, costCentersApi, crmApi } from '@/lib/api'
import {
  AccountsSetup, AccountGroup, GLAccount, LedgerSetting, GSTRate, BankAccount, Vendor, InternalOrder, CostCenter, Organization,
} from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import FinanceNav from '@/components/finance/FinanceNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import ReasonSheet from '@/components/shared/ReasonSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import VendorReferralSection, { EMPTY_REFERRAL, referralError, referralFromVendor, referralPayload, type ReferralValue } from '@/components/shared/VendorReferral'
import DateField from '@/components/erp/DateField'
import {
  inputStyle, sectionStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, dangerLinkStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, Field, ErrorBanner, InfoBanner, StatusPill, SubTabs, useFinanceSubTabs, PageHeader, TableWrap, EmptyRow, ledgerOptions,
} from '@/components/finance/financeUi'
import { RowCount, Pill, DetailCard, DetailSummary, DetailGroup, DetailRow } from '@/components/shared/ui'
import {
  FormSheet, FormPage, SheetColumns, SheetSection, SheetIcon, SheetIconName, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint,
} from '@/components/shared/FormSheet'

const SUB_TABS = [
  'Company & FY', 'Account Groups', 'Ledgers', 'Ledger Settings', 'GST Rates', 'Bank & Cash', 'Vendors', 'Internal Orders', 'Opening Balances',
] as const
type SubTab = typeof SUB_TABS[number]
/** Permission Matrix tab (Finance & Accounting) behind each sub-tab. */
const SUB_TAB_KEYS: Record<SubTab, string> = {
  'Company & FY': 'company_fy', 'Account Groups': 'account_groups', Ledgers: 'ledgers', 'Ledger Settings': 'ledger_settings',
  'GST Rates': 'gst_rates', 'Bank & Cash': 'bank_cash_accounts', Vendors: 'vendors', 'Internal Orders': 'internal_orders',
  'Opening Balances': 'opening_balances',
}

const NATURE_LABELS: Record<string, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Capital / Equity', revenue: 'Income', expense: 'Expense',
}
const STATUS_HEX: Record<string, string> = {
  active: '#15803d', inactive: '#64748b', closed: '#64748b', blocked: '#b91c1c', open: '#15803d', locked: '#b45309',
  in_progress: '#0369a1', completed: '#15803d', default: '#0369a1', changed: '#b45309', system: '#7c3aed', custom: '#0369a1',
}
const STATUS_LABELS: Record<string, string> = {
  active: 'Active', inactive: 'Inactive', closed: 'Closed', blocked: 'Blocked', open: 'Open', locked: 'Locked',
  in_progress: 'In Progress', completed: 'Completed', default: 'Default', changed: 'Changed', system: 'System', custom: 'Custom',
}

/** A row of sheet fields that wrap and size to their content. */
const sheetRow: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 12 }
const readOnlyBox: React.CSSProperties = { ...sheetInput, background: SHEET.SOFT, color: SHEET.BODY }
const h2Style: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: 0 }
const mutedText: React.CSSProperties = { fontSize: 12, color: TEXT.muted }

/** Field width helpers (see ui-behavior skill: size to content, cap growers). */
const fixedW = (px: number): React.CSSProperties => ({ flex: `0 1 ${px}px`, minWidth: Math.min(px, 120) })
const growW = (px: number, max: number): React.CSSProperties => ({ flex: `1 1 ${px}px`, minWidth: Math.min(px, 160), maxWidth: max })

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
      <h2 style={h2Style}>{title}</h2>
      {action}
    </div>
  )
}

/** A labelled field inside a sheet (sheet label + optional required star). */
function SF({ label, req, opt, style, tour, children }: { label: string; req?: boolean; opt?: boolean; style?: React.CSSProperties; tour?: string; children: React.ReactNode }) {
  return (
    <div style={style} data-tour={tour}>
      <label style={sheetLabel}>{label}{req && <> <Req /></>}{opt && <> <Optional /></>}</label>
      {children}
    </div>
  )
}

/** Master create/edit popup: the sheet's body is a <form> so Enter still saves,
 *  and the footer's Save button submits it. Errors show inside the popup. */
function MasterSheet({ tour, formId, icon, title, subtitle, onClose, onSubmit, saving, label, editing, error, width = 960, children }: {
  tour: string; formId: string; icon: SheetIconName; title: string; subtitle: string; onClose: () => void
  onSubmit: (e: React.FormEvent) => void; saving: boolean; label: string; editing: boolean; error: string[]; width?: number; children: React.ReactNode
}) {
  return (
    <FormSheet tour={tour} icon={editing ? 'edit' : icon} title={title} subtitle={subtitle} onClose={onClose} busy={saving} width={width}
      footer={<>
        <button type="button" data-tour="fin-masters-form-cancel" onClick={onClose} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        <button type="submit" form={formId} data-tour="fin-masters-form-save" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
          <SheetIcon name={editing ? 'check' : 'plus'} size={16} />{saving ? 'Saving…' : label}
        </button>
      </>}>
      <form id={formId} onSubmit={onSubmit}>
        {error.length > 0 && <div style={{ padding: '16px 24px 0' }}><ErrorBanner error={error} /></div>}
        {children}
      </form>
    </FormSheet>
  )
}

const blank = (s: string) => (s.trim() ? s.trim() : null)
const num = (s: string) => (s.trim() === '' ? null : Number(s))

/** Groups in tree order (parent before children, siblings by sequence/name) with depth. */
function groupTree(groups: AccountGroup[]): { group: AccountGroup; depth: number; path: string }[] {
  const ids = new Set(groups.map((g) => g.id))
  const children = new Map<number | null, AccountGroup[]>()
  for (const g of groups) {
    const key = g.parent_id && ids.has(g.parent_id) ? g.parent_id : null
    if (!children.has(key)) children.set(key, [])
    children.get(key)!.push(g)
  }
  for (const list of children.values()) list.sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name))
  const out: { group: AccountGroup; depth: number; path: string }[] = []
  const walk = (parent: number | null, depth: number, prefix: string) => {
    for (const g of children.get(parent) || []) {
      const path = prefix ? `${prefix} › ${g.name}` : g.name
      out.push({ group: g, depth, path })
      walk(g.id, depth + 1, path)
    }
  }
  walk(null, 0, '')
  return out
}

export default function FinanceMastersPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const { tabs: visibleTabs, tab, setTab } = useFinanceSubTabs(SUB_TABS, SUB_TAB_KEYS)
  const { can } = useCan()
  const isFinanceManager = !!(user?.is_finance_manager || user?.role === 'admin')

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <FinanceNav />
      <PageHeader title="Masters & Setup" subtitle="Company year, chart of accounts, posting ledgers, GST rates, bank & cash, vendors and opening balances — the foundations every voucher posts against." />
      <SubTabs tabs={visibleTabs} value={tab} onChange={setTab} />

      {tab === 'Company & FY' && <CompanyFYSection />}
      {tab === 'Account Groups' && <AccountGroupsSection />}
      {tab === 'Ledgers' && <LedgersSection onGoOpening={() => setTab('Opening Balances')} />}
      {tab === 'Ledger Settings' && <LedgerSettingsSection canManage={isFinanceManager && can('accounts', 'ledger_settings', 'edit')} />}
      {tab === 'GST Rates' && <GSTRatesSection canManage={isFinanceManager} />}
      {tab === 'Bank & Cash' && <BankCashSection onGoOpening={() => setTab('Opening Balances')} />}
      {tab === 'Vendors' && <VendorsSection />}
      {tab === 'Internal Orders' && <InternalOrdersSection />}
      {tab === 'Opening Balances' && <OpeningBalancesSection canManage={isFinanceManager && can('accounts', 'opening_balances', 'edit')} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Company & FY (read-only — maintained in Company Info)
// ---------------------------------------------------------------------------

function CompanyFYSection() {
  const [setup, setSetup] = useState<AccountsSetup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])

  useEffect(() => {
    accountsApi.getSetup()
      .then(setSetup)
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the company & financial-year setup')))
      .finally(() => setLoading(false))
  }, [])

  const fy = setup?.current_financial_year
  const gst = setup?.company_gst

  return (
    <div data-tour="fin-masters-company">
      <ErrorBanner error={error} />
      {!!setup?.warnings?.length && (
        <div role="alert" data-tour="fin-masters-warnings" style={{ display: 'flex', gap: 14, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: '#fef3c7', border: '1px solid #f59e0b', color: '#78350f', fontSize: 13, lineHeight: 1.5 }}>
          <ul style={{ margin: 0, paddingLeft: 18, flex: '1 1 360px' }}>
            {setup.warnings.map((w, i) => <li key={i}>{w.replace(/Company Info>/g, 'Company Info > ')}</li>)}
          </ul>
          <Link href="/dashboard/organization/info" style={{ ...secondaryBtnStyle, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flex: 'none' }}>Open Company Info</Link>
        </div>
      )}
      <DetailCard>
        <DetailSummary
          title={loading ? 'Loading…' : fy ? `Financial year ${fy.code}` : 'No financial year covers today'}
          text="The year and GST registration every voucher, invoice and return in Finance is booked against. Nothing can be posted outside an open year."
          meta={fy ? <>
            <StatusPill status={fy.status} colors={STATUS_HEX} labels={STATUS_LABELS} />
            <span>·</span><span>{dmy(fy.start_date)} to {dmy(fy.end_date)}</span>
            <span>·</span><span>GSTIN {gst?.gstin || <Pill label="Missing" hex="#b45309" />}</span>
          </> : undefined}
          actions={<Link href="/dashboard/organization/info" data-tour="fin-masters-company-info-link" style={{ ...secondaryBtnStyle, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Open Company Info →</Link>}
        />
        <div data-tour="fin-masters-fy-card">
          <DetailGroup title="Current financial year">
            {!loading && !fy ? <DetailRow label="Year">{null}</DetailRow> : <>
              <DetailRow label="Year">{fy?.code}</DetailRow>
              <DetailRow label="Period">{fy ? `${dmy(fy.start_date)} to ${dmy(fy.end_date)}` : null}</DetailRow>
              <DetailRow label="Lock date">{fy ? (fy.lock_date ? `${dmy(fy.lock_date)} — no postings on or before this date` : 'Not set') : null}</DetailRow>
              <DetailRow label="Source">{fy ? (fy.is_defined ? 'Defined in Company Info' : 'Using the standard April to March year until you set one') : null}</DetailRow>
            </>}
          </DetailGroup>
        </div>
        <div data-tour="fin-masters-gst-card">
          <DetailGroup title="Company GST registration" last>
            <DetailRow label="GSTIN">{loading ? null : (gst?.gstin ? <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{gst.gstin}</span> : <Pill label="Missing" hex="#b45309" />)}</DetailRow>
            <DetailRow label="State">{loading ? null : (gst?.state_code ? `${gst.state_code} — ${gst.state_name || ''}` : 'Unknown')}</DetailRow>
            <p style={{ ...mutedText, margin: '4px 0 0' }}>
              Our state vs the party&apos;s state decides CGST + SGST (same state) or IGST (different state) on every invoice.
            </p>
          </DetailGroup>
        </div>
      </DetailCard>

      <TableWrap minWidth={640} tour="fin-masters-fy-table">
        <thead>
          <tr><th style={thStyle}>Financial year <RowCount count={setup?.financial_years.length ?? 0} /></th><th style={thStyle}>Start</th><th style={thStyle}>End</th><th style={thStyle}>Status</th><th style={thStyle}>Lock date</th></tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={5} text="Loading…" /> : !setup?.financial_years.length ? <EmptyRow colSpan={5} text="No financial years defined in Company Info yet." /> :
            setup.financial_years.map((y) => (
              <tr key={y.code}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{y.code}{fy?.code === y.code && <span style={{ ...mutedText, marginLeft: 8 }}>(current)</span>}</td>
                <td style={tdStyle}>{dmy(y.start_date)}</td>
                <td style={tdStyle}>{dmy(y.end_date)}</td>
                <td style={tdStyle}><StatusPill status={y.status} colors={STATUS_HEX} labels={STATUS_LABELS} /></td>
                <td style={tdStyle}>{dmy(y.lock_date)}</td>
              </tr>
            ))}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Account Groups
// ---------------------------------------------------------------------------

function emptyGroupForm() {
  return { parent_id: '', code: '', name: '', schedule_iii_head: '', affects_gross_profit: 'inherit', sequence: '0' }
}

function AccountGroupsSection() {
  const { can, canDelete } = useCan()
  const canCreate = can('accounts', 'account_groups', 'create')
  const canEdit = can('accounts', 'account_groups', 'edit')
  const [groups, setGroups] = useState<AccountGroup[]>([])
  const [heads, setHeads] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AccountGroup | null>(null)
  const [form, setForm] = useState(emptyGroupForm())
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AccountGroup | null>(null)

  const load = () => {
    Promise.all([accountsApi.listAccountGroups(), accountsApi.getSetup()])
      .then(([g, s]) => { setGroups(g); setHeads(s.schedule_iii_heads || {}) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load account groups')))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const tree = useMemo(() => groupTree(groups), [groups])
  const hasChildren = useMemo(() => new Set(groups.map((g) => g.parent_id).filter(Boolean) as number[]), [groups])
  const parent = groups.find((g) => String(g.id) === form.parent_id)

  const close = () => { setFormOpen(false); setEditing(null); setForm(emptyGroupForm()) }
  const startCreate = (parentId?: number) => { setEditing(null); setForm({ ...emptyGroupForm(), parent_id: parentId ? String(parentId) : '' }); setFormOpen(true) }
  const startEdit = (g: AccountGroup) => {
    setEditing(g)
    setForm({ parent_id: g.parent_id ? String(g.parent_id) : '', code: g.code, name: g.name, schedule_iii_head: g.schedule_iii_head, affects_gross_profit: 'inherit', sequence: String(g.sequence) })
    setFormOpen(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError([])
    if (!form.name.trim() || (!editing && (!form.code.trim() || !form.parent_id))) {
      setError(['Parent group, code and name are required — every new group sits under an existing one.'])
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const payload: Record<string, unknown> = { name: form.name.trim(), sequence: Number(form.sequence || 0) }
        if (!editing.is_system && form.schedule_iii_head && form.schedule_iii_head !== editing.schedule_iii_head) payload.schedule_iii_head = form.schedule_iii_head
        await accountsApi.updateAccountGroup(editing.id, payload)
      } else {
        await accountsApi.createAccountGroup({
          parent_id: Number(form.parent_id), code: form.code.trim(), name: form.name.trim(),
          schedule_iii_head: form.schedule_iii_head || null,
          affects_gross_profit: form.affects_gross_profit === 'inherit' ? null : form.affects_gross_profit === 'yes',
          sequence: Number(form.sequence || 0),
        })
      }
      close()
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, editing ? `Could not update group '${editing.name}'` : 'Could not create the account group'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      await accountsApi.deleteAccountGroup(target.id)
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not delete group '${target.name}'`))
    }
  }

  const headOptions = Object.entries(heads)

  return (
    <div style={sectionStyle} data-tour="fin-masters-groups">
      <SectionHeader title="Account groups" action={canCreate && <button type="button" data-tour="fin-groups-new-btn" style={primaryBtnStyle} onClick={() => startCreate()}>+ New Sub-group</button>} />
      {!formOpen && <ErrorBanner error={error} />}
      <ConfirmDialog open={!!deleteTarget} title="Delete this account group?" message={`Delete "${deleteTarget?.name}"? Only empty custom groups can be deleted.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      {formOpen && (
        <MasterSheet tour="fin-groups-form" formId="fin-groups-form-el" icon="list" editing={!!editing} error={error} width={640}
          title={editing ? `Edit group '${editing.name}'` : 'New account sub-group'}
          subtitle="Groups decide where a ledger appears in the Balance Sheet / P&L (Schedule III)."
          onClose={() => { setError([]); close() }} onSubmit={submit} saving={saving} label={editing ? 'Save Changes' : 'Create Sub-group'}>
          <div style={{ padding: '20px 24px' }}>
            <InfoBanner>
              A sub-group always inherits its parent&apos;s nature (asset, liability…) — a ledger under Sundry Debtors can only ever be an asset.
              The standard groups are fixed; add sub-groups under them for your own grouping.
            </InfoBanner>
            <SheetSection icon="list" title="Place in the chart">
              <div style={sheetRow}>
                <SF label="Parent group" req={!editing} style={growW(260, 420)} tour="fin-groups-parent">
                  {editing ? <div style={readOnlyBox}>{editing.parent_name || '— (top level)'}</div> : (
                    <SearchableSelect value={form.parent_id} onChange={(v: string) => setForm((f) => ({ ...f, parent_id: v }))}
                      options={tree.map((t) => ({ value: String(t.group.id), label: t.path }))} placeholder="Pick parent group" />
                  )}
                </SF>
                <SF label="Nature (inherited)" style={fixedW(150)} tour="fin-groups-nature">
                  <div style={readOnlyBox}>{NATURE_LABELS[(editing || parent)?.nature || ''] || '—'}</div>
                </SF>
              </div>
            </SheetSection>
            <SheetSection icon="tag" title="Identity">
              <div style={sheetRow}>
                <SF label="Code" req style={fixedW(140)} tour="fin-groups-code">
                  <input style={sheetInput} value={form.code} disabled={!!editing} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="G-…" />
                </SF>
                <SF label="Name" req style={growW(220, 360)} tour="fin-groups-name">
                  <input style={sheetInput} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus={!editing} />
                </SF>
              </div>
            </SheetSection>
            <SheetSection icon="doc" title="Reporting">
              <div style={sheetRow}>
                <SF label="Schedule III head" style={growW(240, 380)} tour="fin-groups-schedule">
                  <Select style={sheetInput} value={form.schedule_iii_head} disabled={!!editing?.is_system}
                    onChange={(e) => setForm((f) => ({ ...f, schedule_iii_head: e.target.value }))}>
                    {!editing && <option value="">Same as parent{parent ? ` (${heads[parent.schedule_iii_head] || parent.schedule_iii_head})` : ''}</option>}
                    {headOptions.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </Select>
                </SF>
                {!editing && (
                  <SF label="Affects gross profit" style={fixedW(180)} tour="fin-groups-gross-profit">
                    <Select style={sheetInput} value={form.affects_gross_profit} onChange={(e) => setForm((f) => ({ ...f, affects_gross_profit: e.target.value }))}>
                      <option value="inherit">Same as parent{parent ? ` (${parent.affects_gross_profit ? 'Yes' : 'No'})` : ''}</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </Select>
                  </SF>
                )}
                <SF label="Sequence" style={fixedW(100)} tour="fin-groups-sequence">
                  <input type="number" style={sheetInput} value={form.sequence} onChange={(e) => setForm((f) => ({ ...f, sequence: e.target.value }))} />
                </SF>
              </div>
              {editing?.is_system && <p style={sheetHint}>Standard group — its Schedule III head is fixed; create a sub-group with its own head instead.</p>}
            </SheetSection>
          </div>
        </MasterSheet>
      )}

      <TableWrap minWidth={980} tour="fin-groups-table">
        <thead>
          <tr>
            <th style={thStyle}>Group <RowCount count={tree.length} /></th><th style={thStyle}>Nature</th><th style={thStyle}>Schedule III head</th>
            <th style={thStyle}>Gross profit</th><th style={numTh}>Ledgers</th><th style={thStyle}>Type</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={7} text="Loading…" /> : tree.length === 0 ? <EmptyRow colSpan={7} text="No account groups yet — use + New Sub-group to add one under a primary group." /> :
            tree.map(({ group: g, depth }) => {
              const deletable = !g.is_system && g.ledger_count === 0 && !hasChildren.has(g.id)
              return (
                <tr key={g.id}>
                  <td style={{ ...tdStyle, paddingLeft: 12 + depth * 22 }}>
                    <span style={{ fontWeight: depth === 0 ? 700 : 500, color: TEXT.heading }}>{depth > 0 && <span style={{ color: TEXT.muted }}>└ </span>}{g.name}</span>
                    <span style={{ ...mutedText, marginLeft: 8 }}>{g.code}</span>
                  </td>
                  <td style={tdStyle}>{NATURE_LABELS[g.nature] || g.nature}</td>
                  <td style={tdStyle}>{g.schedule_iii_label || g.schedule_iii_head}</td>
                  <td style={tdStyle}>{g.affects_gross_profit ? 'Yes' : '—'}</td>
                  <td style={numTd}>{g.ledger_count}</td>
                  <td style={tdStyle}><StatusPill status={g.is_system ? 'system' : 'custom'} colors={STATUS_HEX} labels={STATUS_LABELS} /></td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {canCreate && <button type="button" style={linkBtnStyle} onClick={() => startCreate(g.id)}>+ Sub-group</button>}
                      {canEdit && <button type="button" style={linkBtnStyle} onClick={() => startEdit(g)}>Edit</button>}
                      {deletable && canDelete('accounts', 'account_groups', null) && <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(g)}>Delete</button>}
                    </div>
                  </td>
                </tr>
              )
            })}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ledgers (chart of accounts)
// ---------------------------------------------------------------------------

function emptyLedgerForm() {
  // cost_object_required: '' = decide from the group (overheads need a cost centre), '1' / '0' = explicit.
  return { group_id: '', code: '', name: '', account_sub_type: '', status: 'active', is_posting_account: true, is_control_account: false,
    cost_object_required: '', default_cost_center_id: '' }
}

function LedgersSection({ onGoOpening }: { onGoOpening: () => void }) {
  const { can, canDelete } = useCan()
  const canCreate = can('accounts', 'ledgers', 'create')
  const canEdit = can('accounts', 'ledgers', 'edit')
  const [accounts, setAccounts] = useState<GLAccount[]>([])
  const [groups, setGroups] = useState<AccountGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyLedgerForm())
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<GLAccount | null>(null)
  const [ledgerCostCenters, setLedgerCostCenters] = useState<CostCenter[]>([])
  useEffect(() => { costCentersApi.listCostCenters().then(setLedgerCostCenters).catch(() => setLedgerCostCenters([])) }, [])

  const load = () => {
    Promise.all([accountsApi.listGLAccounts(), accountsApi.listAccountGroups()])
      .then(([a, g]) => { setAccounts(a); setGroups(g) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the chart of accounts')))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const tree = useMemo(() => groupTree(groups), [groups])
  const order = useMemo(() => new Map(tree.map((t, i) => [t.group.id, i])), [tree])
  const pathOf = useMemo(() => new Map(tree.map((t) => [t.group.id, t.path])), [tree])
  const groupOptions = tree.map((t) => ({ value: String(t.group.id), label: t.path }))

  /** The filter group plus all its descendants. */
  const filterIds = useMemo(() => {
    if (!groupFilter) return null
    const ids = new Set<number>([Number(groupFilter)])
    let grew = true
    while (grew) {
      grew = false
      for (const g of groups) if (g.parent_id && ids.has(g.parent_id) && !ids.has(g.id)) { ids.add(g.id); grew = true }
    }
    return ids
  }, [groupFilter, groups])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return accounts
      .filter((a) => (statusFilter === 'all' || a.status === statusFilter)
        && (!filterIds || (a.group_id != null && filterIds.has(a.group_id)))
        && (!q || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)))
      .sort((a, b) => (order.get(a.group_id ?? -1) ?? 9999) - (order.get(b.group_id ?? -1) ?? 9999) || a.code.localeCompare(b.code))
  }, [accounts, search, statusFilter, filterIds, order])

  const selectedGroup = groups.find((g) => String(g.id) === form.group_id)
  const isPl = selectedGroup?.nature === 'expense' || selectedGroup?.nature === 'revenue'

  const close = () => { setFormOpen(false); setEditingId(null); setForm(emptyLedgerForm()) }
  const startEdit = (a: GLAccount) => {
    setEditingId(a.id)
    setForm({
      group_id: a.group_id ? String(a.group_id) : '', code: a.code, name: a.name, account_sub_type: a.account_sub_type || '',
      status: a.status, is_posting_account: a.is_posting_account, is_control_account: a.is_control_account,
      cost_object_required: a.cost_object_required ? '1' : '0', default_cost_center_id: a.default_cost_center_id ? String(a.default_cost_center_id) : '',
    })
    setFormOpen(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError([])
    if (!form.group_id || !form.code.trim() || !form.name.trim()) {
      setError(['Group, code and name are required — the group decides where this ledger shows in the Balance Sheet / P&L.'])
      return
    }
    setSaving(true)
    try {
      const payload = {
        group_id: Number(form.group_id), code: form.code.trim(), name: form.name.trim(), account_sub_type: blank(form.account_sub_type),
        status: form.status, is_posting_account: form.is_posting_account, is_control_account: form.is_control_account,
        ...(isPl ? {
          cost_object_required: form.cost_object_required === '' ? null : form.cost_object_required === '1',
          default_cost_center_id: form.default_cost_center_id ? Number(form.default_cost_center_id) : null,
        } : { default_cost_center_id: null, ...(editingId ? { cost_object_required: false } : {}) }),
      }
      if (editingId) await accountsApi.updateGLAccount(editingId, payload)
      else await accountsApi.createGLAccount(payload)
      close()
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, editingId ? `Could not update ledger ${form.code}` : 'Could not create the ledger'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      await accountsApi.deleteGLAccount(target.id)
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not delete ledger ${target.code}`))
    }
  }

  let lastGroup: number | null | undefined = undefined

  return (
    <div style={sectionStyle} data-tour="fin-masters-ledgers">
      <SectionHeader title="Ledgers (chart of accounts)" action={canCreate && <button type="button" data-tour="fin-ledgers-new-btn" style={primaryBtnStyle} onClick={() => { setForm(emptyLedgerForm()); setEditingId(null); setFormOpen(true) }}>+ New Ledger</button>} />
      {!formOpen && <ErrorBanner error={error} />}
      <ConfirmDialog open={!!deleteTarget} title="Delete this ledger?" message={`Delete "${deleteTarget?.code} — ${deleteTarget?.name}"? A ledger with postings can't be deleted — set it to inactive instead.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      {formOpen && (
        <MasterSheet tour="fin-ledgers-form" formId="fin-ledgers-form-el" icon="rupee" editing={!!editingId} error={error}
          title={editingId ? `Edit ledger ${form.code}` : 'New ledger'}
          subtitle="A ledger's type (asset, liability, income…) comes from its group, so the two can never disagree."
          onClose={() => { setError([]); close() }} onSubmit={submit} saving={saving} label={editingId ? 'Save Changes' : 'Create Ledger'}>
          <SheetColumns
            left={<>
              <SheetSection icon="list" title="Ledger">
                <div style={sheetRow}>
                  <SF label="Group" req style={growW(260, 420)} tour="fin-ledgers-group">
                    <SearchableSelect value={form.group_id} onChange={(v: string) => setForm((f) => ({ ...f, group_id: v }))} options={groupOptions} placeholder="Pick account group" />
                  </SF>
                  <SF label="Type (from group)" style={fixedW(150)} tour="fin-ledgers-type">
                    <div style={readOnlyBox}>{selectedGroup ? NATURE_LABELS[selectedGroup.nature] : '—'}</div>
                  </SF>
                </div>
                <div style={sheetRow}>
                  <SF label="Code" req style={fixedW(130)} tour="fin-ledgers-code">
                    <input style={sheetInput} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
                  </SF>
                  <SF label="Name" req style={growW(240, 380)} tour="fin-ledgers-name">
                    <input style={sheetInput} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                  </SF>
                </div>
                <div style={sheetRow}>
                  <SF label="Sub-type" opt style={fixedW(200)} tour="fin-ledgers-subtype">
                    <input style={sheetInput} value={form.account_sub_type} onChange={(e) => setForm((f) => ({ ...f, account_sub_type: e.target.value }))} />
                  </SF>
                  <SF label="Status" style={fixedW(140)} tour="fin-ledgers-status">
                    <Select style={sheetInput} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </Select>
                  </SF>
                </div>
              </SheetSection>
              <p style={sheetHint}>
                Opening balances are not typed here — they are posted once as an Opening Balance voucher from the{' '}
                <button type="button" style={{ ...linkBtnStyle, fontSize: 12 }} onClick={onGoOpening}>Opening Balances</button> tab, so they are dated and auditable.
              </p>
            </>}
            right={<>
              <SheetSection icon="gear" title="Posting behaviour">
                <SF label="Posting" style={{ marginBottom: 12 }} tour="fin-ledgers-posting">
                  <Select style={sheetInput} value={form.is_posting_account ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, is_posting_account: e.target.value === '1' }))}>
                    <option value="1">Yes — vouchers post here</option>
                    <option value="0">No — header only</option>
                  </Select>
                </SF>
                <SF label="Control account" tour="fin-ledgers-control">
                  <Select style={sheetInput} value={form.is_control_account ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, is_control_account: e.target.value === '1' }))}>
                    <option value="0">No</option>
                    <option value="1">Yes — sum of a party sub-ledger</option>
                  </Select>
                </SF>
              </SheetSection>
              {isPl && (
                <SheetSection icon="building" title="Cost object">
                  <SF label="Cost object required" style={{ marginBottom: 12 }} tour="fin-ledgers-cost-object">
                    <Select style={sheetInput} value={form.cost_object_required} onChange={(e) => setForm((f) => ({ ...f, cost_object_required: e.target.value }))}>
                      {!editingId && <option value="">Auto — overheads need one</option>}
                      <option value="1">Yes — cost centre or order</option>
                      <option value="0">No</option>
                    </Select>
                  </SF>
                  <SF label="Default cost centre" opt tour="fin-ledgers-default-cc">
                    <SearchableSelect value={form.default_cost_center_id} onChange={(v: string) => setForm((f) => ({ ...f, default_cost_center_id: v }))}
                      options={[{ value: '', label: '— None —' }, ...ledgerCostCenters.filter((c) => c.status === 'active').map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }))]}
                      placeholder="None" />
                  </SF>
                </SheetSection>
              )}
            </>}
          />
        </MasterSheet>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14, alignItems: 'flex-end' }}>
        <Field label="Search" style={growW(220, 300)} tour="fin-ledgers-search">
          <input style={inputStyle} value={search} placeholder="Code or name" onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <Field label="Group (incl. sub-groups)" style={growW(260, 380)} tour="fin-ledgers-group-filter">
          <SearchableSelect value={groupFilter} onChange={setGroupFilter} options={[{ value: '', label: 'All groups' }, ...groupOptions]} placeholder="All groups" />
        </Field>
        <Field label="Status" style={fixedW(130)} tour="fin-ledgers-status-filter">
          <Select style={inputStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
        <span style={{ ...mutedText, paddingBottom: 10 }}>{visible.length} of {accounts.length} ledgers</span>
      </div>

      <TableWrap minWidth={900} tour="fin-ledgers-table">
        <thead>
          <tr>
            <th style={thStyle}>Code <RowCount count={visible.length} /></th><th style={thStyle}>Name</th><th style={thStyle}>Type</th><th style={thStyle}>Flags</th>
            <th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={6} text="Loading…" /> : visible.length === 0 ? <EmptyRow colSpan={6} text="No ledgers match the filters — clear the search or set Status to All." /> :
            visible.flatMap((a) => {
              const rows: React.ReactNode[] = []
              if (a.group_id !== lastGroup) {
                lastGroup = a.group_id
                rows.push(
                  <tr key={`g-${a.group_id ?? 'none'}`}>
                    <td colSpan={6} style={{ ...tdStyle, background: 'rgba(253,241,230,.55)', fontWeight: 700, fontSize: 12, color: TEXT.secondary }}>
                      {a.group_id ? pathOf.get(a.group_id) || a.group_name : 'No group (legacy) — edit to assign one'}
                    </td>
                  </tr>,
                )
              }
              rows.push(
                <tr key={a.id}>
                  <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{a.code}</td>
                  <td style={tdStyle}>{a.name}{a.account_sub_type && <span style={{ ...mutedText, marginLeft: 6 }}>({a.account_sub_type})</span>}</td>
                  <td style={tdStyle}>{NATURE_LABELS[a.account_type] || a.account_type}</td>
                  <td style={tdStyle}>{[a.is_posting_account ? 'Posting' : 'Header', a.is_control_account ? 'Control' : null, a.cost_object_required ? 'Cost centre req.' : null].filter(Boolean).join(' · ')}</td>
                  <td style={tdStyle}><StatusPill status={a.status} colors={STATUS_HEX} labels={STATUS_LABELS} /></td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {canEdit && <button type="button" style={linkBtnStyle} onClick={() => startEdit(a)}>Edit</button>}
                      {canDelete('accounts', 'ledgers', null) && <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(a)}>Delete</button>}
                    </div>
                  </td>
                </tr>,
              )
              return rows
            })}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ledger Settings (account determination)
// ---------------------------------------------------------------------------

function LedgerSettingsSection({ canManage }: { canManage: boolean }) {
  const [settings, setSettings] = useState<LedgerSetting[]>([])
  const [accounts, setAccounts] = useState<GLAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [savingRole, setSavingRole] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([accountsApi.getLedgerSettings(), accountsApi.listGLAccounts()])
      .then(([s, a]) => { setSettings(s); setAccounts(a) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load ledger settings')))
      .finally(() => setLoading(false))
  }, [])

  const options = useMemo(() => ledgerOptions(accounts), [accounts])

  const change = async (s: LedgerSetting, glId: number | null) => {
    setError([])
    setSavingRole(s.role)
    try {
      setSettings(await accountsApi.updateLedgerSetting(s.role, glId))
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not change the ledger for '${s.label}'`))
    } finally {
      setSavingRole(null)
    }
  }

  return (
    <div style={sectionStyle} data-tour="fin-masters-ledger-settings">
      <SectionHeader title="Ledger settings — automatic postings" />
      <ErrorBanner error={error} />
      <InfoBanner>
        When the system posts on its own (a purchase invoice, a sales invoice, GST, round-off, closing stock), it needs to know which ledger
        plays each role. Defaults come from the standard chart; change one only if your chart uses a different ledger. Changing a role affects
        new postings only — past vouchers stay where they were posted.
      </InfoBanner>
      {!canManage && <InfoBanner tone="warning">Only a Finance Manager (or admin) can change these. Ask an admin to tick &apos;Finance Manager&apos; on your user.</InfoBanner>}

      <TableWrap minWidth={900} tour="fin-ledger-settings-table">
        <thead>
          <tr><th style={thStyle}>Role <RowCount count={settings.length} /></th><th style={thStyle}>Current ledger</th><th style={thStyle}>Standard code</th><th style={thStyle}>Change to</th><th style={thStyle}></th></tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={5} text="Loading…" /> : settings.length === 0 ? <EmptyRow colSpan={5} text="No ledger roles defined." /> :
            settings.map((s) => (
              <tr key={s.role}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{s.label}</td>
                <td style={tdStyle}>
                  {s.gl_account_id ? `${s.gl_account_code} — ${s.gl_account_name}` : <span style={{ color: '#b91c1c' }}>Not found — pick a ledger</span>}
                  <span style={{ marginLeft: 8 }}><StatusPill status={s.is_default ? 'default' : 'changed'} colors={STATUS_HEX} labels={STATUS_LABELS} /></span>
                </td>
                <td style={{ ...tdStyle, color: TEXT.muted }}>{s.default_code}</td>
                <td style={{ ...tdStyle, minWidth: 280 }}>
                  <SearchableSelect value={s.gl_account_id ? String(s.gl_account_id) : ''} disabled={!canManage || savingRole === s.role}
                    onChange={(v: string) => { if (v && Number(v) !== s.gl_account_id) change(s, Number(v)) }} options={options} placeholder="Pick ledger" />
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {savingRole === s.role ? <span style={mutedText}>Saving…</span> : !s.is_default && canManage && (
                    <button type="button" style={linkBtnStyle} onClick={() => change(s, null)}>Reset to default</button>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GST Rates
// ---------------------------------------------------------------------------

function GSTRatesSection({ canManage }: { canManage: boolean }) {
  const { can } = useCan()
  const canCreate = can('accounts', 'gst_rates', 'create')
  const canEdit = can('accounts', 'gst_rates', 'edit')
  const [rates, setRates] = useState<GSTRate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [form, setForm] = useState({ rate: '', description: '', is_active: true })
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const editRate = editId != null ? rates.find((r) => r.id === editId) || null : null

  const load = () => {
    accountsApi.listGstRates()
      .then(setRates)
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load GST rates')))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setError([])
    if (form.rate.trim() === '') { setError(['Enter the rate in percent (e.g. 18).']); return }
    setSaving(true)
    try {
      await accountsApi.createGstRate({ rate: Number(form.rate), description: blank(form.description), is_active: form.is_active })
      setForm({ rate: '', description: '', is_active: true })
      setAddOpen(false)
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not add GST rate ${form.rate}%`))
    } finally {
      setSaving(false)
    }
  }

  const update = async (r: GSTRate, payload: Record<string, unknown>) => {
    setError([])
    try {
      await accountsApi.updateGstRate(r.id, payload)
      setEditId(null)
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not update GST rate ${r.rate}%`))
    }
  }

  return (
    <div style={sectionStyle} data-tour="fin-masters-gst-rates">
      <SectionHeader title="GST rates" action={canManage && canCreate && (
        <button type="button" data-tour="fin-gst-new-btn" style={primaryBtnStyle} onClick={() => { setError([]); setForm({ rate: '', description: '', is_active: true }); setAddOpen(true) }}>+ Add Rate</button>
      )} />
      {!addOpen && editId == null && <ErrorBanner error={error} />}
      <InfoBanner>
        From 22-Sep-2025 the GST slabs are 0%, 5%, 18% and 40% — the 12% and 28% slabs were withdrawn. They are kept as inactive rates so
        documents dated before that (and credit/debit notes against them) can still be read. An inactive rate simply stops appearing on new
        invoice lines.
      </InfoBanner>
      {!canManage && <InfoBanner tone="warning">Only a Finance Manager (or admin) can add or change GST rates.</InfoBanner>}

      {addOpen && canManage && canCreate && (
        <FormSheet tour="fin-gst-form" width={560} icon="tag" title="Add GST rate" subtitle="A new slab offered in the GST % dropdown on invoice and note lines."
          onClose={() => { setError([]); setAddOpen(false) }} busy={saving}
          footer={<>
            <button type="button" onClick={() => { setError([]); setAddOpen(false) }} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="submit" form="fin-gst-form-el" data-tour="fin-gst-add-btn" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="plus" size={16} />{saving ? 'Saving…' : 'Add Rate'}</button>
          </>}>
          <form id="fin-gst-form-el" onSubmit={add} style={{ padding: '20px 24px' }}>
            <ErrorBanner error={error} />
            <SheetSection icon="tag" title="Rate">
              <div style={sheetRow}>
                <SF label="Rate %" req style={fixedW(110)} tour="fin-gst-rate">
                  <input type="number" min={0} max={100} step="any" style={sheetInput} value={form.rate} autoFocus onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
                </SF>
                <SF label="Status" style={fixedW(140)} tour="fin-gst-status">
                  <Select style={sheetInput} value={form.is_active ? '1' : '0'} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === '1' }))}>
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                  </Select>
                </SF>
              </div>
              <SF label="Description" opt tour="fin-gst-description">
                <input style={sheetInput} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Standard rate" />
              </SF>
              <p style={sheetHint}>An inactive rate is kept for old documents but not offered on new lines. Rates are never deleted.</p>
            </SheetSection>
          </form>
        </FormSheet>
      )}
      {editRate && (
        <FormSheet tour="fin-gst-edit-form" width={560} icon="edit" title={`Edit GST rate ${editRate.rate}%`} subtitle="Change the label shown next to this rate."
          onClose={() => { setError([]); setEditId(null) }} busy={saving}
          footer={<>
            <button type="button" onClick={() => { setError([]); setEditId(null) }} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="submit" form="fin-gst-edit-form-el" disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save'}</button>
          </>}>
          <form id="fin-gst-edit-form-el" style={{ padding: '20px 24px' }} onSubmit={async (e) => {
            e.preventDefault()
            setSaving(true)
            try { await update(editRate, { description: blank(editDesc) }) } finally { setSaving(false) }
          }}>
            <ErrorBanner error={error} />
            <SF label="Description" opt>
              <input style={sheetInput} value={editDesc} autoFocus onChange={(e) => setEditDesc(e.target.value)} />
            </SF>
          </form>
        </FormSheet>
      )}

      <TableWrap minWidth={640} tour="fin-gst-table">
        <thead>
          <tr><th style={numTh}>Rate <RowCount count={rates.length} /></th><th style={thStyle}>Description</th><th style={thStyle}>Status</th><th style={thStyle}></th></tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={4} text="Loading…" /> : rates.length === 0 ? <EmptyRow colSpan={4} text="No GST rates yet — use + Add Rate." /> :
            rates.map((r) => (
              <tr key={r.id}>
                <td style={{ ...numTd, fontWeight: 700, width: 90 }}>{r.rate}%</td>
                <td style={tdStyle}>{r.description || <span style={{ color: TEXT.muted }}>—</span>}</td>
                <td style={tdStyle}><StatusPill status={r.is_active ? 'active' : 'inactive'} colors={STATUS_HEX} labels={STATUS_LABELS} /></td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {canManage && canEdit && (
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button type="button" style={linkBtnStyle} onClick={() => { setEditId(r.id); setEditDesc(r.description || '') }}>Edit description</button>
                      <button type="button" style={r.is_active ? dangerLinkStyle : linkBtnStyle} onClick={() => update(r, { is_active: !r.is_active })}>
                        {r.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bank & Cash
// ---------------------------------------------------------------------------

function emptyBankForm() {
  return { account_kind: 'bank' as 'bank' | 'cash', bank_name: '', account_no: '', account_holder_name: '', branch_name: '', ifsc_code: '', gl_account_id: '', status: 'active' }
}

function BankCashSection({ onGoOpening }: { onGoOpening: () => void }) {
  const { can, canDelete } = useCan()
  const canCreate = can('accounts', 'bank_cash_accounts', 'create')
  const canEdit = can('accounts', 'bank_cash_accounts', 'edit')
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [ledgers, setLedgers] = useState<GLAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyBankForm())
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BankAccount | null>(null)

  const load = () => {
    Promise.all([accountsApi.listBankAccounts(), accountsApi.listGLAccounts()])
      .then(([b, l]) => { setAccounts(b); setLedgers(l) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load bank & cash accounts')))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const isBank = form.account_kind === 'bank'
  /** Ledgers in the matching group first (Bank Accounts / Cash-in-Hand), then any other asset posting ledger. */
  const ledgerOpts = useMemo(() => {
    const wanted = isBank ? 'bank accounts' : 'cash-in-hand'
    const assets = ledgers.filter((a) => a.account_type === 'asset' && !a.is_control_account)
    const match = (a: GLAccount) => (a.group_name || '').toLowerCase() === wanted
    return [...ledgerOptions(assets, match), ...ledgerOptions(assets, (a) => !match(a))]
  }, [ledgers, isBank])

  const close = () => { setFormOpen(false); setEditingId(null); setForm(emptyBankForm()) }
  const startEdit = (a: BankAccount) => {
    setEditingId(a.id)
    setForm({
      account_kind: a.account_kind || 'bank', bank_name: a.bank_name, account_no: a.account_no || '', account_holder_name: a.account_holder_name || '',
      branch_name: a.branch_name || '', ifsc_code: a.ifsc_code || '', gl_account_id: a.gl_account_id ? String(a.gl_account_id) : '', status: a.status,
    })
    setFormOpen(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError([])
    const missing = [!form.bank_name.trim() && (isBank ? 'bank name' : 'account name'), isBank && !form.account_no.trim() && 'account number', !form.gl_account_id && 'linked GL ledger'].filter(Boolean)
    if (missing.length) { setError([`Fill in the ${missing.join(', ')}.`]); return }
    setSaving(true)
    try {
      const payload = {
        account_kind: form.account_kind, bank_name: form.bank_name.trim(), gl_account_id: Number(form.gl_account_id), status: form.status,
        account_no: isBank ? blank(form.account_no) : null, account_holder_name: isBank ? blank(form.account_holder_name) : null,
        branch_name: isBank ? blank(form.branch_name) : null, ifsc_code: isBank ? blank(form.ifsc_code.toUpperCase()) : null,
      }
      if (editingId) await accountsApi.updateBankAccount(editingId, payload)
      else await accountsApi.createBankAccount(payload)
      close()
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, editingId ? `Could not update '${form.bank_name}'` : 'Could not create the bank/cash account'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      await accountsApi.deleteBankAccount(target.id)
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not delete '${target.bank_name}'`))
    }
  }

  return (
    <div style={sectionStyle} data-tour="fin-masters-bank-cash">
      <SectionHeader title="Bank & cash accounts" action={canCreate && <button type="button" data-tour="fin-bank-new-btn" style={primaryBtnStyle} onClick={() => { setEditingId(null); setForm(emptyBankForm()); setFormOpen(true) }}>+ New Account</button>} />
      {!formOpen && <ErrorBanner error={error} />}
      <ConfirmDialog open={!!deleteTarget} title="Delete this account?" message={`Delete "${deleteTarget?.bank_name}"? An account with vouchers can't be deleted — set it to closed instead.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      {formOpen && (
        <MasterSheet tour="fin-bank-form" formId="fin-bank-form-el" icon="building" editing={!!editingId} error={error}
          title={editingId ? `Edit '${form.bank_name}'` : 'New bank / cash account'}
          subtitle="Each bank or cash account posts to its own GL ledger — its balance per books is that ledger's balance."
          onClose={() => { setError([]); close() }} onSubmit={submit} saving={saving} label={editingId ? 'Save Changes' : 'Create Account'}>
          <SheetColumns
            left={<>
              <SheetSection icon="building" title="Account">
                <div style={sheetRow}>
                  <SF label="Kind" style={fixedW(120)} tour="fin-bank-kind">
                    <Select style={sheetInput} value={form.account_kind} onChange={(e) => setForm((f) => ({ ...f, account_kind: e.target.value as 'bank' | 'cash', gl_account_id: '' }))}>
                      <option value="bank">Bank</option>
                      <option value="cash">Cash</option>
                    </Select>
                  </SF>
                  <SF label={isBank ? 'Bank name' : 'Account name'} req style={growW(220, 340)} tour="fin-bank-name">
                    <input style={sheetInput} value={form.bank_name} placeholder={isBank ? 'e.g. HDFC Bank' : 'e.g. Head Office Cash'} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} />
                  </SF>
                </div>
                {isBank && (
                  <>
                    <div style={sheetRow}>
                      <SF label="Account no." req style={fixedW(200)} tour="fin-bank-account-no">
                        <input style={sheetInput} value={form.account_no} onChange={(e) => setForm((f) => ({ ...f, account_no: e.target.value }))} />
                      </SF>
                      <SF label="Account holder" style={growW(200, 320)} tour="fin-bank-holder">
                        <input style={sheetInput} value={form.account_holder_name} onChange={(e) => setForm((f) => ({ ...f, account_holder_name: e.target.value }))} />
                      </SF>
                    </div>
                    <div style={sheetRow}>
                      <SF label="IFSC" style={fixedW(150)} tour="fin-bank-ifsc">
                        <input style={sheetInput} value={form.ifsc_code} maxLength={11} onChange={(e) => setForm((f) => ({ ...f, ifsc_code: e.target.value.toUpperCase() }))} />
                      </SF>
                      <SF label="Branch" style={growW(180, 300)} tour="fin-bank-branch">
                        <input style={sheetInput} value={form.branch_name} onChange={(e) => setForm((f) => ({ ...f, branch_name: e.target.value }))} />
                      </SF>
                    </div>
                  </>
                )}
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="rupee" title="Books">
                <SF label={`GL ledger (${isBank ? 'Bank Accounts' : 'Cash-in-Hand'} first)`} req style={{ marginBottom: 12 }} tour="fin-bank-ledger">
                  <SearchableSelect value={form.gl_account_id} onChange={(v: string) => setForm((f) => ({ ...f, gl_account_id: v }))} options={ledgerOpts} placeholder="Pick ledger" />
                </SF>
                <SF label="Status" style={fixedW(150)} tour="fin-bank-status">
                  <Select style={sheetInput} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="closed">Closed</option>
                  </Select>
                </SF>
                <p style={sheetHint}>
                  Opening balances go in once through the{' '}
                  <button type="button" style={{ ...linkBtnStyle, fontSize: 12 }} onClick={onGoOpening}>Opening Balances</button> tab. Once vouchers exist the ledger can&apos;t change.
                </p>
              </SheetSection>
            </>}
          />
        </MasterSheet>
      )}

      <TableWrap minWidth={1000} tour="fin-bank-table">
        <thead>
          <tr>
            <th style={thStyle}>Kind <RowCount count={accounts.length} /></th><th style={thStyle}>Name</th><th style={thStyle}>Account no.</th><th style={thStyle}>IFSC / Branch</th>
            <th style={thStyle}>Ledger</th><th style={numTh}>Balance per books (₹)</th><th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={8} text="Loading…" /> : accounts.length === 0 ? <EmptyRow colSpan={8} text="No bank or cash accounts yet — use + New Account to add your bank and cash-in-hand." /> :
            accounts.map((a) => (
              <tr key={a.id}>
                <td style={{ ...tdStyle, textTransform: 'capitalize' }}>{a.account_kind}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{a.bank_name}</td>
                <td style={tdStyle}>{a.account_no || '—'}</td>
                <td style={tdStyle}>{[a.ifsc_code, a.branch_name].filter(Boolean).join(' · ') || '—'}</td>
                <td style={tdStyle}>{a.gl_account_code || <span style={{ color: '#b91c1c' }}>Not linked</span>}</td>
                <td style={numTd}>{inr(a.book_balance)}</td>
                <td style={tdStyle}><StatusPill status={a.status} colors={STATUS_HEX} labels={STATUS_LABELS} /></td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {canEdit && <button type="button" style={linkBtnStyle} onClick={() => startEdit(a)}>Edit</button>}
                    {canDelete('accounts', 'bank_cash_accounts', null) && <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(a)}>Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

const GST_REG_LABELS: Record<string, string> = {
  regular: 'Regular', composition: 'Composition', unregistered: 'Unregistered', overseas: 'Overseas (import)', sez: 'SEZ',
}

const VENDOR_STATUS_OPTS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'blocked', label: 'Blocked' }]

function emptyVendor() {
  return {
    code: '', name: '', gst_registration_type: 'regular', gstin: '', pan: '', address: '', city: '', state: '', pin_code: '',
    contact_name: '', contact_phone: '', contact_email: '', bank_name: '', bank_account_no: '', ifsc_code: '', account_holder_name: '',
    credit_limit: '', payment_days: '', default_expense_gl_account_id: '', status: 'active',
  }
}

function VendorsSection() {
  const { can, canDelete, canFeature } = useCan()
  const canCreate = can('accounts', 'vendors', 'create')
  const canEdit = can('accounts', 'vendors', 'edit')
  // Vendors › Bank details (feature): without view the API blanks them; without
  // create / edit the fields are read-only and are not sent on save.
  const seeBank = canFeature('accounts', 'vendors', 'bank_details', 'view')
  const [bankWritable, setBankWritable] = useState(false)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [ledgers, setLedgers] = useState<GLAccount[]>([])
  const [stateNames, setStateNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyVendor())
  const [referral, setReferral] = useState<ReferralValue>(EMPTY_REFERRAL)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Vendor | null>(null)

  const load = () => {
    Promise.all([accountsApi.listVendors(), accountsApi.listGLAccounts(), accountsApi.getSetup()])
      .then(([v, l, s]: [Vendor[], GLAccount[], AccountsSetup]) => {
        setVendors(v); setLedgers(l)
        setStateNames(Array.from(new Set(Object.values(s.state_codes || {}))).sort())
      })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load vendors')))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const expenseOpts = useMemo(() => [{ value: '', label: '— None —' }, ...ledgerOptions(ledgers, (a) => a.account_type === 'expense')], [ledgers])
  const stateOpts = useMemo(() => {
    const names = form.state && !stateNames.includes(form.state) ? [form.state, ...stateNames] : stateNames
    return [{ value: '', label: '— None —' }, ...names.map((n) => ({ value: n, label: n }))]
  }, [stateNames, form.state])
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? vendors.filter((v) => [v.code, v.name, v.gstin, v.city].some((x) => (x || '').toLowerCase().includes(q))) : vendors
  }, [vendors, search])

  const set = (k: keyof ReturnType<typeof emptyVendor>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const close = () => { setFormOpen(false); setEditingId(null); setEditingVendor(null); setReferral(EMPTY_REFERRAL); setForm(emptyVendor()) }
  const startEdit = (v: Vendor) => {
    setEditingId(v.id)
    setEditingVendor(v)
    setReferral(referralFromVendor(v))
    setBankWritable(canFeature('accounts', 'vendors', 'bank_details', 'edit'))
    setForm({
      code: v.code, name: v.name, gst_registration_type: v.gst_registration_type || (v.gstin ? 'regular' : 'unregistered'),
      gstin: v.gstin || '', pan: v.pan || '', address: v.address || '', city: v.city || '', state: v.state || '', pin_code: v.pin_code || '',
      contact_name: v.contact_name || '', contact_phone: v.contact_phone || '', contact_email: v.contact_email || '',
      bank_name: v.bank_name || '', bank_account_no: v.bank_account_no || '', ifsc_code: v.ifsc_code || '', account_holder_name: v.account_holder_name || '',
      credit_limit: v.credit_limit != null ? String(v.credit_limit) : '', payment_days: v.payment_days != null ? String(v.payment_days) : '',
      default_expense_gl_account_id: v.default_expense_gl_account_id ? String(v.default_expense_gl_account_id) : '', status: v.status,
    })
    setFormOpen(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError([])
    if (!form.code.trim() || !form.name.trim()) { setError(['Vendor code and name are required.']); return }
    // Required for a new vendor; an older vendor with nothing recorded can be saved without it.
    const refErr = referralError(referral, !editingVendor || !!editingVendor.referral_type)
    if (refErr) { setError([refErr]); return }
    setSaving(true)
    try {
      const payload = {
        code: form.code.trim(), name: form.name.trim(), gst_registration_type: form.gst_registration_type,
        gstin: blank(form.gstin.toUpperCase()), pan: blank(form.pan.toUpperCase()), address: blank(form.address), city: blank(form.city),
        state: blank(form.state), pin_code: blank(form.pin_code), contact_name: blank(form.contact_name), contact_phone: blank(form.contact_phone),
        contact_email: blank(form.contact_email),
        ...(bankWritable ? {
          bank_name: blank(form.bank_name), bank_account_no: blank(form.bank_account_no),
          ifsc_code: blank(form.ifsc_code.toUpperCase()), account_holder_name: blank(form.account_holder_name),
        } : {}),
        credit_limit: num(form.credit_limit), payment_days: num(form.payment_days),
        default_expense_gl_account_id: form.default_expense_gl_account_id ? Number(form.default_expense_gl_account_id) : null, status: form.status,
        ...referralPayload(referral),
      }
      if (editingId) await accountsApi.updateVendor(editingId, payload)
      else await accountsApi.createVendor(payload)
      close()
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, editingId ? `Could not update vendor '${form.name}'` : 'Could not create the vendor'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      await accountsApi.deleteVendor(target.id)
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not delete vendor '${target.name}'`))
    }
  }

  const needsGstin = form.gst_registration_type === 'regular' || form.gst_registration_type === 'composition' || form.gst_registration_type === 'sez'

  return (
    <div style={sectionStyle} data-tour="fin-masters-vendors">
      <SectionHeader title="Vendors" action={canCreate && <button type="button" data-tour="fin-vendors-new-btn" style={primaryBtnStyle} onClick={() => { setEditingId(null); setEditingVendor(null); setReferral(EMPTY_REFERRAL); setForm(emptyVendor()); setBankWritable(canFeature('accounts', 'vendors', 'bank_details', 'create')); setFormOpen(true) }}>+ New Vendor</button>} />
      {!formOpen && <ErrorBanner error={error} />}
      <ConfirmDialog open={!!deleteTarget} title="Delete this vendor?" message={`Delete "${deleteTarget?.name}"? A vendor with invoices or ledger entries can't be deleted — set it to inactive or blocked instead.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />

      {formOpen && (
        <MasterSheet tour="fin-vendors-form" formId="fin-vendors-form-el" icon="truck" editing={!!editingId} error={error}
          title={editingId ? `Edit vendor '${form.name}'` : 'New vendor'}
          subtitle="Vendors are a sub-ledger: their bills post through the Sundry Creditors control account."
          onClose={() => { setError([]); close() }} onSubmit={submit} saving={saving} label={editingId ? 'Save Changes' : 'Create Vendor'}>
          <SheetColumns
            left={<>
              <SheetSection icon="building" title="Vendor">
                <div style={sheetRow}>
                  <SF label="Code" req style={fixedW(130)} tour="fin-vendors-code"><input style={sheetInput} value={form.code} onChange={set('code')} /></SF>
                  <SF label="Name" req style={growW(240, 380)} tour="fin-vendors-name"><input style={sheetInput} value={form.name} onChange={set('name')} /></SF>
                </div>
                <SF label="Status" style={fixedW(170)} tour="fin-vendors-status">
                  <SearchableSelect value={form.status} onChange={(v: string) => setForm((f) => ({ ...f, status: v }))} options={VENDOR_STATUS_OPTS} placeholder="Status" />
                </SF>
              </SheetSection>
              <SheetSection icon="shield" title="GST & PAN">
                <div style={sheetRow}>
                  <SF label="GST registration" style={fixedW(180)} tour="fin-vendors-gst-type">
                    <SearchableSelect value={form.gst_registration_type} onChange={(v: string) => setForm((f) => ({ ...f, gst_registration_type: v }))}
                      options={Object.entries(GST_REG_LABELS).map(([k, l]) => ({ value: k, label: l }))} placeholder="GST registration" />
                  </SF>
                  <SF label="GSTIN" req={needsGstin} style={fixedW(200)} tour="fin-vendors-gstin">
                    <input style={sheetInput} value={form.gstin} maxLength={15} onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))} placeholder="15 characters" />
                  </SF>
                  <SF label="PAN" style={fixedW(150)} tour="fin-vendors-pan">
                    <input style={sheetInput} value={form.pan} maxLength={10} onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase() }))} />
                  </SF>
                </div>
                <p style={sheetHint}>
                  The GSTIN is checked (format + check digit) and fills PAN automatically. Input credit is claimable only from regular-registered
                  suppliers; composition and unregistered vendors charge no GST you can take credit for.
                </p>
              </SheetSection>
              <SheetSection icon="building" title="Address">
                <SF label="Address" style={{ marginBottom: 12 }} tour="fin-vendors-address"><input style={sheetInput} value={form.address} onChange={set('address')} /></SF>
                <div style={sheetRow}>
                  <SF label="City" style={fixedW(160)} tour="fin-vendors-city"><input style={sheetInput} value={form.city} onChange={set('city')} /></SF>
                  <SF label="State (place of supply)" style={growW(200, 260)} tour="fin-vendors-state">
                    <SearchableSelect value={form.state} onChange={(v: string) => setForm((f) => ({ ...f, state: v }))} options={stateOpts} placeholder="Pick state" />
                  </SF>
                  <SF label="PIN" style={fixedW(100)} tour="fin-vendors-pin"><input style={sheetInput} value={form.pin_code} maxLength={6} onChange={set('pin_code')} /></SF>
                </div>
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="user" title="Contact" extra={<Optional />}>
                <SF label="Contact name" style={{ marginBottom: 12 }} tour="fin-vendors-contact-name"><input style={sheetInput} value={form.contact_name} onChange={set('contact_name')} /></SF>
                <div style={sheetRow}>
                  <SF label="Phone" style={fixedW(150)} tour="fin-vendors-contact-phone"><input style={sheetInput} value={form.contact_phone} onChange={set('contact_phone')} /></SF>
                  <SF label="Email" style={growW(180, 300)} tour="fin-vendors-contact-email"><input style={sheetInput} value={form.contact_email} onChange={set('contact_email')} /></SF>
                </div>
              </SheetSection>
              <VendorReferralSection value={referral} onChange={setReferral} required={!editingVendor || !!editingVendor.referral_type} tour="fin-vendors-referred-by"
                current={editingVendor?.referred_by_user_id ? { id: editingVendor.referred_by_user_id, name: editingVendor.referred_by_user_name || 'Former employee' } : null} />
              {editingVendor && (
                <SheetSection icon="clock" title="Record">
                  <p style={{ ...sheetHint, margin: 0 }}>Created by {editingVendor.created_by_name || '—'}{editingVendor.created_at ? ` on ${new Date(editingVendor.created_at).toLocaleDateString('en-GB')}` : ''}</p>
                </SheetSection>
              )}
              {seeBank && (
              <SheetSection icon="rupee" title="Bank details" extra={<Optional />}>
                <div style={sheetRow}>
                  <SF label="Bank name" style={growW(160, 260)} tour="fin-vendors-bank-name"><input style={sheetInput} value={form.bank_name} disabled={!bankWritable} onChange={set('bank_name')} /></SF>
                  <SF label="Account no." style={fixedW(180)} tour="fin-vendors-bank-account"><input style={sheetInput} value={form.bank_account_no} disabled={!bankWritable} onChange={set('bank_account_no')} /></SF>
                </div>
                <div style={sheetRow}>
                  <SF label="IFSC" style={fixedW(140)} tour="fin-vendors-ifsc">
                    <input style={sheetInput} value={form.ifsc_code} maxLength={11} disabled={!bankWritable} onChange={(e) => setForm((f) => ({ ...f, ifsc_code: e.target.value.toUpperCase() }))} />
                  </SF>
                  <SF label="Account holder" style={growW(160, 260)} tour="fin-vendors-holder"><input style={sheetInput} value={form.account_holder_name} disabled={!bankWritable} onChange={set('account_holder_name')} /></SF>
                </div>
                {!bankWritable && <p style={sheetHint}>Your role can see but not change vendor bank details (Vendors › Vendor bank details). Ask a Finance admin to update them.</p>}
              </SheetSection>
              )}
              <SheetSection icon="clock" title="Terms & posting">
                <div style={sheetRow}>
                  <SF label="Credit limit (₹)" style={fixedW(150)} tour="fin-vendors-credit-limit"><input type="number" min={0} style={sheetInput} value={form.credit_limit} onChange={set('credit_limit')} /></SF>
                  <SF label="Payment days" style={fixedW(120)} tour="fin-vendors-payment-days"><input type="number" min={0} style={sheetInput} value={form.payment_days} onChange={set('payment_days')} /></SF>
                </div>
                <SF label="Default expense ledger" tour="fin-vendors-expense-ledger">
                  <SearchableSelect value={form.default_expense_gl_account_id} onChange={(v: string) => setForm((f) => ({ ...f, default_expense_gl_account_id: v }))} options={expenseOpts} placeholder="— None —" />
                </SF>
              </SheetSection>
            </>}
          />
        </MasterSheet>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'flex-end' }}>
        <Field label="Search" style={growW(240, 320)} tour="fin-vendors-search">
          <input style={inputStyle} value={search} placeholder="Code, name, GSTIN or city" onChange={(e) => setSearch(e.target.value)} />
        </Field>
      </div>

      <TableWrap minWidth={1200} tour="fin-vendors-table">
        <thead>
          <tr>
            <th style={thStyle}>Code <RowCount count={visible.length} /></th><th style={thStyle}>Name</th><th style={thStyle}>GST type</th><th style={thStyle}>GSTIN</th>
            <th style={thStyle}>City / State</th><th style={numTh}>Payment days</th><th style={thStyle}>Referred by</th><th style={thStyle}>Created by</th><th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={10} text="Loading…" /> : visible.length === 0 ? <EmptyRow colSpan={10} text={vendors.length ? 'No vendors match the search — clear it to see all.' : 'No vendors yet — use + New Vendor.'} /> :
            visible.map((v) => (
              <tr key={v.id}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{v.code}</td>
                <td style={tdStyle}>{v.name}</td>
                <td style={tdStyle}>{GST_REG_LABELS[v.gst_registration_type || ''] || '—'}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{v.gstin || '—'}</td>
                <td style={tdStyle}>{[v.city, v.state].filter(Boolean).join(', ') || '—'}</td>
                <td style={numTd}>{v.payment_days ?? '—'}</td>
                <td style={tdStyle}>{v.referred_by_label || '—'}</td>
                <td style={tdStyle} title={v.created_at ? new Date(v.created_at).toLocaleDateString('en-GB') : undefined}>{v.created_by_name || '—'}</td>
                <td style={tdStyle}><StatusPill status={v.status} colors={STATUS_HEX} labels={STATUS_LABELS} /></td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {canEdit && <button type="button" style={linkBtnStyle} onClick={() => startEdit(v)}>Edit</button>}
                    {canDelete('accounts', 'vendors', v.created_by_id ?? null) && <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(v)}>Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Internal Orders
// ---------------------------------------------------------------------------

const IO_NEXT: Record<string, string[]> = { open: ['in_progress'], in_progress: ['completed'], completed: ['in_progress', 'closed'], closed: ['in_progress'] }
const IO_ACTION: Record<string, { label: string; message: string }> = {
  in_progress: { label: 'Start', message: 'The order is released and keeps taking postings.' },
  completed: { label: 'Complete', message: 'Work is done (technically complete): no new postings are allowed. It can be set back to In progress if a late bill arrives.' },
  closed: { label: 'Close', message: 'Closing is final: no postings, and reopening needs a Partner’s approval. Open purchase orders on it must be invoiced or moved first.' },
}

function emptyInternalOrder() {
  return { code: '', name: '', description: '', order_type: 'capital', start_date: '', end_date: '', budgeted_amount: '', cost_center_id: '', status: 'open' }
}

function InternalOrdersSection() {
  const { can, canDelete } = useCan()
  const canCreate = can('accounts', 'internal_orders', 'create')
  const canEdit = can('accounts', 'internal_orders', 'edit')
  const [orders, setOrders] = useState<InternalOrder[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyInternalOrder())
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<InternalOrder | null>(null)
  // Status moves (KO02): open → in progress → completed → closed; completed → in progress; closed → reopen (Partner approval).
  const [statusTarget, setStatusTarget] = useState<{ order: InternalOrder; to: string } | null>(null)
  const [notice, setNotice] = useState('')

  const load = () => {
    Promise.all([accountsApi.listInternalOrders(), costCentersApi.listCostCenters()])
      .then(([o, cc]) => { setOrders(o); setCostCenters(cc) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load internal orders')))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const close = () => { setFormOpen(false); setEditingId(null); setForm(emptyInternalOrder()) }
  const startEdit = (o: InternalOrder) => {
    setEditingId(o.id)
    setForm({
      code: o.code, name: o.name, description: o.description || '', order_type: o.order_type,
      start_date: o.start_date || '', end_date: o.end_date || '',
      budgeted_amount: o.budgeted_amount != null ? String(o.budgeted_amount) : '',
      cost_center_id: o.cost_center_id ? String(o.cost_center_id) : '', status: o.status,
    })
    setFormOpen(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError([])
    if (!form.code.trim() || !form.name.trim()) { setError(['Order code and name are required.']); return }
    setSaving(true)
    try {
      const { status, ...rest } = form
      const payload = {
        ...rest,
        // Status changes go through the status buttons, never the edit form.
        ...(editingId ? {} : { status }),
        code: form.code.trim(), name: form.name.trim(), description: blank(form.description),
        start_date: form.start_date || null, end_date: form.end_date || null,
        budgeted_amount: num(form.budgeted_amount), cost_center_id: form.cost_center_id ? Number(form.cost_center_id) : null,
      }
      if (editingId) await accountsApi.updateInternalOrder(editingId, payload)
      else await accountsApi.createInternalOrder(payload)
      close()
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, editingId ? `Could not update internal order ${form.code}` : 'Could not create the internal order'))
    } finally {
      setSaving(false)
    }
  }

  const doStatus = async (reason?: string) => {
    if (!statusTarget) return
    const { order, to } = statusTarget
    setStatusTarget(null)
    setError([])
    setNotice('')
    try {
      const res = await accountsApi.changeInternalOrderStatus(order.id, { status: to, reason: reason?.trim() || null })
      if (res.http_status === 202) setNotice(res.message || `Reopening ${order.code} is waiting for a Partner's approval.`)
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not change the status of internal order ${order.code}`))
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      await accountsApi.deleteInternalOrder(target.id)
      load()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not delete internal order ${target.code}`))
    }
  }

  return (
    <div style={sectionStyle} data-tour="fin-masters-internal-orders">
      <SectionHeader title="Internal orders" action={canCreate && <button type="button" data-tour="fin-io-new-btn" style={primaryBtnStyle} onClick={() => { setEditingId(null); setForm(emptyInternalOrder()); setFormOpen(true) }}>+ New Internal Order</button>} />
      {!formOpen && <ErrorBanner error={error} />}
      <ConfirmDialog open={!!deleteTarget} title="Delete this internal order?" message={`Delete "${deleteTarget?.name}"? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleteTarget(null)} />
      {notice && <InfoBanner tone="success">{notice}</InfoBanner>}
      <ConfirmDialog open={!!statusTarget && statusTarget.order.status !== 'closed'}
        title={statusTarget ? `${IO_ACTION[statusTarget.to]?.label || 'Change status'} — ${statusTarget.order.code}?` : ''}
        message={statusTarget ? IO_ACTION[statusTarget.to]?.message : ''}
        onConfirm={() => doStatus()} onCancel={() => setStatusTarget(null)} />
      <ReasonSheet open={!!statusTarget && statusTarget.order.status === 'closed'} tour="fin-io-reopen-dialog" icon="undo" title={`Reopen ${statusTarget?.order.code || ''}?`}
        subtitle="A closed order takes postings again only after a Partner approves."
        message="The reason goes to the Partner and on the audit trail."
        placeholder="Why must this order take postings again?" confirmLabel="Ask to reopen" danger={false} requireValue
        onConfirm={(v: string) => doStatus(v)} onCancel={() => setStatusTarget(null)} />

      {formOpen && (
        <MasterSheet tour="fin-io-form" formId="fin-io-form-el" icon="flag" editing={!!editingId} error={error}
          title={editingId ? `Edit internal order ${form.code}` : 'New internal order'}
          subtitle="Collects the cost of one job or project across many vouchers, so its actual spend can be compared with its budget."
          onClose={() => { setError([]); close() }} onSubmit={submit} saving={saving} label={editingId ? 'Save Changes' : 'Create Internal Order'}>
          <SheetColumns
            left={<>
              <SheetSection icon="flag" title="Order">
                <div style={sheetRow}>
                  <SF label="Code" req style={fixedW(130)} tour="fin-io-code"><input style={sheetInput} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} /></SF>
                  <SF label="Name" req style={growW(240, 380)} tour="fin-io-name"><input style={sheetInput} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></SF>
                </div>
                <div style={sheetRow}>
                  <SF label="Order type" style={fixedW(160)} tour="fin-io-type">
                    <Select style={sheetInput} value={form.order_type} onChange={(e) => setForm((f) => ({ ...f, order_type: e.target.value }))}>
                      <option value="capital">Capital</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="it">IT</option>
                      <option value="training">Training</option>
                      <option value="development">Development (R&amp;D)</option>
                    </Select>
                  </SF>
                  {!editingId && (
                    <SF label="Status" style={fixedW(160)} tour="fin-io-status">
                      <Select style={sheetInput} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                      </Select>
                    </SF>
                  )}
                </div>
                <SF label="Description" opt tour="fin-io-description">
                  <textarea style={{ ...sheetInput, minHeight: 72, resize: 'vertical' }} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </SF>
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="calendar" title="Period">
                <div style={sheetRow}>
                  <SF label="Start date" style={fixedW(160)} tour="fin-io-start"><DateField value={form.start_date} onChange={(v) => setForm((f) => ({ ...f, start_date: v }))} /></SF>
                  <SF label="End date" style={fixedW(160)} tour="fin-io-end"><DateField value={form.end_date} onChange={(v) => setForm((f) => ({ ...f, end_date: v }))} /></SF>
                </div>
              </SheetSection>
              <SheetSection icon="rupee" title="Budget & cost center">
                <SF label="Budget (₹)" style={{ ...fixedW(160), marginBottom: 12 }} tour="fin-io-budget"><input type="number" min={0} style={sheetInput} value={form.budgeted_amount} onChange={(e) => setForm((f) => ({ ...f, budgeted_amount: e.target.value }))} /></SF>
                <SF label="Cost center" tour="fin-io-cost-center">
                  <Select style={sheetInput} value={form.cost_center_id} onChange={(e) => setForm((f) => ({ ...f, cost_center_id: e.target.value }))}>
                    <option value="">— None —</option>
                    {costCenters.map((cc) => <option key={cc.id} value={cc.id}>{cc.name}</option>)}
                  </Select>
                </SF>
                <p style={sheetHint}>Independent of the department&apos;s cost center — the order tracks one job, the cost center tracks who spends.</p>
              </SheetSection>
            </>}
          />
        </MasterSheet>
      )}

      <TableWrap minWidth={900} tour="fin-io-table">
        <thead>
          <tr>
            <th style={thStyle}>Code <RowCount count={orders.length} /></th><th style={thStyle}>Name</th><th style={thStyle}>Type</th><th style={thStyle}>Cost center</th>
            <th style={thStyle}>Period</th><th style={numTh}>Budget (₹)</th><th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={8} text="Loading…" /> : orders.length === 0 ? <EmptyRow colSpan={8} text="No internal orders yet — use + New Internal Order to track a job or campaign's cost." /> :
            orders.map((o) => (
              <tr key={o.id}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{o.code}</td>
                <td style={tdStyle}>{o.name}</td>
                <td style={{ ...tdStyle, textTransform: o.order_type === 'it' ? 'uppercase' : 'capitalize' }}>{o.order_type}</td>
                <td style={tdStyle}>{o.cost_center_name || '—'}</td>
                <td style={tdStyle}>{o.start_date || o.end_date ? `${dmy(o.start_date)} – ${dmy(o.end_date)}` : '—'}</td>
                <td style={numTd}>{o.budgeted_amount != null ? inr(o.budgeted_amount) : '—'}</td>
                <td style={tdStyle}><StatusPill status={o.status} colors={STATUS_HEX} labels={STATUS_LABELS} /></td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {canEdit && <button type="button" style={linkBtnStyle} onClick={() => startEdit(o)}>Edit</button>}
                    {canEdit && (IO_NEXT[o.status] || []).map((to) => (
                      <button key={to} type="button" style={linkBtnStyle} onClick={() => setStatusTarget({ order: o, to })}>
                        {o.status === 'closed' ? 'Reopen' : o.status === 'completed' && to === 'in_progress' ? 'Undo complete' : IO_ACTION[to].label}
                      </button>
                    ))}
                    {canDelete('accounts', 'internal_orders', null) && <button type="button" style={dangerLinkStyle} onClick={() => setDeleteTarget(o)}>Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Opening Balances
// ---------------------------------------------------------------------------

const rowKey = () => Math.random().toString(36).slice(2)
type LedgerRow = { key: string; gl_account_id: string; debit: string; credit: string }
type VendorBillRow = { key: string; vendor_id: string; bill_number: string; bill_date: string; due_date: string; amount: string }
type CustomerBillRow = { key: string; customer_id: string; invoice_number: string; invoice_date: string; due_date: string; amount: string }
const newLedgerRow = (): LedgerRow => ({ key: rowKey(), gl_account_id: '', debit: '', credit: '' })
const newVendorBill = (): VendorBillRow => ({ key: rowKey(), vendor_id: '', bill_number: '', bill_date: '', due_date: '', amount: '' })
const newCustomerBill = (): CustomerBillRow => ({ key: rowKey(), customer_id: '', invoice_number: '', invoice_date: '', due_date: '', amount: '' })
const amt = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0)
const round2 = (x: number) => Math.round(x * 100) / 100

function OpeningBalancesSection({ canManage }: { canManage: boolean }) {
  const [ledgers, setLedgers] = useState<GLAccount[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [customers, setCustomers] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [asOf, setAsOf] = useState('')
  const [narration, setNarration] = useState('Opening balances')
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([newLedgerRow()])
  const [vendorRows, setVendorRows] = useState<VendorBillRow[]>([])
  const [customerRows, setCustomerRows] = useState<CustomerBillRow[]>([])
  const [confirming, setConfirming] = useState(false)
  const [posting, setPosting] = useState(false)
  const [posted, setPosted] = useState<{ entry_number: string; total: number } | null>(null)

  useEffect(() => {
    Promise.all([accountsApi.listGLAccounts(), accountsApi.listVendors(), crmApi.listOrganizations({ picker: true }), accountsApi.getSetup()])
      .then(([l, v, c, s]: [GLAccount[], Vendor[], Organization[], AccountsSetup]) => {
        setLedgers(l); setVendors(v); setCustomers(c)
        if (s.current_financial_year) setAsOf(s.current_financial_year.start_date)
      })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load ledgers, vendors and customers for opening balances')))
      .finally(() => setLoading(false))
  }, [])

  // The backend refuses control accounts (enter those bill-wise) and income/expense ledgers (they start each year at zero).
  const ledgerOpts = useMemo(() => ledgerOptions(ledgers, (a) => !a.is_control_account && a.account_type !== 'revenue' && a.account_type !== 'expense'), [ledgers])
  const vendorOpts = useMemo(() => vendors.filter((v) => v.status !== 'inactive').map((v) => ({ value: String(v.id), label: `${v.code} — ${v.name}` })), [vendors])
  const customerOpts = useMemo(() => customers.map((c) => ({ value: String(c.id), label: c.org_code ? `${c.org_code} — ${c.name}` : c.name })), [customers])

  const ledgerDr = round2(ledgerRows.reduce((s, r) => s + amt(r.debit), 0))
  const ledgerCr = round2(ledgerRows.reduce((s, r) => s + amt(r.credit), 0))
  const vendorTotal = round2(vendorRows.reduce((s, r) => s + amt(r.amount), 0))
  const customerTotal = round2(customerRows.reduce((s, r) => s + amt(r.amount), 0))
  const totalDr = round2(ledgerDr + customerTotal)
  const totalCr = round2(ledgerCr + vendorTotal)
  const diff = round2(totalDr - totalCr)
  const balanced = Math.abs(diff) < 0.005 && totalDr > 0
  const canSubmit = canManage && balanced && !!asOf && !posting

  const setLedger = (key: string, patch: Partial<LedgerRow>) => setLedgerRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const setVendor = (key: string, patch: Partial<VendorBillRow>) => setVendorRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const setCustomer = (key: string, patch: Partial<CustomerBillRow>) => setCustomerRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const submit = async () => {
    setConfirming(false)
    setError([])
    setPosting(true)
    try {
      const res = await accountsApi.postOpeningBalances({
        as_of: asOf,
        narration: blank(narration),
        ledger_lines: ledgerRows.filter((r) => r.gl_account_id || amt(r.debit) || amt(r.credit))
          .map((r) => ({ gl_account_id: Number(r.gl_account_id) || 0, debit_amount: amt(r.debit), credit_amount: amt(r.credit) })),
        vendor_bills: vendorRows.map((r) => ({
          vendor_id: Number(r.vendor_id) || 0, bill_number: r.bill_number.trim(), bill_date: r.bill_date || null, due_date: r.due_date || null, amount: amt(r.amount),
        })),
        customer_bills: customerRows.map((r) => ({
          customer_id: Number(r.customer_id) || 0, invoice_number: r.invoice_number.trim(), invoice_date: r.invoice_date || null, due_date: r.due_date || null, amount: amt(r.amount),
        })),
      })
      setPosted({ entry_number: res.entry_number, total: res.total })
      setLedgerRows([newLedgerRow()]); setVendorRows([]); setCustomerRows([])
    } catch (err: unknown) {
      setError(extractErrorMessages(err, 'Could not post the opening balances'))
    } finally {
      setPosting(false)
    }
  }

  const cell: React.CSSProperties = { padding: '6px 6px', borderTop: `1px solid ${BORDER.normal}`, verticalAlign: 'top' }
  const headCell: React.CSSProperties = { ...thStyle, position: 'static', background: 'transparent', padding: '6px 6px' }
  const removeBtn = (onClick: () => void) => <button type="button" style={{ ...dangerLinkStyle, paddingTop: 10 }} onClick={onClick}>✕</button>

  return (
    <div data-tour="fin-masters-opening">
      <ConfirmDialog open={confirming} title="Post opening balances?" danger={false} confirmLabel="Post Opening Balances"
        message={`This posts one Opening Balance voucher dated ${dmy(asOf)} for ${inr(totalDr)}. It can only be done once — to redo it, the voucher has to be reversed first.`}
        onConfirm={submit} onCancel={() => setConfirming(false)} />
      <FormPage icon="rupee" title="Opening balances" subtitle="Posted once, as one Opening Balance voucher dated the first day the books start in this system."
        footer={<>
          {!balanced && <span style={{ fontSize: 12.5, color: '#b91c1c', alignSelf: 'center' }}>{totalDr === 0 ? 'Enter at least one balance.' : 'Debits must equal credits before posting.'}</span>}
          {balanced && !asOf && <span style={{ fontSize: 12.5, color: '#b91c1c', alignSelf: 'center' }}>Pick the opening date.</span>}
          {canManage && (
            <button type="button" data-tour="fin-ob-post-btn" disabled={!canSubmit} onClick={() => setConfirming(true)} style={sheetBtn('primary', SHEET.BLUE, !canSubmit)}>
              <SheetIcon name="check" size={16} />{posting ? 'Posting…' : 'Post Opening Balances'}
            </button>
          )}
        </>}>
        <div style={{ padding: '20px 24px 0' }}>
          <ErrorBanner error={error} />
          {posted && <InfoBanner tone="success">Opening balances posted as {posted.entry_number} — total {inr(posted.total)}. Party bills now show in outstanding and aging.</InfoBanner>}
          {!canManage && <InfoBanner tone="warning">Only a Finance Manager (or admin) can post opening balances.</InfoBanner>}
          <SheetSection icon="calendar" title="Voucher">
            <div style={sheetRow}>
              <SF label="Opening date (first day of books)" req style={fixedW(240)} tour="fin-ob-date"><DateField value={asOf} onChange={setAsOf} /></SF>
            </div>
          </SheetSection>

          <div data-tour="fin-ob-ledgers">
            <SheetSection icon="list" title="Ledger balances" extra={<span style={{ ...mutedText, marginLeft: 'auto' }}>Assets, liabilities and capital — not party control accounts, income or expense</span>}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                  <thead><tr><th style={headCell}>Ledger <RowCount count={ledgerRows.length} /></th><th style={{ ...headCell, textAlign: 'right' }}>Debit (₹)</th><th style={{ ...headCell, textAlign: 'right' }}>Credit (₹)</th><th style={headCell}></th></tr></thead>
                  <tbody>
                    {ledgerRows.map((r) => (
                      <tr key={r.key}>
                        <td style={{ ...cell, minWidth: 340 }}>
                          <SearchableSelect value={r.gl_account_id} onChange={(v: string) => setLedger(r.key, { gl_account_id: v })} options={ledgerOpts} placeholder={loading ? 'Loading…' : 'Pick ledger'} />
                        </td>
                        <td style={{ ...cell, width: 160 }}>
                          <input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right' }} value={r.debit} onChange={(e) => setLedger(r.key, { debit: e.target.value, credit: e.target.value ? '' : r.credit })} />
                        </td>
                        <td style={{ ...cell, width: 160 }}>
                          <input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right' }} value={r.credit} onChange={(e) => setLedger(r.key, { credit: e.target.value, debit: e.target.value ? '' : r.debit })} />
                        </td>
                        <td style={{ ...cell, width: 30 }}>{removeBtn(() => setLedgerRows((rs) => rs.filter((x) => x.key !== r.key)))}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ ...cell, fontWeight: 700, fontSize: 12.5, paddingTop: 10 }}>Ledger totals</td>
                      <td style={{ ...numTd, fontWeight: 700 }}>{inr(ledgerDr)}</td>
                      <td style={{ ...numTd, fontWeight: 700 }}>{inr(ledgerCr)}</td>
                      <td style={cell}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <button type="button" data-tour="fin-ob-add-ledger" style={{ ...sheetBtn('secondary'), marginTop: 10 }} onClick={() => setLedgerRows((rs) => [...rs, newLedgerRow()])}><SheetIcon name="plus" size={14} />Add ledger</button>
            </SheetSection>
          </div>

          <div data-tour="fin-ob-vendor-bills">
            <SheetSection icon="rupee" title="Vendor bills unpaid on the opening date (credit — we owe)" extra={<span style={{ ...mutedText, marginLeft: 'auto' }}>Total {inr(vendorTotal)}</span>}>
              {vendorRows.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
                    <thead><tr><th style={headCell}>Vendor <RowCount count={vendorRows.length} /></th><th style={headCell}>Bill no.</th><th style={headCell}>Bill date</th><th style={headCell}>Due date</th><th style={{ ...headCell, textAlign: 'right' }}>Amount due (₹)</th><th style={headCell}></th></tr></thead>
                    <tbody>
                      {vendorRows.map((r) => (
                        <tr key={r.key}>
                          <td style={{ ...cell, minWidth: 260 }}><SearchableSelect value={r.vendor_id} onChange={(v: string) => setVendor(r.key, { vendor_id: v })} options={vendorOpts} placeholder="Pick vendor" /></td>
                          <td style={{ ...cell, width: 150 }}><input style={sheetInput} value={r.bill_number} onChange={(e) => setVendor(r.key, { bill_number: e.target.value })} /></td>
                          <td style={{ ...cell, width: 160 }}><DateField value={r.bill_date} onChange={(v) => setVendor(r.key, { bill_date: v })} /></td>
                          <td style={{ ...cell, width: 160 }}><DateField value={r.due_date} onChange={(v) => setVendor(r.key, { due_date: v })} /></td>
                          <td style={{ ...cell, width: 160 }}><input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right' }} value={r.amount} onChange={(e) => setVendor(r.key, { amount: e.target.value })} /></td>
                          <td style={{ ...cell, width: 30 }}>{removeBtn(() => setVendorRows((rs) => rs.filter((x) => x.key !== r.key)))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p style={{ ...sheetHint, margin: '8px 0' }}>Bill date defaults to the opening date; due date defaults to bill date + the vendor&apos;s payment days.</p>
              <button type="button" data-tour="fin-ob-add-vendor-bill" style={sheetBtn('secondary')} onClick={() => setVendorRows((rs) => [...rs, newVendorBill()])}><SheetIcon name="plus" size={14} />Add vendor bill</button>
            </SheetSection>
          </div>

          <div data-tour="fin-ob-customer-bills">
            <SheetSection icon="users" title="Customer invoices unpaid on the opening date (debit — owed to us)" extra={<span style={{ ...mutedText, marginLeft: 'auto' }}>Total {inr(customerTotal)}</span>}>
              {customerRows.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
                    <thead><tr><th style={headCell}>Customer <RowCount count={customerRows.length} /></th><th style={headCell}>Invoice no.</th><th style={headCell}>Invoice date</th><th style={headCell}>Due date</th><th style={{ ...headCell, textAlign: 'right' }}>Amount due (₹)</th><th style={headCell}></th></tr></thead>
                    <tbody>
                      {customerRows.map((r) => (
                        <tr key={r.key}>
                          <td style={{ ...cell, minWidth: 260 }}><SearchableSelect value={r.customer_id} onChange={(v: string) => setCustomer(r.key, { customer_id: v })} options={customerOpts} placeholder="Pick customer" /></td>
                          <td style={{ ...cell, width: 150 }}><input style={sheetInput} value={r.invoice_number} onChange={(e) => setCustomer(r.key, { invoice_number: e.target.value })} /></td>
                          <td style={{ ...cell, width: 160 }}><DateField value={r.invoice_date} onChange={(v) => setCustomer(r.key, { invoice_date: v })} /></td>
                          <td style={{ ...cell, width: 160 }}><DateField value={r.due_date} onChange={(v) => setCustomer(r.key, { due_date: v })} /></td>
                          <td style={{ ...cell, width: 160 }}><input type="number" min={0} step="0.01" style={{ ...sheetInput, textAlign: 'right' }} value={r.amount} onChange={(e) => setCustomer(r.key, { amount: e.target.value })} /></td>
                          <td style={{ ...cell, width: 30 }}>{removeBtn(() => setCustomerRows((rs) => rs.filter((x) => x.key !== r.key)))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p style={{ ...sheetHint, margin: '8px 0' }}>Invoice date defaults to the opening date; due date defaults to invoice date + the customer&apos;s credit days (30 if not set).</p>
              <button type="button" data-tour="fin-ob-add-customer-bill" style={sheetBtn('secondary')} onClick={() => setCustomerRows((rs) => [...rs, newCustomerBill()])}><SheetIcon name="plus" size={14} />Add customer invoice</button>
            </SheetSection>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${SHEET.LINE}` }}>
          <SheetColumns
            left={
              <SheetSection icon="alert" title="How opening balances work">
                <p style={{ fontSize: 13, color: SHEET.BODY, lineHeight: 1.55, margin: 0 }}>
                  Dated, balanced and auditable like any other voucher. Enter vendor and customer balances <strong>bill-wise</strong> (each unpaid bill with
                  its own date and due date) so aging and bill-wise settlement work from day one; the Sundry Creditors / Debtors control accounts are filled
                  from those bills. Income and expense ledgers start every year at zero — last year&apos;s profit comes in through Retained Earnings. Debits
                  must equal credits: if the old trial balance didn&apos;t agree, find the difference before go-live.
                </p>
              </SheetSection>
            }
            right={<>
              <SheetSection icon="doc" title="Narration">
                <SF label="Narration" tour="fin-ob-narration"><input style={sheetInput} value={narration} onChange={(e) => setNarration(e.target.value)} /></SF>
              </SheetSection>
              <SheetSection icon="rupee" title="Totals">
                <div data-tour="fin-ob-totals" style={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 20, rowGap: 6, fontSize: 13, color: SHEET.BODY, fontVariantNumeric: 'tabular-nums' }}>
                  <span>Total debits <span style={mutedText}>(ledger debits + customer invoices)</span></span><strong style={{ textAlign: 'right' }}>{inr(totalDr)}</strong>
                  <span>Total credits <span style={mutedText}>(ledger credits + vendor bills)</span></span><strong style={{ textAlign: 'right' }}>{inr(totalCr)}</strong>
                  <span style={{ fontWeight: 700 }}>Difference</span>
                  <strong style={{ textAlign: 'right', color: Math.abs(diff) < 0.005 ? '#15803d' : '#b91c1c' }}>{Math.abs(diff) < 0.005 ? 'Balanced' : `${inr(Math.abs(diff))} ${diff > 0 ? 'more debit' : 'more credit'}`}</strong>
                </div>
              </SheetSection>
            </>}
          />
        </div>
      </FormPage>
    </div>
  )
}
