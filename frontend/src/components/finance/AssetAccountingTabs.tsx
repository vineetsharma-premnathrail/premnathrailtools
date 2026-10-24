'use client'

// Finance › Assets sub-tabs for asset accounting: Capitalisation (ABZON /
// capital-order settlement), Retirements (scrap / sale, full or partial),
// Reconciliation (register vs ledger) and Tax Depreciation (Income-tax block
// schedule + deferred tax). Backend: accounts/routes/asset_accounting.py.
import React, { useEffect, useMemo, useState } from 'react'
import { accountsApi, crmApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { FixedAsset, GLAccount } from '@/types'
import { TEXT } from '@/lib/theme'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormSheet, SheetColumns, SheetSection, SheetIconName, SHEET, sheetInput, SheetError } from '@/components/shared/FormSheet'
import { SField, SRow, SheetBody, SheetFooter, sw, sg } from '@/components/finance/financeSheet'
import Select from '@/components/shared/Select'
import {
  inputStyle, sectionStyle, primaryBtnStyle, secondaryBtnStyle, linkBtnStyle, thStyle, tdStyle, numTd, numTh,
  inr, dmy, todayIso, Field, ErrorBanner, InfoBanner, StatusPill, TableWrap, EmptyRow, StatCard, ledgerOptions,
} from '@/components/finance/financeUi'
import {
  assetAccountingApi, CapitalisationQueue, CapitalisationLine, CapitalOrderOpen, AssetReconciliation, AssetRetirement,
  ITAssetBlock, ITSchedule, DeferredTaxReport,
} from '@/lib/financeAssetsFxApi'

type Opt = { value: string; label: string }

