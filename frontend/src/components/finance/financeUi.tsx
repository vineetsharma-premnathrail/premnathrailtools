'use client'

/** Building blocks shared by every Finance page — styles, money formatting,
 *  status pills, sub-tabs, the list-table shell and the GST line-items
 *  editor used by purchase/sales invoices and debit/credit notes. */
import React, { useEffect, useState } from 'react'
import { accountsApi, costCentersApi } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { TEXT, GLASS, SHADOWS, BRAND, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { GLAccount, GSTRate, TaxLineInput } from '@/types'

export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body, boxSizing: 'border-box',
}
export const labelStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: TEXT.secondary, marginBottom: 5, display: 'block' }
export const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
export const primaryBtnStyle: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 9, border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  background: `linear-gradient(140deg,${BRAND.primary},${BRAND.primaryHover})`, color: '#fff', whiteSpace: 'nowrap',
}
export const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 9999, border: `1px solid ${BORDER.normal}`, fontSize: 12.5, fontWeight: 600,
  cursor: 'pointer', background: '#fff', color: TEXT.secondary, whiteSpace: 'nowrap',
}
export const linkBtnStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: BRAND.primaryActive, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }
export const dangerLinkStyle: React.CSSProperties = { ...linkBtnStyle, color: '#b91c1c' }
export const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase',
  letterSpacing: '.04em', position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap',
}
export const tdStyle: React.CSSProperties = { padding: '9px 12px', fontSize: 12.5, color: TEXT.body, borderTop: `1px solid ${BORDER.normal}` }
export const numTd: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
export const numTh: React.CSSProperties = { ...thStyle, textAlign: 'right' }

/** Indian-grouped money, 2 decimals: 1,23,456.70. Negative in brackets. */
export function inr(n: number | null | undefined, opts: { blankZero?: boolean } = {}): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (opts.blankZero && Math.abs(n) < 0.005) return ''
  const s = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `(${s})` : s
}

/** dd-mm-yyyy for display; values stay ISO. */
export function dmy(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}-${m}-${y}`
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function currentPeriod(): string {
  return todayIso().slice(0, 7)
}

/** Start of the Indian financial year (1-Apr) containing today. */
export function fyStartIso(): string {
  const d = new Date()
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-04-01`
}

export function Field({ label, children, style, tour }: { label: string; children: React.ReactNode; style?: React.CSSProperties; tour?: string }) {
  return <div style={style} data-tour={tour}><label style={labelStyle}>{label}</label>{children}</div>
}

export function ErrorBanner({ error }: { error: string | string[] | null | undefined }) {
  if (!error || (Array.isArray(error) && error.length === 0)) return null
  const items = Array.isArray(error) ? error : [error]
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {items.map((e, i) => <div key={i}>{e}</div>)}
    </div>
  )
}

export function InfoBanner({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warning' | 'success' }) {
  const c = { info: '#0369a1', warning: '#b45309', success: '#15803d' }[tone]
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: `${c}12`, border: `1px solid ${c}33`, color: c, fontSize: 12.5, lineHeight: 1.5 }}>
      {children}
    </div>
  )
}

/** Approval-engine state of a draft document (Organization › Approval Workflows):
 *  "Awaiting approval · <stage>" while pending, "Returned" when sent back. */
export function ApprovalBadge({ status, stage }: { status?: string | null; stage?: string | null }) {
  if (status !== 'pending' && status !== 'returned') return null
  const hex = status === 'pending' ? '#F59E0B' : '#7c3aed'
  const text = status === 'pending' ? `Awaiting approval${stage ? ` · ${stage}` : ''}` : 'Returned for changes'
  return <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>{text}</span>
}

/** After saving a draft, send it to its approvers. Returns '' on success, or a
 *  message saying the draft was kept and why it couldn't be sent. */
export async function submitAfterSave(submit: () => Promise<unknown>, what: string): Promise<string> {
  try {
    await submit()
    return ''
  } catch (err: unknown) {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
    const reason = typeof detail === 'string' ? detail : 'the approval workflow refused it'
    return `${what} was saved as a draft, but it couldn't be sent for approval: ${reason} Fix that, then use "Submit for approval" on it.`
  }
}

