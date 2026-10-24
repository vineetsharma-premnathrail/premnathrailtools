'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { accountsApi, costCentersApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { FixedAsset, GLAccount, CostCenter, DepreciationRun, DepreciationPreviewRow } from '@/types'
import { TEXT } from '@/lib/theme'
import FinanceNav from '@/components/finance/FinanceNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ApprovalPanel from '@/components/shared/ApprovalPanel'
import { FormSheet, SheetColumns, SheetSection, SHEET, sheetInput, sheetHint, SheetError } from '@/components/shared/FormSheet'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { SField, SRow, SheetBody, SheetFooter, sw, sg } from '@/components/finance/financeSheet'
import {
  inputStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, dangerLinkStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, todayIso, currentPeriod, Field, ErrorBanner, InfoBanner, StatusPill, SubTabs, useFinanceSubTabs, PageHeader, TableWrap, EmptyRow, StatCard, ledgerOptions,
} from '@/components/finance/financeUi'
import { recordHref } from '@/lib/recordRef'
import { CapitalisationTab, RetirementsTab, AssetReconciliationTab, TaxDepreciationTab } from '@/components/finance/AssetAccountingTabs'
import Select from '@/components/shared/Select'

const TABS = ['Register', 'Depreciation', 'Capitalisation', 'Retirements', 'Reconciliation', 'Tax Depreciation'] as const
type Tab = typeof TABS[number]
/** Permission Matrix tab (Finance & Accounting) behind each sub-tab. */
const TAB_KEYS: Record<Tab, string> = {
  Register: 'fixed_assets', Depreciation: 'depreciation', Capitalisation: 'fixed_assets.capitalisation', Retirements: 'fixed_assets.retirements',
  Reconciliation: 'fixed_assets.asset_reconciliation', 'Tax Depreciation': 'tax_depreciation',
}

const STATUS_HEX: Record<string, string> = { active: '#15803d', disposed: '#64748b', posted: '#15803d', reversed: '#b91c1c' }
const STATUS_LABELS: Record<string, string> = { active: 'Active', disposed: 'Disposed', posted: 'Posted', reversed: 'Reversed' }

export default function FinanceAssetsPage() {
  const { isAuthorized, isLoading, user } = useRequireApp('accounts')
  const { tabs: visibleTabs, tab, setTab } = useFinanceSubTabs(TABS, TAB_KEYS)
  const { can, canFeature } = useCan()
  const canManage = !!user?.is_finance_manager || user?.role === 'admin'

  if (isLoading || !isAuthorized) return null

  return (
    <div>
      <FinanceNav />
      <PageHeader title="Fixed Assets" subtitle="Asset register, monthly depreciation (Companies Act 2013, Schedule II) and disposals." />
      <SubTabs tabs={visibleTabs} value={tab} onChange={setTab} />
      {tab === 'Register' && <RegisterTab canManage={canManage && can('accounts', 'fixed_assets', 'edit')} />}
      {tab === 'Depreciation' && <DepreciationTab canManage={canManage && can('accounts', 'depreciation', 'approve')} canRequest={can('accounts', 'depreciation', 'approve')} canReverse={canManage && canFeature('accounts', 'depreciation', 'reversal', 'cancel')} />}
      {tab === 'Capitalisation' && <CapitalisationTab canManage={canFeature('accounts', 'fixed_assets', 'capitalisation', 'create')} />}
      {tab === 'Retirements' && <RetirementsTab canManage={canManage && canFeature('accounts', 'fixed_assets', 'retirements', 'create')} />}
      {tab === 'Reconciliation' && <AssetReconciliationTab />}
      {tab === 'Tax Depreciation' && <TaxDepreciationTab canEdit={can('accounts', 'tax_depreciation', 'edit')} />}
    </div>
  )
}

// ─── Register ───────────────────────────────────────────────────────────

type AssetForm = {
  asset_code: string; name: string; description: string; location: string
  asset_gl_account_id: string; accumulated_depreciation_gl_account_id: string; depreciation_expense_gl_account_id: string
  cost_center_id: string; purchase_date: string; put_to_use_date: string
  cost: string; residual_value: string; depreciation_method: 'slm' | 'wdv'
  useful_life_months: string; wdv_rate_pct: string; opening_accumulated_depreciation: string
}