function currentFy(): string {
  const d = new Date()
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${String(y + 1).slice(2)}`
}

/** The tab's popup — the shared FormSheet (icon header, close ✕, Cancel + primary footer). */
function PortalModal({ title, subtitle, onClose, children, maxWidth = 620, icon = 'box', iconColor, busy = false, footer }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; maxWidth?: number
  icon?: SheetIconName; iconColor?: string; busy?: boolean; footer: React.ReactNode
}) {
  return (
    <FormSheet width={maxWidth} icon={icon} iconColor={iconColor} title={title} subtitle={subtitle || ''} onClose={onClose} busy={busy} footer={footer}>
      {children}
    </FormSheet>
  )
}

// ─── shared asset-master fields ─────────────────────────────────────────

type MasterForm = {
  asset_code: string; name: string; put_to_use_date: string; depreciation_method: 'slm' | 'wdv'
  useful_life_months: string; wdv_rate_pct: string; residual_value: string; quantity: string; it_block_id: string; location: string
}

function emptyMaster(putToUse: string): MasterForm {
  return { asset_code: '', name: '', put_to_use_date: putToUse, depreciation_method: 'slm', useful_life_months: '', wdv_rate_pct: '',
    residual_value: '0', quantity: '1', it_block_id: '', location: '' }
}

function masterPayload(f: MasterForm): Record<string, unknown> {
  return {
    asset_code: f.asset_code.trim(), name: f.name.trim(), put_to_use_date: f.put_to_use_date || null, location: f.location.trim() || null,
    depreciation_method: f.depreciation_method,
    useful_life_months: f.depreciation_method === 'slm' && f.useful_life_months ? Number(f.useful_life_months) : null,
    wdv_rate_pct: f.depreciation_method === 'wdv' && f.wdv_rate_pct ? Number(f.wdv_rate_pct) : null,
    residual_value: Number(f.residual_value || 0), quantity: Number(f.quantity || 1),
    it_block_id: f.it_block_id ? Number(f.it_block_id) : null,
  }
}

function MasterFields({ f, set, blockOpts }: { f: MasterForm; set: (p: Partial<MasterForm>) => void; blockOpts: Opt[] }) {
  return (
    <>
      <SheetSection icon="tag" title="Asset">
        <SRow>
          <SField label="Asset code" req style={sw(140)}><input style={sheetInput} value={f.asset_code} onChange={(e) => set({ asset_code: e.target.value })} /></SField>
          <SField label="Name" req style={sg(220, 340)}><input style={sheetInput} value={f.name} onChange={(e) => set({ name: e.target.value })} /></SField>
        </SRow>
        <SRow mb={0}>
          <SField label="Put to use on" req style={sw(160)}><DateField value={f.put_to_use_date} onChange={(v) => set({ put_to_use_date: v })} /></SField>
          <SField label="Units" style={sw(90)}><input type="number" min={1} step="any" style={sheetInput} value={f.quantity} onChange={(e) => set({ quantity: e.target.value })} /></SField>
          <SField label="Location" optional style={sg(160, 260)}><input style={sheetInput} value={f.location} onChange={(e) => set({ location: e.target.value })} /></SField>
        </SRow>
      </SheetSection>
      <SheetSection icon="clock" title="Depreciation">
        <SRow>
          <SField label="Method" req style={sw(190)}>
            <Select style={sheetInput} value={f.depreciation_method} onChange={(e) => set({ depreciation_method: e.target.value as 'slm' | 'wdv' })}>
              <option value="slm">Straight line (SLM)</option>
              <option value="wdv">Written-down value (WDV)</option>
            </Select>
          </SField>
          {f.depreciation_method === 'slm'
            ? <SField label="Useful life (months)" req style={sw(160)}><input type="number" min={1} style={sheetInput} value={f.useful_life_months} onChange={(e) => set({ useful_life_months: e.target.value })} placeholder="e.g. 180" /></SField>
            : <SField label="WDV rate %" req style={sw(130)}><input type="number" min={0} step="any" style={sheetInput} value={f.wdv_rate_pct} onChange={(e) => set({ wdv_rate_pct: e.target.value })} /></SField>}
          <SField label="Residual value (₹)" style={sw(150)}><input type="number" min={0} step="any" style={sheetInput} value={f.residual_value} onChange={(e) => set({ residual_value: e.target.value })} /></SField>
        </SRow>
        <SField label="Income-tax block" optional style={{ maxWidth: 360 }}><SearchableSelect value={f.it_block_id} onChange={(v) => set({ it_block_id: v })} options={blockOpts} placeholder="Not mapped yet" /></SField>
      </SheetSection>
    </>
  )
}

function useBlocksAndLedgers() {
  const [blocks, setBlocks] = useState<ITAssetBlock[]>([])
  const [ledgers, setLedgers] = useState<GLAccount[]>([])
  useEffect(() => {
    assetAccountingApi.blocks().then(setBlocks).catch(() => setBlocks([]))
    accountsApi.listGLAccounts().then(setLedgers).catch(() => setLedgers([]))
  }, [])
  const blockOpts = useMemo<Opt[]>(() => [{ value: '', label: 'Not mapped yet' }, ...blocks.filter((b) => b.is_active).map((b) => ({ value: String(b.id), label: `${b.code} — ${b.name} (${b.rate_pct}%)` }))], [blocks])
  const assetLedgerOpts = useMemo<Opt[]>(() => ledgerOptions(ledgers, (a) => a.account_type === 'asset' && /fixed|plant|property|machinery|furniture|vehicle|equipment|building|computer/i.test(`${a.group_name || ''} ${a.name}`)), [ledgers])
  return { blocks, blockOpts, ledgers, assetLedgerOpts }
}

// ─── Capitalisation ─────────────────────────────────────────────────────

export function CapitalisationTab({ canManage }: { canManage: boolean }) {
  const [queue, setQueue] = useState<CapitalisationQueue | null>(null)
  const [error, setError] = useState<string[] | null>(null)
  const [lineTarget, setLineTarget] = useState<CapitalisationLine | null>(null)
  const [orderTarget, setOrderTarget] = useState<CapitalOrderOpen | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { blockOpts, assetLedgerOpts } = useBlocksAndLedgers()

  const load = () => assetAccountingApi.queue().then((q) => { setQueue(q); setError(null) })
    .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load the capitalisation queue')))
  useEffect(() => { load() }, [])

  return (
    <div>
      <InfoBanner>
        A posted purchase invoice line on a fixed-asset ledger (or for an asset-category PO line / Item Master asset) waits here until it is
        registered. The asset&apos;s cost is taken from the line, so the register always agrees with the ledger. Spend booked to a capital
        internal order is settled into an asset with a journal (Dr asset ledger, Cr the ledgers the order was charged to).
      </InfoBanner>
      <ErrorBanner error={error} />
      {notice && <InfoBanner tone="success">{notice}</InfoBanner>}
      <h3 style={{ fontSize: 14, fontWeight: 800, color: TEXT.heading, margin: '6px 0 10px' }}>Purchase lines to capitalise</h3>
      <TableWrap minWidth={980} maxHeight="none">
        <thead><tr>
          <th style={thStyle}>Invoice</th><th style={thStyle}>Date</th><th style={thStyle}>Vendor</th><th style={thStyle}>Line</th><th style={thStyle}>Ledger</th>
          <th style={numTh}>Line value</th><th style={numTh}>Capitalised</th><th style={numTh}>Open</th><th style={thStyle}></th>
        </tr></thead>
        <tbody>
          {!queue ? <EmptyRow colSpan={9} text="Loading…" /> : queue.invoice_lines.length === 0 ? <EmptyRow colSpan={9} text="Nothing waiting — every asset purchase is in the register." /> :
            queue.invoice_lines.map((l) => (
              <tr key={l.vendor_invoice_line_id}>
                <td style={tdStyle}>{l.invoice_number}</td><td style={tdStyle}>{dmy(l.invoice_date)}</td><td style={tdStyle}>{l.vendor_name}</td>
                <td style={tdStyle}>{l.description}</td>
                <td style={tdStyle}>{l.gl_account_label}{!l.on_asset_ledger && <div style={{ fontSize: 11, color: '#b45309' }}>Not an asset ledger — reclassified on capitalisation</div>}</td>
                <td style={numTd}>{inr(l.line_value)}</td><td style={numTd}>{inr(l.capitalised, { blankZero: true })}</td><td style={numTd}>{inr(l.remaining)}</td>
                <td style={tdStyle}>{canManage && <button style={linkBtnStyle} onClick={() => { setNotice(null); setLineTarget(l) }}>Capitalise</button>}</td>
              </tr>
            ))}
        </tbody>
      </TableWrap>

      <h3 style={{ fontSize: 14, fontWeight: 800, color: TEXT.heading, margin: '6px 0 10px' }}>Capital orders (CWIP) with unsettled spend</h3>
      <TableWrap minWidth={760} maxHeight="none">
        <thead><tr><th style={thStyle}>Order</th><th style={thStyle}>Name</th><th style={thStyle}>Status</th><th style={numTh}>Spend to settle</th><th style={numTh}>Already settled</th><th style={thStyle}></th></tr></thead>
        <tbody>
          {!queue ? <EmptyRow colSpan={6} text="Loading…" /> : queue.capital_orders.length === 0 ? <EmptyRow colSpan={6} text="No capital order has unsettled spend." /> :
            queue.capital_orders.map((o) => (
              <tr key={o.internal_order_id}>
                <td style={tdStyle}>{o.code}</td><td style={tdStyle}>{o.name}</td><td style={tdStyle}>{o.status.replace(/_/g, ' ')}</td>
                <td style={numTd}>{inr(o.spend_to_settle)}</td><td style={numTd}>{inr(o.already_settled, { blankZero: true })}</td>
                <td style={tdStyle}>{canManage && <button style={linkBtnStyle} onClick={() => { setNotice(null); setOrderTarget(o) }}>Settle to asset</button>}</td>
              </tr>
            ))}
        </tbody>
      </TableWrap>

      {queue && queue.received_not_invoiced.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: TEXT.heading, margin: '6px 0 10px' }}>Asset PO lines received, bill not posted yet</h3>
          <InfoBanner tone="warning">These were received on a GRN (asset item category — no store stock). They can be capitalised once the vendor&apos;s bill is booked and posted under Finance › Purchase.</InfoBanner>
          <TableWrap minWidth={760} maxHeight="none">
            <thead><tr><th style={thStyle}>PO</th><th style={thStyle}>Vendor</th><th style={thStyle}>Item</th><th style={numTh}>Qty received, not billed</th><th style={numTh}>Value at PO rate</th></tr></thead>
            <tbody>
              {queue.received_not_invoiced.map((r) => (
                <tr key={r.po_item_id}><td style={tdStyle}>{r.po_number}</td><td style={tdStyle}>{r.vendor_name}</td><td style={tdStyle}>{r.description}</td>
                  <td style={numTd}>{r.received_not_invoiced_qty}</td><td style={numTd}>{inr(r.estimated_value)}</td></tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}

      {lineTarget && <CapitaliseLineDialog line={lineTarget} blockOpts={blockOpts} assetLedgerOpts={assetLedgerOpts} onClose={() => setLineTarget(null)}
        onDone={(a) => { setLineTarget(null); setNotice(`Asset ${a.asset_code} registered at ${inr(a.cost)}.`); load() }} />}
      {orderTarget && <SettleOrderDialog order={orderTarget} blockOpts={blockOpts} assetLedgerOpts={assetLedgerOpts} onClose={() => setOrderTarget(null)}
        onDone={(a) => { setOrderTarget(null); setNotice(`Order settled — asset ${a.asset_code} registered at ${inr(a.cost)}.`); load() }} />}
    </div>
  )
}

function CapitaliseLineDialog({ line, blockOpts, assetLedgerOpts, onClose, onDone }: {
  line: CapitalisationLine; blockOpts: Opt[]; assetLedgerOpts: Opt[]; onClose: () => void; onDone: (a: FixedAsset) => void
}) {
  const [f, setF] = useState<MasterForm>({ ...emptyMaster(line.invoice_date), name: line.description })
  const [cost, setCost] = useState(String(line.remaining))
  const [ledger, setLedger] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  const set = (p: Partial<MasterForm>) => setF((x) => ({ ...x, ...p }))
  const save = async () => {
    setSaving(true); setError(null)
    try {
      const a = await assetAccountingApi.capitaliseInvoiceLine({ ...masterPayload(f), vendor_invoice_line_id: line.vendor_invoice_line_id,
        cost: cost ? Number(cost) : null, asset_gl_account_id: !line.on_asset_ledger && ledger ? Number(ledger) : null })
      onDone(a)
    } catch (err: unknown) { setError(extractErrorMessages(err, 'Could not capitalise the line')) } finally { setSaving(false) }
  }
  return (
    <PortalModal title={`Capitalise ${line.invoice_number}`} subtitle={line.description} onClose={onClose} maxWidth={960} icon="box" busy={saving}
      footer={<SheetFooter onCancel={onClose} onSubmit={save} busy={saving} label="Register asset" icon="plus" disabled={!f.asset_code.trim() || !f.name.trim()} />}>
      <SheetColumns
        left={<><SheetError error={error} /><MasterFields f={f} set={set} blockOpts={blockOpts} /></>}
        right={
          <SheetSection icon="rupee" title="Cost">
            <div style={{ fontSize: 12.5, color: SHEET.BODY, marginBottom: 14, lineHeight: 1.6 }}>Line value {inr(line.line_value)} · already capitalised {inr(line.capitalised)} · open {inr(line.remaining)}</div>
            <SField label="Cost to register (₹)" req style={{ maxWidth: 200, marginBottom: 14 }}><input type="number" min={0} step="any" style={sheetInput} value={cost} onChange={(e) => setCost(e.target.value)} /></SField>
            {!line.on_asset_ledger && <SField label="Move to fixed-asset ledger" req hint="The line was booked to a ledger that is not a fixed-asset ledger; it is reclassified on capitalisation.">
              <SearchableSelect value={ledger} onChange={setLedger} options={assetLedgerOpts} placeholder="Pick the asset ledger" />
            </SField>}
          </SheetSection>
        }
      />
    </PortalModal>
  )
}

function SettleOrderDialog({ order, blockOpts, assetLedgerOpts, onClose, onDone }: {
  order: CapitalOrderOpen; blockOpts: Opt[]; assetLedgerOpts: Opt[]; onClose: () => void; onDone: (a: FixedAsset) => void
}) {
  const [f, setF] = useState<MasterForm>({ ...emptyMaster(todayIso()), name: order.name })
  const [amount, setAmount] = useState(String(order.spend_to_settle))
  const [date, setDate] = useState(todayIso())
  const [ledger, setLedger] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  const set = (p: Partial<MasterForm>) => setF((x) => ({ ...x, ...p }))
  const save = async () => {
    setSaving(true); setError(null)
    try {
      const a = await assetAccountingApi.capitaliseOrder({ ...masterPayload(f), internal_order_id: order.internal_order_id, settlement_date: date,
        asset_gl_account_id: ledger ? Number(ledger) : 0, amount: amount ? Number(amount) : null })
      onDone(a)
    } catch (err: unknown) { setError(extractErrorMessages(err, `Could not settle order ${order.code}`)) } finally { setSaving(false) }
  }
  return (
    <PortalModal title={`Settle ${order.code} to a fixed asset`} subtitle={order.name} onClose={onClose} maxWidth={960} icon="building" busy={saving}
      footer={<SheetFooter onCancel={onClose} onSubmit={save} busy={saving} label="Settle & post" busyLabel="Posting…" disabled={!f.asset_code.trim() || !ledger} />}>
      <SheetColumns
        left={<><SheetError error={error} /><MasterFields f={f} set={set} blockOpts={blockOpts} /></>}
        right={
          <SheetSection icon="rupee" title="Settlement">
            <InfoBanner>Posts Dr the asset ledger and Cr each ledger the order was charged to (in proportion), tagged with the order, so the order&apos;s open spend falls by the amount settled.</InfoBanner>
            <SRow>
              <SField label="Settlement date" req style={sw(160)}><DateField value={date} onChange={setDate} /></SField>
              <SField label="Amount to settle (₹)" req style={sw(170)}><input type="number" min={0} step="any" style={sheetInput} value={amount} onChange={(e) => setAmount(e.target.value)} /></SField>
            </SRow>
            <SField label="Fixed-asset ledger" req><SearchableSelect value={ledger} onChange={setLedger} options={assetLedgerOpts} placeholder="Pick the asset ledger" /></SField>
          </SheetSection>
        }
      />
    </PortalModal>
  )
}

// ─── Retirements ────────────────────────────────────────────────────────

const RET_HEX: Record<string, string> = { sale: '#1d4ed8', scrap: '#64748b' }
const RET_LABELS: Record<string, string> = { sale: 'Sale', scrap: 'Scrap' }

export function RetirementsTab({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<AssetRetirement[] | null>(null)
  const [error, setError] = useState<string[] | null>(null)
  const [open, setOpen] = useState(false)
  const load = () => assetAccountingApi.retirements().then((r) => { setRows(r); setError(null) })
    .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load retirements')))
  useEffect(() => { load() }, [])
  return (
    <div>
      <InfoBanner>
        Retire all or part of an asset (by % of cost or by units). Depreciation is charged to the retirement date, the retired share of cost and
        accumulated depreciation is removed, and the gain or loss is posted. A sale also raises a draft GST tax invoice to the buyer under
        Finance › Sales — its revenue line clears the Asset Sale Clearing ledger once another finance user posts it.
      </InfoBanner>
      <ErrorBanner error={error} />
      {canManage && <div style={{ marginBottom: 12 }}><button style={primaryBtnStyle} onClick={() => setOpen(true)}>Retire / sell an asset</button></div>}
      <TableWrap minWidth={1100}>
        <thead><tr>
          <th style={thStyle}>Date</th><th style={thStyle}>Asset</th><th style={thStyle}>Type</th><th style={numTh}>Share</th><th style={numTh}>Cost retired</th>
          <th style={numTh}>Dep. retired</th><th style={numTh}>Sale value</th><th style={numTh}>Gain / (loss)</th><th style={thStyle}>Buyer / invoice</th><th style={thStyle}>Journal</th>
        </tr></thead>
        <tbody>
          {!rows ? <EmptyRow colSpan={10} text="Loading…" /> : rows.length === 0 ? <EmptyRow colSpan={10} text="No retirements yet." /> : rows.map((r) => (
            <tr key={r.id}>
              <td style={tdStyle}>{dmy(r.retirement_date)}</td><td style={tdStyle}>{r.asset_code} — {r.asset_name}</td>
              <td style={tdStyle}><StatusPill status={r.retirement_type} labels={RET_LABELS} colors={RET_HEX} /></td>
              <td style={numTd}>{r.retire_quantity ? `${r.retire_quantity} unit(s)` : `${r.retire_percent}%`}</td>
              <td style={numTd}>{inr(r.retired_cost)}</td><td style={numTd}>{inr(r.retired_accumulated_depreciation)}</td>
              <td style={numTd}>{inr(r.sale_value, { blankZero: true })}</td>
              <td style={{ ...numTd, color: r.gain_loss >= 0 ? '#15803d' : '#b91c1c' }}>{r.gain_loss >= 0 ? inr(r.gain_loss) : `(${inr(-r.gain_loss)})`}</td>
              <td style={tdStyle}>{r.customer_name ? `${r.customer_name} · ${r.ar_status === 'pending' ? 'invoice draft — post under Sales' : r.ar_invoice_number}` : '—'}</td>
              <td style={tdStyle}>{r.journal_entry_number}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {open && <RetireDialog onClose={() => setOpen(false)} onDone={() => { setOpen(false); load() }} />}
    </div>
  )
}

function RetireDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [assetList, setAssetList] = useState<FixedAsset[]>([])
  const [customers, setCustomers] = useState<Opt[]>([])
  const [assetId, setAssetId] = useState('')
  const [type, setType] = useState<'scrap' | 'sale'>('sale')
  const [by, setBy] = useState<'percent' | 'quantity'>('percent')
  const [share, setShare] = useState('100')
  const [date, setDate] = useState(todayIso())
  const [saleValue, setSaleValue] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [gstRate, setGstRate] = useState('18')
  const [hsn, setHsn] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string[] | null>(null)
  useEffect(() => {
    accountsApi.listFixedAssets({ status: 'active' }).then(setAssetList).catch((err: unknown) => setError(extractErrorMessages(err, 'Could not load assets')))
    crmApi.listOrganizations({ picker: true }).then((orgs: { id: number; name: string }[]) => setCustomers(orgs.map((o) => ({ value: String(o.id), label: o.name }))))
      .catch(() => setCustomers([]))
  }, [])
  const asset = assetList.find((a) => String(a.id) === assetId)
  const save = async () => {
    setSaving(true); setError(null)
    try {
      await assetAccountingApi.retire(Number(assetId), {
        retirement_date: date, retirement_type: type, reason: reason.trim(),
        retire_percent: by === 'percent' ? Number(share || 0) : null, retire_quantity: by === 'quantity' ? Number(share || 0) : null,
        sale_value: type === 'sale' ? Number(saleValue || 0) : 0, customer_id: type === 'sale' && customerId ? Number(customerId) : null,
        gst_rate: type === 'sale' && gstRate !== '' ? Number(gstRate) : null, hsn_sac_code: hsn.trim() || null,
      })
      onDone()
    } catch (err: unknown) { setError(extractErrorMessages(err, 'Could not retire the asset')) } finally { setSaving(false) }
  }
  return (
    <PortalModal title="Retire / sell an asset" subtitle="Scrap or sale, full or partial — depreciation is charged to the retirement date first." onClose={onClose} maxWidth={960} icon="trash" iconColor="#b91c1c" busy={saving}
      footer={<SheetFooter onCancel={onClose} onSubmit={save} busy={saving} label="Retire & post" busyLabel="Posting…" color="#b91c1c" disabled={!assetId || !reason.trim()} />}>
      <SheetColumns
        left={<>
          <SheetError error={error} />
          <SheetSection icon="box" title="Asset">
            <SField label="Asset" req style={{ maxWidth: 440, marginBottom: 14 }}>
              <SearchableSelect value={assetId} onChange={setAssetId} options={assetList.map((a) => ({ value: String(a.id), label: `${a.asset_code} — ${a.name}` }))} placeholder="Pick the asset" />
            </SField>
            {asset && <div style={{ fontSize: 12.5, color: SHEET.BODY, marginBottom: 14 }}>Cost {inr(asset.cost)} · accumulated depreciation {inr(asset.accumulated_depreciation)} · book value {inr(asset.book_value)}</div>}
            <SRow>
              <SField label="Date" req style={sw(160)}><DateField value={date} onChange={setDate} /></SField>
              <SField label="Type" req style={sw(190)}>
                <Select style={sheetInput} value={type} onChange={(e) => setType(e.target.value as 'scrap' | 'sale')}>
                  <option value="sale">Sale to a customer</option><option value="scrap">Scrap (no buyer)</option>
                </Select>
              </SField>
            </SRow>
            <SRow mb={0}>
              <SField label="Retire by" style={sw(150)}>
                <Select style={sheetInput} value={by} onChange={(e) => { const v = e.target.value as 'percent' | 'quantity'; setBy(v); setShare(v === 'percent' ? '100' : '1') }}>
                  <option value="percent">% of cost</option><option value="quantity">Units</option>
                </Select>
              </SField>
              <SField label={by === 'percent' ? 'Percent' : 'Units'} req style={sw(120)}><input type="number" min={0} step="any" style={sheetInput} value={share} onChange={(e) => setShare(e.target.value)} /></SField>
            </SRow>
          </SheetSection>
          <SheetSection icon="chat" title="Reason">
            <SField label="Reason" req><input style={sheetInput} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. obsolete, damaged beyond repair, sold" /></SField>
          </SheetSection>
        </>}
        right={type === 'sale' ? (
          <SheetSection icon="users" title="Sale">
            <SField label="Buyer (customer)" req style={{ marginBottom: 14 }}><SearchableSelect value={customerId} onChange={setCustomerId} options={customers} placeholder="Pick the buyer" /></SField>
            <SRow>
              <SField label="Sale value before GST (₹)" req style={sw(190)}><input type="number" min={0} step="any" style={sheetInput} value={saleValue} onChange={(e) => setSaleValue(e.target.value)} /></SField>
            </SRow>
            <SRow mb={0}>
              <SField label="GST rate %" req style={sw(120)}><input type="number" min={0} step="any" style={sheetInput} value={gstRate} onChange={(e) => setGstRate(e.target.value)} /></SField>
              <SField label="HSN" optional style={sw(130)}><input style={sheetInput} value={hsn} onChange={(e) => setHsn(e.target.value)} /></SField>
            </SRow>
            <p style={{ fontSize: 12, color: SHEET.MUTED, margin: '12px 0 0' }}>A draft GST tax invoice to the buyer is raised under Finance › Sales; its revenue line clears the Asset Sale Clearing ledger once another finance user posts it.</p>
          </SheetSection>
        ) : (
          <SheetSection icon="trash" title="Scrap">
            <p style={{ fontSize: 12.5, color: SHEET.BODY, margin: 0, lineHeight: 1.6 }}>No buyer and no sale value — the retired share&apos;s book value posts as a loss on retirement.</p>
          </SheetSection>
        )}
      />
    </PortalModal>
  )
}

// ─── Reconciliation ─────────────────────────────────────────────────────

export function AssetReconciliationTab() {
  const [asOf, setAsOf] = useState(todayIso())
  const [data, setData] = useState<AssetReconciliation | null>(null)
  const [error, setError] = useState<string[] | null>(null)
  useEffect(() => {
    assetAccountingApi.reconciliation(asOf).then((d) => { setData(d); setError(null) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not reconcile the register with the ledgers')))
  }, [asOf])
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <Field label="As of" style={{ flex: '0 1 170px', minWidth: 150 }}><DateField value={asOf} onChange={setAsOf} /></Field>
        {data && <StatCard label="Status" value={data.is_reconciled ? 'Reconciled' : 'Differences'} tone={data.is_reconciled ? '#15803d' : '#b91c1c'} />}
      </div>
      <InfoBanner>Register figures are the current register; run it as of today (or after the last posting) for an exact match. A difference explained by purchases waiting to be capitalised clears once they are registered on the Capitalisation tab.</InfoBanner>
      <ErrorBanner error={error} />
      <TableWrap minWidth={980}>
        <thead><tr><th style={thStyle}>Ledger</th><th style={thStyle}>What</th><th style={numTh}>Ledger balance</th><th style={numTh}>Register</th><th style={numTh}>Difference</th><th style={numTh}>Awaiting capitalisation</th><th style={numTh}>Unexplained</th></tr></thead>
        <tbody>
          {!data ? <EmptyRow colSpan={7} text="Loading…" /> : data.rows.length === 0 ? <EmptyRow colSpan={7} text="No fixed-asset ledger has a balance." /> : data.rows.map((r) => (
            <tr key={`${r.kind}-${r.gl_account_id}`}>
              <td style={tdStyle}>{r.gl_account_label}</td><td style={tdStyle}>{r.kind === 'cost' ? 'Cost' : 'Accumulated depreciation'}</td>
              <td style={numTd}>{inr(r.gl_balance)}</td><td style={numTd}>{inr(r.register)}</td>
              <td style={{ ...numTd, color: r.ok ? TEXT.body : '#b91c1c', fontWeight: r.ok ? 400 : 700 }}>{inr(r.difference, { blankZero: true })}</td>
              <td style={numTd}>{inr(r.awaiting_capitalisation, { blankZero: true })}</td>
              <td style={{ ...numTd, color: Math.abs(r.unexplained) >= 0.5 ? '#b91c1c' : TEXT.body }}>{inr(r.unexplained, { blankZero: true })}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  )
}

// ─── Tax depreciation & deferred tax ────────────────────────────────────

export function TaxDepreciationTab({ canEdit }: { canEdit: boolean }) {
  const [fy, setFy] = useState(currentFy())
  const [taxRate, setTaxRate] = useState('25.168')
  const [sched, setSched] = useState<ITSchedule | null>(null)
  const [dt, setDt] = useState<DeferredTaxReport | null>(null)
  const [error, setError] = useState<string[] | null>(null)
  const [openingFor, setOpeningFor] = useState<{ id: number; code: string } | null>(null)
  const { blockOpts } = useBlocksAndLedgers()
  const [mapping, setMapping] = useState<Record<number, string>>({})

  const load = () => {
    if (!/^\d{4}-\d{2}$/.test(fy)) return
    Promise.all([assetAccountingApi.itSchedule(fy), assetAccountingApi.deferredTax(fy, Number(taxRate) || undefined)])
      .then(([s, d]) => { setSched(s); setDt(d); setError(null) })
      .catch((err: unknown) => setError(extractErrorMessages(err, 'Could not compute the tax depreciation schedule')))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [fy, taxRate])

  const saveOpening = async (value: string) => {
    const target = openingFor
    setOpeningFor(null)
    if (!target) return
    try { await assetAccountingApi.setBlockOpening(target.id, fy, Number(value || 0)); load() }
    catch (err: unknown) { setError(extractErrorMessages(err, `Could not save the opening WDV of ${target.code}`)) }
  }
  const mapAsset = async (assetId: number) => {
    const v = mapping[assetId]
    if (!v) return
    try { await assetAccountingApi.setTaxBlock(assetId, Number(v)); load() }
    catch (err: unknown) { setError(extractErrorMessages(err, 'Could not set the Income-tax block')) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <Field label="Financial year" style={{ flex: '0 1 120px', minWidth: 110 }}><input style={inputStyle} value={fy} onChange={(e) => setFy(e.target.value.trim())} placeholder="2026-27" /></Field>
        <Field label="Tax rate for deferred tax %" style={{ flex: '0 1 190px', minWidth: 170 }}><input type="number" min={0} step="any" style={inputStyle} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></Field>
      </div>
      <InfoBanner>
        Income-tax Act depreciation on each block&apos;s written-down value (Sec 32, Rule 5) — report only, nothing is posted. Additions put to use for
        less than 180 days in the year get half the rate; sale money of assets in the block is deducted first. Enter each block&apos;s opening WDV
        once (from the last tax audit report); later years carry the closing WDV forward. Additional depreciation (Sec 32(1)(iia)) isn&apos;t
        computed — it isn&apos;t available under Sec 115BAA.
      </InfoBanner>
      <ErrorBanner error={error} />
      <TableWrap minWidth={1200} maxHeight="none">
        <thead><tr>
          <th style={thStyle}>Block</th><th style={numTh}>Rate</th><th style={numTh}>Opening WDV</th><th style={numTh}>Additions ≥180 d</th><th style={numTh}>Additions &lt;180 d</th>
          <th style={numTh}>Sales</th><th style={numTh}>Depreciation</th><th style={numTh}>Closing WDV</th><th style={numTh}>STCG / STCL (s.50)</th><th style={thStyle}></th>
        </tr></thead>
        <tbody>
          {!sched ? <EmptyRow colSpan={10} text="Loading…" /> : sched.blocks.map((b) => (
            <tr key={b.block_id}>
              <td style={tdStyle}>{b.block_code} — {b.block_name}</td><td style={numTd}>{b.rate_pct}%</td>
              <td style={numTd}>{inr(b.opening_wdv)}{b.opening_entered && <div style={{ fontSize: 10.5, color: TEXT.muted }}>entered</div>}</td>
              <td style={numTd}>{inr(b.additions_full_rate, { blankZero: true })}</td><td style={numTd}>{inr(b.additions_half_rate, { blankZero: true })}</td>
              <td style={numTd}>{inr(b.deductions, { blankZero: true })}</td><td style={numTd}>{inr(b.depreciation)}</td><td style={numTd}>{inr(b.closing_wdv)}</td>
              <td style={numTd}>{b.short_term_capital_gain ? inr(b.short_term_capital_gain) : b.short_term_capital_loss ? `(${inr(b.short_term_capital_loss)})` : '—'}</td>
              <td style={tdStyle}>{canEdit && <button style={linkBtnStyle} onClick={() => setOpeningFor({ id: b.block_id, code: b.block_code })}>Opening WDV</button>}</td>
            </tr>
          ))}
          {sched && <tr>
            <td style={{ ...tdStyle, fontWeight: 800 }}>Total</td><td style={tdStyle}></td>
            <td style={{ ...numTd, fontWeight: 800 }}>{inr(sched.totals.opening_wdv)}</td><td style={{ ...numTd, fontWeight: 800 }}>{inr(sched.totals.additions_full_rate)}</td>
            <td style={{ ...numTd, fontWeight: 800 }}>{inr(sched.totals.additions_half_rate)}</td><td style={{ ...numTd, fontWeight: 800 }}>{inr(sched.totals.deductions)}</td>
            <td style={{ ...numTd, fontWeight: 800 }}>{inr(sched.totals.depreciation)}</td><td style={{ ...numTd, fontWeight: 800 }}>{inr(sched.totals.closing_wdv)}</td><td style={tdStyle} colSpan={2}></td>
          </tr>}
        </tbody>
      </TableWrap>

      {sched && sched.unmapped_assets.length > 0 && (
        <div style={sectionStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: TEXT.heading, margin: '0 0 8px' }}>Assets without an Income-tax block</h3>
          <InfoBanner tone="warning">These are left out of the tax schedule and the deferred tax until they are mapped.</InfoBanner>
          {sched.unmapped_assets.map((a) => (
            <div key={a.fixed_asset_id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <div style={{ flex: '1 1 240px', fontSize: 12.5 }}>{a.asset_code} — {a.name}</div>
              {canEdit && <>
                <div style={{ flex: '0 1 320px', minWidth: 240 }}><SearchableSelect value={mapping[a.fixed_asset_id] || ''} onChange={(v) => setMapping((m) => ({ ...m, [a.fixed_asset_id]: v }))} options={blockOpts.filter((o) => o.value)} placeholder="Pick the block" /></div>
                <button style={secondaryBtnStyle} disabled={!mapping[a.fixed_asset_id]} onClick={() => mapAsset(a.fixed_asset_id)}>Map</button>
              </>}
            </div>
          ))}
        </div>
      )}

      {dt && (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: TEXT.heading, margin: '6px 0 10px' }}>Deferred tax on fixed assets — {dt.fy_code} (as of {dmy(dt.as_of)})</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <StatCard label="Book WDV (Schedule II)" value={inr(dt.total_book_wdv)} />
            <StatCard label="Tax WDV" value={inr(dt.total_tax_wdv)} />
            <StatCard label={dt.net_deferred_tax >= 0 ? 'Net deferred tax liability' : 'Net deferred tax asset'} value={inr(Math.abs(dt.net_deferred_tax))} />
            <StatCard label={`Charge / (credit) vs ${dt.previous_fy_code}`} value={dt.movement >= 0 ? inr(dt.movement) : `(${inr(-dt.movement)})`} />
          </div>
          <TableWrap minWidth={900} maxHeight="none">
            <thead><tr><th style={thStyle}>Block</th><th style={numTh}>Book WDV</th><th style={numTh}>Tax WDV</th><th style={numTh}>Timing difference</th><th style={numTh}>Deferred tax @ {dt.tax_rate_pct}%</th><th style={thStyle}>Nature</th></tr></thead>
            <tbody>
              {dt.rows.map((r) => (
                <tr key={r.block_id}><td style={tdStyle}>{r.block_code} — {r.block_name}</td><td style={numTd}>{inr(r.book_wdv)}</td><td style={numTd}>{inr(r.tax_wdv)}</td>
                  <td style={numTd}>{inr(r.difference)}</td><td style={numTd}>{inr(r.deferred_tax)}</td><td style={tdStyle}>{r.nature}</td></tr>
              ))}
            </tbody>
          </TableWrap>
          {dt.unmapped_book_value > 0 && <InfoBanner tone="warning">Book value of {inr(dt.unmapped_book_value)} sits on assets not mapped to a block — it is not in the deferred tax above.</InfoBanner>}
          <InfoBanner>A deferred tax asset is recognised only with reasonable certainty of future taxable income (AS 22 para 17). Post the year&apos;s charge with a journal at year end.</InfoBanner>
        </>
      )}

      {openingFor && <OpeningWdvSheet fy={fy} code={openingFor.code} onConfirm={saveOpening} onCancel={() => setOpeningFor(null)} />}
    </div>
  )
}

function OpeningWdvSheet({ fy, code, onConfirm, onCancel }: { fy: string; code: string; onConfirm: (value: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('')
  return (
    <PortalModal title={`Opening WDV ${fy} — ${code}`} subtitle="Income-tax block written-down value" onClose={onCancel} maxWidth={580} icon="rupee"
      footer={<SheetFooter onCancel={onCancel} onSubmit={() => onConfirm(value.trim())} busy={false} label="Save" disabled={!value.trim()} />}>
      <SheetBody>
        <SField label="Opening WDV (₹)" req style={{ maxWidth: 220 }}
          hint="The block's written-down value at the start of the year, as per the last tax audit report (Form 3CD clause 18).">
          <input type="number" min={0} step="any" autoFocus style={sheetInput} value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
        </SField>
      </SheetBody>
    </PortalModal>
  )
}