export function StatusPill({ status, labels, colors }: { status: string; labels?: Record<string, string>; colors: Record<string, string> }) {
  const hex = colors[status] || '#64748b'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${hex}1a`, color: hex, whiteSpace: 'nowrap' }}>
      {labels?.[status] || status.replace(/_/g, ' ')}
    </span>
  )
}

/**
 * In-page sub-tabs filtered by the Permission Matrix: `keys` maps each
 * sub-tab label to its Finance & Accounting tab key; a sub-tab the user can't
 * view is hidden, and the selection falls back to the first visible one.
 */
export function useFinanceSubTabs<T extends string>(tabs: readonly T[], keys: Record<T, string>, initial?: T) {
  const { can } = useCan()
  const visible = tabs.filter((t) => can('accounts', keys[t], 'view'))
  const [tab, setTab] = useState<T>(initial ?? visible[0] ?? tabs[0])
  const current = visible.includes(tab) ? tab : (visible[0] ?? tab)
  return { tabs: visible, tab: current, setTab, none: visible.length === 0 }
}

export function SubTabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
      {tabs.map((t) => (
        <button key={t} data-tour={`fin-subtab-${t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`} aria-pressed={value === t} onClick={() => onChange(t)} style={{
          padding: '8px 16px', borderRadius: 9999, border: `1px solid ${value === t ? BRAND.primary : BORDER.normal}`,
          background: value === t ? `${BRAND.primary}1a` : '#fff', color: value === t ? BRAND.primaryActive : TEXT.secondary,
          fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
        }}>{t}</button>
      ))}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: TEXT.heading, margin: 0 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: TEXT.secondary, margin: '4px 0 0', maxWidth: 760, lineHeight: 1.5 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  )
}

/** Canonical list-table shell: glass wrapper, horizontal scroll, sticky header. */
export function TableWrap({ children, minWidth = 900, maxHeight = 'calc(100vh - 320px)', tour }: { children: React.ReactNode; minWidth?: number; maxHeight?: string; tour?: string }) {
  return (
    <div data-tour={tour} style={{ borderRadius: 16, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
      border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight, marginBottom: 20 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth }}>{children}</table>
    </div>
  )
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return <tr><td colSpan={colSpan} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted, padding: 24 }}>{text}</td></tr>
}

export function StatCard({ label, value, tone, tour }: { label: string; value: string; tone?: string; tour?: string }) {
  return (
    <div data-tour={tour} style={{ ...sectionStyle, padding: '14px 18px', marginBottom: 0, flex: '1 1 180px', maxWidth: 280 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: tone || TEXT.heading, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

export function ledgerOptions(accounts: GLAccount[], filter?: (a: GLAccount) => boolean) {
  return accounts
    .filter((a) => a.status === 'active' && a.is_posting_account && (!filter || filter(a)))
    .map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}${a.group_name ? ` (${a.group_name})` : ''}` }))
}

// ─── GST line-items editor ──────────────────────────────────────────────

export type EditableTaxLine = TaxLineInput & { key: string }

export function newTaxLine(): EditableTaxLine {
  return { key: Math.random().toString(36).slice(2), description: '', hsn_sac_code: '', quantity: 1, uom: '', rate: 0, discount_amount: 0, gst_rate: 18, gl_account_id: null }
}

/** Same arithmetic as the server (services/gst.py) — shown as a preview; the
 *  server recomputes and its figures are what gets saved. */
export function previewTax(lines: TaxLineInput[], interstate: boolean) {
  let taxable = 0, cgst = 0, sgst = 0, igst = 0
  for (const l of lines) {
    const t = Math.round((Math.round(Number(l.quantity || 0) * Number(l.rate || 0) * 100) / 100 - Number(l.discount_amount || 0)) * 100) / 100
    taxable += t
    const r = Number(l.gst_rate || 0)
    if (interstate) igst += Math.round(t * r) / 100
    else { const half = Math.round(t * r / 2) / 100; cgst += half; sgst += half }
  }
  const round = (x: number) => Math.round(x * 100) / 100
  return { taxable: round(taxable), cgst: round(cgst), sgst: round(sgst), igst: round(igst), tax: round(cgst + sgst + igst), total: round(taxable + cgst + sgst + igst) }
}