function emptyForm(): AssetForm {
  return {
    asset_code: '', name: '', description: '', location: '', asset_gl_account_id: '', accumulated_depreciation_gl_account_id: '',
    depreciation_expense_gl_account_id: '', cost_center_id: '', purchase_date: todayIso(), put_to_use_date: todayIso(),
    cost: '', residual_value: '0', depreciation_method: 'slm', useful_life_months: '', wdv_rate_pct: '', opening_accumulated_depreciation: '0',
  }
}

const isFixedAssetGroup = (a: GLAccount) => /fixed|plant|property|machinery|furniture|vehicle|equipment|building|computer/i.test(a.group_name || '')
const isBankOrCash = (a: GLAccount) => /bank|cash/i.test(a.group_name || '') || /bank|cash/i.test(a.name)

function methodLabel(a: FixedAsset): string {
  return a.depreciation_method === 'slm' ? `SLM ${a.useful_life_months ?? '?'} months` : `WDV ${a.wdv_rate_pct ?? '?'}%`
}

function RegisterTab({ canManage }: { canManage: boolean }) {
  const { can, canDelete } = useCan()
  const [assets, setAssets] = useState<FixedAsset[]>([])
  const [ledgers, setLedgers] = useState<GLAccount[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [statusFilter, setStatusFilter] = useState<'active' | 'disposed' | ''>('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<AssetForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string[] | null>(null)
  const [editing, setEditing] = useState<FixedAsset | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FixedAsset | null>(null)
  const [disposeTarget, setDisposeTarget] = useState<FixedAsset | null>(null)

  // State is set only after the await, so this is safe to call from an effect.
  const load = () => accountsApi.listFixedAssets(statusFilter ? { status: statusFilter } : {})
    .then((d: FixedAsset[]) => { setAssets(d); setError(null) })
    .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the fixed-asset register')))
    .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [statusFilter])
  useEffect(() => {
    accountsApi.listGLAccounts().then(setLedgers).catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load ledgers')))
    costCentersApi.listCostCenters().then(setCostCenters).catch(() => setCostCenters([]))
  }, [])

  const assetLedgerOpts = useMemo(() => {
    const assetsOnly = ledgers.filter((a) => a.account_type === 'asset')
    const preferred = assetsOnly.filter(isFixedAssetGroup)
    return [...ledgerOptions(preferred), ...ledgerOptions(assetsOnly.filter((a) => !isFixedAssetGroup(a)))]
  }, [ledgers])
  const accDepOpts = useMemo(() => [{ value: '', label: 'Default (Ledger Settings)' }, ...ledgerOptions(ledgers, (a) => a.account_type === 'asset')], [ledgers])
  const depExpOpts = useMemo(() => [{ value: '', label: 'Default (Ledger Settings)' }, ...ledgerOptions(ledgers, (a) => a.account_type === 'expense')], [ledgers])
  const ccOpts = useMemo(() => [{ value: '', label: 'None' }, ...costCenters.map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }))], [costCenters])

  const set = (patch: Partial<AssetForm>) => setForm((f) => ({ ...f, ...patch }))

  const closeForm = () => { setShowForm(false); setForm(emptyForm()); setFormError(null) }

  const submit = async () => {
    setSaving(true); setFormError(null)
    try {
      await accountsApi.createFixedAsset({
        asset_code: form.asset_code.trim(), name: form.name.trim(), description: form.description.trim() || null,
        location: form.location.trim() || null, asset_gl_account_id: form.asset_gl_account_id ? Number(form.asset_gl_account_id) : 0,
        accumulated_depreciation_gl_account_id: form.accumulated_depreciation_gl_account_id ? Number(form.accumulated_depreciation_gl_account_id) : null,
        depreciation_expense_gl_account_id: form.depreciation_expense_gl_account_id ? Number(form.depreciation_expense_gl_account_id) : null,
        cost_center_id: form.cost_center_id ? Number(form.cost_center_id) : null,
        purchase_date: form.purchase_date, put_to_use_date: form.put_to_use_date,
        cost: Number(form.cost || 0), residual_value: Number(form.residual_value || 0),
        depreciation_method: form.depreciation_method,
        useful_life_months: form.depreciation_method === 'slm' && form.useful_life_months ? Number(form.useful_life_months) : null,
        wdv_rate_pct: form.depreciation_method === 'wdv' && form.wdv_rate_pct ? Number(form.wdv_rate_pct) : null,
        opening_accumulated_depreciation: Number(form.opening_accumulated_depreciation || 0),
      })
      setForm(emptyForm()); setShowForm(false)
      load()
    } catch (err: unknown) {
      setFormError(extractErrorMessages(err, 'Could not register the asset'))
    } finally { setSaving(false) }
  }

  const doDelete = async () => {
    const a = deleteTarget
    setDeleteTarget(null)
    if (!a) return
    setError(null)
    try { await accountsApi.deleteFixedAsset(a.id); load() }
    catch (err: unknown) { setError(extractErrorMessages(err, `Could not delete asset ${a.asset_code}`)) }
  }

  const totals = assets.reduce((t, a) => ({ cost: t.cost + a.cost, acc: t.acc + a.accumulated_depreciation, bv: t.bv + a.book_value }), { cost: 0, acc: 0, bv: 0 })
  const short = (n: number): React.CSSProperties => ({ flex: `0 1 ${n}px`, minWidth: n - 20 })

  return (
    <div>
      <ErrorBanner error={error} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 16 }}>
        <Field label="Show" style={short(170)} tour="fin-fa-status-filter">
          <Select style={inputStyle} value={statusFilter} onChange={(e) => { setLoading(true); setStatusFilter(e.target.value as 'active' | 'disposed' | '') }}>
            <option value="active">Active</option>
            <option value="disposed">Disposed</option>
            <option value="">All</option>
          </Select>
        </Field>
        {!showForm && can('accounts', 'fixed_assets', 'create') && <button data-tour="fin-fa-new-btn" style={primaryBtnStyle} onClick={() => setShowForm(true)}>+ Register asset</button>}
      </div>

      {showForm && (
        <FormSheet tour="fin-fa-form" icon="box" title="Register a fixed asset" subtitle="Cost and how it is written off — the purchase itself is booked through a purchase invoice to the asset ledger."
          onClose={closeForm} busy={saving}
          footer={<SheetFooter onCancel={closeForm} onSubmit={submit} busy={saving} label="Register asset" icon="plus" cancelTour="fin-fa-cancel" submitTour="fin-fa-save" />}>
          <SheetColumns
            left={<>
              <SheetError error={formError} />
              <SheetSection icon="tag" title="Asset">
                <SRow>
                  <SField label="Asset code" req style={sw(150)} tour="fin-fa-code"><input style={sheetInput} value={form.asset_code} onChange={(e) => set({ asset_code: e.target.value })} placeholder="FA-0001" /></SField>
                  <SField label="Name" req style={sg(220, 340)} tour="fin-fa-name"><input style={sheetInput} value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="CNC lathe" /></SField>
                </SRow>
                <SRow mb={0}>
                  <SField label="Location" optional style={sg(160, 240)} tour="fin-fa-location"><input style={sheetInput} value={form.location} onChange={(e) => set({ location: e.target.value })} /></SField>
                  <SField label="Description" optional style={sg(200, 380)} tour="fin-fa-description"><input style={sheetInput} value={form.description} onChange={(e) => set({ description: e.target.value })} /></SField>
                </SRow>
              </SheetSection>
              <SheetSection icon="list" title="Ledgers">
                <SRow>
                  <SField label="Asset cost ledger" req style={sg(220, 360)} tour="fin-fa-asset-ledger">
                    <SearchableSelect value={form.asset_gl_account_id} onChange={(v) => set({ asset_gl_account_id: v })} options={assetLedgerOpts} placeholder="e.g. Plant & Machinery" />
                  </SField>
                  <SField label="Cost centre" optional style={sg(180, 280)} tour="fin-fa-cost-center">
                    <SearchableSelect value={form.cost_center_id} onChange={(v) => set({ cost_center_id: v })} options={ccOpts} placeholder="None" />
                  </SField>
                </SRow>
                <SRow mb={0}>
                  <SField label="Accumulated depreciation ledger" style={sg(220, 340)} tour="fin-fa-accdep-ledger">
                    <SearchableSelect value={form.accumulated_depreciation_gl_account_id} onChange={(v) => set({ accumulated_depreciation_gl_account_id: v })} options={accDepOpts} placeholder="Default (Ledger Settings)" />
                  </SField>
                  <SField label="Depreciation expense ledger" style={sg(220, 340)} tour="fin-fa-depexp-ledger">
                    <SearchableSelect value={form.depreciation_expense_gl_account_id} onChange={(v) => set({ depreciation_expense_gl_account_id: v })} options={depExpOpts} placeholder="Default (Ledger Settings)" />
                  </SField>
                </SRow>
              </SheetSection>
            </>}
            right={<>
              <SheetSection icon="calendar" title="Dates">
                <SRow mb={0}>
                  <SField label="Purchase date" req style={sw(165)} tour="fin-fa-purchase-date"><DateField value={form.purchase_date} onChange={(v) => set({ purchase_date: v })} /></SField>
                  <SField label="Put to use date" req style={sw(165)} tour="fin-fa-use-date"><DateField value={form.put_to_use_date} onChange={(v) => set({ put_to_use_date: v })} /></SField>
                </SRow>
              </SheetSection>
              <SheetSection icon="rupee" title="Cost & depreciation">
                <SRow>
                  <SField label="Cost (₹)" req style={sw(150)} tour="fin-fa-cost"><input type="number" min={0} step="any" style={sheetInput} value={form.cost} onChange={(e) => set({ cost: e.target.value })} /></SField>
                  <SField label="Residual value (₹)" style={sw(150)} tour="fin-fa-residual"><input type="number" min={0} step="any" style={sheetInput} value={form.residual_value} onChange={(e) => set({ residual_value: e.target.value })} /></SField>
                </SRow>
                <SRow>
                  <SField label="Method" req style={sw(200)} tour="fin-fa-method">
                    <Select style={sheetInput} value={form.depreciation_method} onChange={(e) => set({ depreciation_method: e.target.value as 'slm' | 'wdv' })}>
                      <option value="slm">Straight line (SLM)</option>
                      <option value="wdv">Written-down value (WDV)</option>
                    </Select>
                  </SField>
                  {form.depreciation_method === 'slm' ? (
                    <SField label="Useful life (months)" req style={sw(160)} tour="fin-fa-life">
                      <input type="number" min={1} step={1} style={sheetInput} value={form.useful_life_months} onChange={(e) => set({ useful_life_months: e.target.value })} />
                    </SField>
                  ) : (
                    <SField label="WDV rate (% p.a.)" req style={sw(150)} tour="fin-fa-wdv-rate">
                      <input type="number" min={0} max={100} step="any" style={sheetInput} value={form.wdv_rate_pct} onChange={(e) => set({ wdv_rate_pct: e.target.value })} />
                    </SField>
                  )}
                </SRow>
                <SField label="Opening accumulated depreciation (₹)" style={sw(240)} tour="fin-fa-opening-dep"
                  hint="For an asset brought over from old books — the depreciation charged so far.">
                  <input type="number" min={0} step="any" style={sheetInput} value={form.opening_accumulated_depreciation} onChange={(e) => set({ opening_accumulated_depreciation: e.target.value })} />
                </SField>
                <p style={sheetHint}>
                  {form.depreciation_method === 'slm'
                    ? 'Schedule II useful life, e.g. plant & machinery 15 yrs = 180, computers 3 yrs = 36, furniture 10 yrs = 120, vehicles 8 yrs = 96.'
                    : 'Annual WDV rate, e.g. 18.10% for plant & machinery over 15 years at 5% residual.'}
                  {' '}Residual value is normally up to 5% of cost under Schedule II. Cost, dates and method can&apos;t change once registered, because they drive depreciation already charged.
                </p>
              </SheetSection>
            </>}
          />
        </FormSheet>
      )}

      {assets.length > 0 && (
        <div data-tour="fin-fa-stats" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <StatCard label="Cost" value={inr(totals.cost)} />
          <StatCard label="Accumulated depreciation" value={inr(totals.acc)} />
          <StatCard label="Net book value" value={inr(totals.bv)} />
        </div>
      )}

      <TableWrap minWidth={1400} tour="fin-fa-table">
        <thead>
          <tr>
            <th style={thStyle}>Code</th><th style={thStyle}>Name</th><th style={thStyle}>Cost ledger</th><th style={thStyle}>Put to use</th>
            <th style={numTh}>Cost (₹)</th><th style={thStyle}>Method</th><th style={numTh}>Acc. dep. (₹)</th><th style={numTh}>Book value (₹)</th>
            <th style={thStyle}>Depreciated to</th><th style={thStyle}>Status</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <EmptyRow colSpan={11} text="Loading…" /> : assets.length === 0 ? <EmptyRow colSpan={11} text="No assets in the register." />
            : assets.map((a) => (
              <tr key={a.id}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{a.asset_code}</td>
                <td style={tdStyle}>
                  {a.name}
                  {a.location && <div style={{ fontSize: 11.5, color: TEXT.muted }}>{a.location}</div>}
                </td>
                <td style={tdStyle}>{a.asset_gl_account_name || '—'}</td>
                <td style={tdStyle}>{dmy(a.put_to_use_date)}</td>
                <td style={numTd}>{inr(a.cost)}</td>
                <td style={tdStyle}>{methodLabel(a)}</td>
                <td style={numTd}>{inr(a.accumulated_depreciation)}</td>
                <td style={numTd}>{inr(a.book_value)}</td>
                <td style={tdStyle}>{a.depreciated_up_to ? dmy(a.depreciated_up_to) : 'Not yet'}</td>
                <td style={tdStyle}>
                  <StatusPill status={a.status} labels={STATUS_LABELS} colors={STATUS_HEX} />
                  {a.status === 'disposed' && <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 3 }}>{dmy(a.disposal_date)} for {inr(a.disposal_proceeds)}</div>}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {can('accounts', 'fixed_assets', 'edit') && <button style={linkBtnStyle} onClick={() => setEditing(a)}>Edit</button>}
                    {a.status === 'active' && canManage && <button style={linkBtnStyle} onClick={() => setDisposeTarget(a)}>Dispose</button>}
                    {a.status === 'active' && !a.depreciated_up_to && canDelete('accounts', 'fixed_assets', a.created_by_id ?? null) && <button style={dangerLinkStyle} onClick={() => setDeleteTarget(a)}>Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
        </tbody>
      </TableWrap>

      {editing && <EditAssetDialog asset={editing} ccOpts={ccOpts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {disposeTarget && <DisposeDialog asset={disposeTarget} ledgers={ledgers} onClose={() => setDisposeTarget(null)} onDone={() => { setDisposeTarget(null); load() }} />}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this asset?"
        message={`Delete ${deleteTarget?.asset_code} — ${deleteTarget?.name}? Allowed only because no depreciation has been charged on it. Once depreciated, an asset stays in the register and is disposed instead.`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function EditAssetDialog({ asset, ccOpts, onClose, onSaved }: { asset: FixedAsset; ccOpts: { value: string; label: string }[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(asset.name)
  const [description, setDescription] = useState(asset.description || '')
  const [location, setLocation] = useState(asset.location || '')
  const [cc, setCc] = useState(asset.cost_center_id ? String(asset.cost_center_id) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[] | null>(null)

  const save = async () => {
    setSaving(true); setError(null)
    try {
      await accountsApi.updateFixedAsset(asset.id, { name: name.trim(), description: description.trim() || null, location: location.trim() || null, cost_center_id: cc ? Number(cc) : null })
      onSaved()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not update asset ${asset.asset_code}`))
    } finally { setSaving(false) }
  }

  return (
    <FormSheet width={580} tour="fin-fa-edit-dialog" icon="edit" title={`Edit ${asset.asset_code}`} subtitle={asset.name} onClose={onClose} busy={saving}
      footer={<SheetFooter onCancel={onClose} onSubmit={save} busy={saving} label="Save" disabled={!name.trim()} cancelTour="fin-fa-edit-cancel" submitTour="fin-fa-edit-save" />}>
      <SheetBody>
        <InfoBanner>Only descriptive fields can change. Cost, dates and method drive depreciation already charged — to correct them, dispose of the asset (or delete it if never depreciated) and register it again.</InfoBanner>
        <SheetError error={error} />
        <SheetSection icon="tag" title="Details">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <SField label="Name" req tour="fin-fa-edit-name"><input style={sheetInput} value={name} onChange={(e) => setName(e.target.value)} /></SField>
            <SField label="Description" optional tour="fin-fa-edit-description"><input style={sheetInput} value={description} onChange={(e) => setDescription(e.target.value)} /></SField>
            <SField label="Location" optional tour="fin-fa-edit-location"><input style={sheetInput} value={location} onChange={(e) => setLocation(e.target.value)} /></SField>
            <SField label="Cost centre" optional tour="fin-fa-edit-cost-center"><SearchableSelect value={cc} onChange={setCc} options={ccOpts} placeholder="None" /></SField>
          </div>
        </SheetSection>
      </SheetBody>
    </FormSheet>
  )
}

function DisposeDialog({ asset, ledgers, onClose, onDone }: { asset: FixedAsset; ledgers: GLAccount[]; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(todayIso())
  const [proceeds, setProceeds] = useState('0')
  const [ledgerId, setLedgerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[] | null>(null)

  const opts = useMemo(() => {
    const assetsOnly = ledgers.filter((a) => a.account_type === 'asset')
    return [...ledgerOptions(assetsOnly.filter(isBankOrCash)), ...ledgerOptions(assetsOnly.filter((a) => !isBankOrCash(a)))]
  }, [ledgers])

  const dispose = async () => {
    setSaving(true); setError(null)
    try {
      await accountsApi.disposeFixedAsset(asset.id, { disposal_date: date, proceeds: Number(proceeds || 0), proceeds_gl_account_id: ledgerId ? Number(ledgerId) : null })
      onDone()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not dispose of asset ${asset.asset_code}`))
    } finally { setSaving(false) }
  }

  return (
    <FormSheet width={580} tour="fin-fa-dispose-dialog" icon="trash" iconColor="#b91c1c" title={`Dispose of ${asset.asset_code}`} subtitle={asset.name} onClose={onClose} busy={saving}
      footer={<SheetFooter onCancel={onClose} onSubmit={dispose} busy={saving} label="Dispose & post" busyLabel="Posting…" color="#b91c1c" disabled={!date} cancelTour="fin-fa-dispose-cancel" submitTour="fin-fa-dispose-save" />}>
      <SheetBody>
        <InfoBanner>
          Depreciation is first charged up to the disposal date. Then the cost and all accumulated depreciation are removed, the sale value is debited
          to the ledger the money went to, and the difference against book value posts to Profit or Loss on Sale of Fixed Assets.
        </InfoBanner>
        <div style={{ fontSize: 12.5, color: SHEET.BODY, marginBottom: 14 }}>
          Cost {inr(asset.cost)} · accumulated depreciation {inr(asset.accumulated_depreciation)} · book value {inr(asset.book_value)}
          {asset.depreciated_up_to && <> · depreciated to {dmy(asset.depreciated_up_to)}</>}
        </div>
        <SheetError error={error} />
        <SheetSection icon="rupee" title="Disposal">
          <SRow>
            <SField label="Disposal date" req style={sw(170)} tour="fin-fa-dispose-date"><DateField value={date} onChange={setDate} /></SField>
            <SField label="Sale proceeds (₹)" style={sw(160)} tour="fin-fa-dispose-proceeds">
              <input type="number" min={0} step="any" style={sheetInput} value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
            </SField>
          </SRow>
          <SField label={Number(proceeds) > 0 ? 'Proceeds ledger' : 'Proceeds ledger (only if sold)'} req={Number(proceeds) > 0} tour="fin-fa-dispose-ledger"
            hint={Number(proceeds) > 0 ? 'The bank, or the buyer’s ledger if the money is not yet received.' : undefined}>
            <SearchableSelect value={ledgerId} onChange={setLedgerId} options={opts} placeholder="Bank / cash / receivable ledger" />
          </SField>
        </SheetSection>
      </SheetBody>
    </FormSheet>
  )
}

// ─── Depreciation ───────────────────────────────────────────────────────

function DepreciationTab({ canManage, canRequest, canReverse }: { canManage: boolean; canRequest: boolean; canReverse: boolean }) {
  const [period, setPeriod] = useState(currentPeriod())
  const [preview, setPreview] = useState<DepreciationPreviewRow[] | null>(null)
  const [runs, setRuns] = useState<DepreciationRun[]>([])
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [error, setError] = useState<string[] | null>(null)
  const [confirmRun, setConfirmRun] = useState(false)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [reverseTarget, setReverseTarget] = useState<DepreciationRun | null>(null)
  const [approvalKey, setApprovalKey] = useState(0)

  // State is set only after the await, so this is safe to call from an effect.
  const loadPreview = () => accountsApi.depreciationPreview(period)
    .then((d: DepreciationPreviewRow[]) => setPreview(d))
    .catch((err: unknown) => setError(extractErrorMessages(err, `Could not preview depreciation for ${period}`)))
    .finally(() => setLoadingPreview(false))
  const loadRuns = () => accountsApi.listDepreciationRuns()
    .then((d: DepreciationRun[]) => setRuns(d))
    .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load depreciation runs')))
    .finally(() => setLoadingRuns(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadPreview(); loadRuns() }, [])

  const run = async () => {
    setConfirmRun(false); setRunning(true); setError(null); setDone(null)
    try {
      // 202 = submitted to the approval workflow and waiting for a Finance Manager.
      const r: DepreciationRun & { approval_status?: string; message?: string } = await accountsApi.runDepreciation(period)
      if (r.approval_status === 'pending') setDone(r.message || `Depreciation for ${period} was submitted for approval.`)
      else setDone(`Depreciation for ${r.accounting_period} posted: ${inr(r.total_amount)} across ${r.lines.length} asset(s).`)
      setApprovalKey((k) => k + 1)
      loadPreview(); loadRuns()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not run depreciation for ${period}`))
    } finally { setRunning(false) }
  }

  const reverse = async (reason: string) => {
    const r = reverseTarget
    setReverseTarget(null)
    if (!r) return
    setError(null); setDone(null)
    try {
      await accountsApi.reverseDepreciationRun(r.id, reason.trim())
      setDone(`Depreciation run for ${r.accounting_period} reversed.`)
      loadPreview(); loadRuns()
    } catch (err: unknown) {
      setError(extractErrorMessages(err, `Could not reverse the depreciation run for ${r.accounting_period}`))
    }
  }

  const previewTotal = (preview || []).reduce((s, r) => s + r.amount, 0)
  const latestPosted = runs.filter((r) => r.status === 'posted').reduce<DepreciationRun | null>((best, r) => (!best || r.accounting_period > best.accounting_period ? r : best), null)

  return (
    <div>
      <InfoBanner>
        Depreciation follows Companies Act Schedule II: charged pro-rata by days from the day after the last charge (or the put-to-use date) to
        month end, so a missed month catches up. Runs go in month order and are reversed newest first. The asset purchase itself is booked
        via a purchase invoice to the asset ledger; this only writes the cost off.
      </InfoBanner>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <Field label="Month" style={{ flex: '0 1 180px', minWidth: 160 }} tour="fin-dep-month">
          <input type="month" style={inputStyle} value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <button data-tour="fin-dep-preview-btn" style={secondaryBtnStyle} onClick={() => { setLoadingPreview(true); setError(null); loadPreview() }} disabled={loadingPreview || !period}>{loadingPreview ? 'Loading…' : 'Preview'}</button>
        {canManage || canRequest
          ? <button data-tour="fin-dep-run-btn" style={{ ...primaryBtnStyle, opacity: running || previewTotal <= 0 ? 0.5 : 1 }} disabled={running || previewTotal <= 0} onClick={() => setConfirmRun(true)}>
            {running ? 'Posting…' : canManage ? 'Run depreciation' : 'Request depreciation run'}
          </button>
          : <span style={{ fontSize: 12, color: TEXT.muted }}>You need the Approve permission on Depreciation to run it.</span>}
      </div>
      <ErrorBanner error={error} />
      {done && <InfoBanner tone="success">{done}</InfoBanner>}
      {/^\d{4}-\d{2}$/.test(period) && (
        <ApprovalPanel key={`${period}-${approvalKey}`} entityType="accounts_depreciation_run" entityId={Number(period.replace('-', ''))}
          title={`Approval — depreciation for ${period}`} onChanged={() => { loadPreview(); loadRuns() }} />
      )}

      <TableWrap minWidth={900} maxHeight="420px" tour="fin-dep-preview">
        <thead>
          <tr>
            <th style={thStyle}>Asset</th><th style={thStyle}>From</th><th style={thStyle}>To</th><th style={numTh}>Days</th>
            <th style={numTh}>Depreciation (₹)</th><th style={numTh}>Book value now (₹)</th>
          </tr>
        </thead>
        <tbody>
          {loadingPreview ? <EmptyRow colSpan={6} text="Loading…" /> : !preview || preview.length === 0 ? <EmptyRow colSpan={6} text="No active assets in use by this month end." />
            : preview.map((r) => (
              <tr key={r.fixed_asset_id} style={{ color: r.amount > 0 ? undefined : TEXT.muted }}>
                <td style={tdStyle}><span style={{ fontWeight: 600 }}>{r.asset_code}</span> — {r.name}</td>
                <td style={tdStyle}>{dmy(r.from_date)}</td>
                <td style={tdStyle}>{dmy(r.to_date)}</td>
                <td style={numTd}>{r.days}</td>
                <td style={numTd}>{r.amount > 0 ? inr(r.amount) : '—'}</td>
                <td style={numTd}>{inr(r.book_value)}</td>
              </tr>
            ))}
          {preview && preview.length > 0 && !loadingPreview && (
            <tr><td style={{ ...tdStyle, fontWeight: 800 }} colSpan={4}>Total</td><td style={{ ...numTd, fontWeight: 800 }}>{inr(previewTotal)}</td><td style={numTd} /></tr>
          )}
        </tbody>
      </TableWrap>

      <h3 style={{ fontSize: 14, fontWeight: 700, color: TEXT.heading, margin: '4px 0 10px' }}>Depreciation runs</h3>
      <TableWrap minWidth={800} tour="fin-dep-runs">
        <thead>
          <tr>
            <th style={thStyle}>Month</th><th style={thStyle}>Run date</th><th style={numTh}>Amount (₹)</th><th style={numTh}>Assets</th>
            <th style={thStyle}>Status</th><th style={thStyle}>Journal</th><th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {loadingRuns ? <EmptyRow colSpan={7} text="Loading…" /> : runs.length === 0 ? <EmptyRow colSpan={7} text="No depreciation has been run yet." />
            : runs.flatMap((r) => {
              const open = expanded === r.id
              const rows = [
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setExpanded(open ? null : r.id)}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{open ? '▾' : '▸'} {r.accounting_period}</td>
                  <td style={tdStyle}>{dmy(r.run_date)}</td>
                  <td style={numTd}>{inr(r.total_amount)}</td>
                  <td style={numTd}>{r.lines.length}</td>
                  <td style={tdStyle}><StatusPill status={r.status} labels={STATUS_LABELS} colors={STATUS_HEX} /></td>
                  <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                    {r.journal_entry_id ? <Link href={recordHref('/dashboard/finance/ledger', r, 'journal_entry_id', undefined, 'entry')} style={linkBtnStyle}>JE #{r.journal_entry_id}</Link> : '—'}
                  </td>
                  <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                    {canReverse && latestPosted?.id === r.id && <button style={dangerLinkStyle} onClick={() => setReverseTarget(r)}>Reverse</button>}
                  </td>
                </tr>,
              ]
              if (open) {
                rows.push(
                  <tr key={`${r.id}-lines`}>
                    <td colSpan={7} style={{ ...tdStyle, background: 'rgba(255,255,255,.5)', padding: '8px 12px 12px 32px' }}>
                      <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ ...thStyle, position: 'static', background: 'transparent' }}>Asset</th>
                            <th style={{ ...numTh, position: 'static', background: 'transparent' }}>Days</th>
                            <th style={{ ...numTh, position: 'static', background: 'transparent' }}>Book value before (₹)</th>
                            <th style={{ ...numTh, position: 'static', background: 'transparent' }}>Depreciation (₹)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.lines.map((l) => (
                            <tr key={l.id}>
                              <td style={tdStyle}><span style={{ fontWeight: 600 }}>{l.asset_code || `#${l.fixed_asset_id}`}</span>{l.asset_name ? ` — ${l.asset_name}` : ''}</td>
                              <td style={numTd}>{l.days}</td>
                              <td style={numTd}>{inr(l.book_value_before)}</td>
                              <td style={numTd}>{inr(l.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </td>
                  </tr>,
                )
              }
              return rows
            })}
        </tbody>
      </TableWrap>

      <ConfirmDialog
        open={confirmRun}
        title={`Run depreciation for ${period}?`}
        message={`Posts one journal for ${inr(previewTotal)}: Dr Depreciation expense / Cr Accumulated depreciation, for every active asset with a charge due up to month end. It can only be undone by reversing this run (newest first).`}
        confirmLabel="Run & post"
        danger={false}
        onConfirm={run}
        onCancel={() => setConfirmRun(false)}
      />
      <ReasonSheet icon="undo"
        open={!!reverseTarget}
        title={`Reverse depreciation for ${reverseTarget?.accounting_period}?`}
        message="Posts a reversal journal on the run date and puts each asset's accumulated depreciation back to what it was before this run. Give the reason."
        placeholder="Reason (required)"
        confirmLabel="Reverse"
        requireValue
        onConfirm={reverse}
        onCancel={() => setReverseTarget(null)}
      />
    </div>
  )
}