/** Cost-object pickers for document lines (Controlling): pass the active
 *  cost centres and released internal orders to show the two columns. */
export type CostObjectOptions = {
  costCenters: { id: number; code: string; name: string }[]
  internalOrders: { id: number; code: string; name: string }[]
}

/** Active cost centres + released (Open / In progress) internal orders for
 *  line pickers. Load failures leave the lists empty — the server still
 *  defaults and checks the cost object, so nothing is posted wrongly. */
export function useCostObjectOptions(): CostObjectOptions {
  const [opts, setOpts] = useState<CostObjectOptions>({ costCenters: [], internalOrders: [] })
  useEffect(() => {
    let alive = true
    Promise.all([
      costCentersApi.listCostCenters().catch(() => []),
      accountsApi.listInternalOrders().catch(() => []),
    ]).then(([ccs, ios]: [{ id: number; code: string; name: string; status: string }[], { id: number; code: string; name: string; status: string }[]]) => {
      if (!alive) return
      setOpts({
        costCenters: ccs.filter((c) => c.status === 'active'),
        internalOrders: ios.filter((o) => o.status === 'open' || o.status === 'in_progress'),
      })
    })
    return () => { alive = false }
  }, [])
  return opts
}

export function TaxLinesEditor({ lines, onChange, ledgers, rates, interstate, ledgerHint, costObjects }: {
  lines: EditableTaxLine[]
  onChange: (lines: EditableTaxLine[]) => void
  ledgers: GLAccount[]
  rates: GSTRate[]
  interstate: boolean | null
  ledgerHint?: string
  costObjects?: CostObjectOptions
}) {
  const ccOpts = [{ value: '', label: '— None —' }, ...(costObjects?.costCenters || []).map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }))]
  const ioOpts = [{ value: '', label: '— None —' }, ...(costObjects?.internalOrders || []).map((o) => ({ value: String(o.id), label: `${o.code} — ${o.name}` }))]
  const set = (key: string, patch: Partial<EditableTaxLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const active = rates.filter((r) => r.is_active)
  const totals = previewTax(lines, !!interstate)
  const cell: React.CSSProperties = { padding: '6px 6px', borderTop: `1px solid ${BORDER.normal}`, verticalAlign: 'top' }
  return (
    <div>
      <div style={{ overflowX: 'auto' }} data-tour="fin-lines-table">
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: costObjects ? 1450 : 1050 }}>
          <thead>
            <tr>
              {['Description', 'HSN/SAC', 'Qty', 'Unit', 'Rate', 'Discount', 'GST %', `Ledger${ledgerHint ? ` (${ledgerHint})` : ''}`,
                ...(costObjects ? ['Cost centre', 'Internal order'] : []), 'Taxable', ''].map((h) => (
                <th key={h} style={{ ...thStyle, position: 'static', background: 'transparent', padding: '6px 6px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const taxable = Math.round((Number(l.quantity || 0) * Number(l.rate || 0) - Number(l.discount_amount || 0)) * 100) / 100
              return (
                <tr key={l.key}>
                  <td style={{ ...cell, minWidth: 200 }}><input style={inputStyle} value={l.description || ''} placeholder="Item / service" onChange={(e) => set(l.key, { description: e.target.value })} /></td>
                  <td style={{ ...cell, width: 95 }}><input style={inputStyle} value={l.hsn_sac_code || ''} onChange={(e) => set(l.key, { hsn_sac_code: e.target.value })} /></td>
                  <td style={{ ...cell, width: 80 }}><input type="number" min={0} step="any" style={inputStyle} value={l.quantity} onChange={(e) => set(l.key, { quantity: Number(e.target.value) })} /></td>
                  <td style={{ ...cell, width: 70 }}><input style={inputStyle} value={l.uom || ''} onChange={(e) => set(l.key, { uom: e.target.value })} /></td>
                  <td style={{ ...cell, width: 110 }}><input type="number" min={0} step="any" style={inputStyle} value={l.rate} onChange={(e) => set(l.key, { rate: Number(e.target.value) })} /></td>
                  <td style={{ ...cell, width: 95 }}><input type="number" min={0} step="any" style={inputStyle} value={l.discount_amount || 0} onChange={(e) => set(l.key, { discount_amount: Number(e.target.value) })} /></td>
                  <td style={{ ...cell, width: 85 }}>
                    <select style={inputStyle} value={String(l.gst_rate)} onChange={(e) => set(l.key, { gst_rate: Number(e.target.value) })}>
                      {active.map((r) => <option key={r.id} value={String(r.rate)}>{r.rate}%</option>)}
                    </select>
                  </td>
                  <td style={{ ...cell, minWidth: 220 }}>
                    <SearchableSelect value={l.gl_account_id ? String(l.gl_account_id) : ''} onChange={(v: string) => set(l.key, { gl_account_id: v ? Number(v) : null })}
                      options={[{ value: '', label: 'Default ledger' }, ...ledgerOptions(ledgers)]} placeholder="Default ledger" />
                  </td>
                  {costObjects && (
                    <>
                      <td style={{ ...cell, minWidth: 180 }}>
                        <SearchableSelect value={l.cost_center_id ? String(l.cost_center_id) : ''} onChange={(v: string) => set(l.key, { cost_center_id: v ? Number(v) : null })}
                          options={ccOpts}
                          placeholder={ledgers.find((a) => a.id === l.gl_account_id)?.cost_object_required && !l.internal_order_id ? 'Required' : 'Optional'} />
                      </td>
                      <td style={{ ...cell, minWidth: 180 }}>
                        <SearchableSelect value={l.internal_order_id ? String(l.internal_order_id) : ''} onChange={(v: string) => set(l.key, { internal_order_id: v ? Number(v) : null })}
                          options={ioOpts} placeholder="Optional" />
                      </td>
                    </>
                  )}
                  <td style={{ ...cell, width: 110, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12.5, paddingTop: 14 }}>{inr(taxable)}</td>
                  <td style={{ ...cell, width: 30, paddingTop: 12 }}>
                    {lines.length > 1 && <button type="button" style={dangerLinkStyle} onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>✕</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" data-tour="fin-lines-add" style={secondaryBtnStyle} onClick={() => onChange([...lines, newTaxLine()])}>+ Add line</button>
        <div data-tour="fin-lines-totals" style={{ fontSize: 12.5, color: TEXT.body, minWidth: 260 }}>
          <TotalRow label="Taxable value" value={totals.taxable} />
          {interstate === null ? (
            <div style={{ color: TEXT.muted, fontSize: 12 }}>Pick the party to see CGST/SGST vs IGST.</div>
          ) : interstate ? (
            <TotalRow label="IGST" value={totals.igst} />
          ) : (
            <><TotalRow label="CGST" value={totals.cgst} /><TotalRow label="SGST" value={totals.sgst} /></>
          )}
          <TotalRow label="Invoice value (before round-off)" value={totals.total} bold />
        </div>
      </div>
    </div>
  )
}

function TotalRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '2px 0', fontWeight: bold ? 800 : 500 }}>
      <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{inr(value)}</span>
    </div>
  )
}

/** Strip the editor-only key and blank optional fields before sending. */
export function toLinePayload(lines: EditableTaxLine[]) {
  return lines.map(({ key, ...l }) => ({ // eslint-disable-line @typescript-eslint/no-unused-vars
    ...l,
    description: (l.description || '').trim(),
    hsn_sac_code: (l.hsn_sac_code || '').trim() || null,
    uom: (l.uom || '').trim() || null,
    gl_account_id: l.gl_account_id || null,
    discount_amount: Number(l.discount_amount || 0),
  }))
}
