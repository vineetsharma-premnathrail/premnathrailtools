'use client'

// Delivery Schedule tab of a confirmed order: one row per vehicle with its
// RRV build (link / unlink), production stage, contractual vs current date,
// accrued and forecast LD; plus DP-extension requests and their decisions.

import Select from '@/components/shared/Select'
import { useCallback, useEffect, useState } from 'react'
import { SalesOrder, SalesExtension, SalesOrderSchedule } from '@/types'
import { salesApi } from '@/lib/api'
import { TEXT } from '@/lib/theme'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { secondaryBtnStyle, smallSecondaryBtnStyle, RowCount } from '@/components/shared/ui'
import { sectionStyle, h2Style, thStyle, tdStyle, Pill, ErrorBanner } from '@/components/sales/SalesUi'
import ReasonSheet from '@/components/shared/ReasonSheet'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, Req, Optional, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { ROW_STATUS_LABELS, ROW_STATUS_HEX, EXTENSION_REASON_LABELS, formatINR } from '@/components/sales/labels'
import { recordPath } from '@/lib/recordRef'
import DeliveryConfirmPanel from '@/components/sales/DeliveryConfirmPanel'

type Build = { id: number; build_number: string; rrv_model: string; status: string }
const smallBtn: React.CSSProperties = { ...smallSecondaryBtnStyle }

export default function DeliveryPanel({ order, onChange }: { order: SalesOrder; onChange: (o: SalesOrder) => void }) {
  const [error, setError] = useState<string | string[]>('')
  const [builds, setBuilds] = useState<Build[]>([])
  const [linkFor, setLinkFor] = useState<number | null>(null)
  const [pickBuild, setPickBuild] = useState('')
  const [unlinkFor, setUnlinkFor] = useState<SalesOrderSchedule | null>(null)
  const [exts, setExts] = useState<SalesExtension[]>([])
  const [extForm, setExtForm] = useState<{ ids: number[]; date: string; cat: string; reason: string; letter: string } | null>(null)
  const [grantFor, setGrantFor] = useState<SalesExtension | null>(null)
  const [grant, setGrant] = useState({ date: '', withLd: false, letter: '', letterDate: '' })
  const [refuseFor, setRefuseFor] = useState<SalesExtension | null>(null)
  const [busy, setBusy] = useState(false)
  // Error of the open popup (link build / DP extension request / grant) — shown inside it.
  const [sheetError, setSheetError] = useState<string | string[]>('')
  const sheetOpen = linkFor !== null || !!extForm || !!grantFor
  const closeSheets = () => { setLinkFor(null); setExtForm(null); setGrantFor(null); setSheetError('') }
  useEscapeKey(sheetOpen && !busy, closeSheets)

  const loadExt = useCallback(() => { salesApi.listExtensions(order.id).then(setExts).catch(() => setExts([])) }, [order.id])
  useEffect(() => { loadExt() }, [loadExt])
  useEffect(() => { if (order.can.link_build) salesApi.lookupBuilds().then(setBuilds).catch(() => setBuilds([])) }, [order.can.link_build, order.id])

  async function run(fn: () => Promise<unknown>, inSheet = false) {
    setBusy(true); setError(''); setSheetError('')
    try {
      const res = await fn()
      if (res && typeof res === 'object' && 'display_number' in (res as object)) onChange(res as SalesOrder)
      else onChange(await salesApi.getOrder(order.id))
      loadExt()
      if (order.can.link_build) salesApi.lookupBuilds().then(setBuilds).catch(() => undefined)
      if (inSheet) closeSheets()
    } catch (err) { (inSheet ? setSheetError : setError)(extractErrorMessages(err, 'The delivery action failed.')) } finally { setBusy(false) }
  }

  const rows = order.schedules.filter((r) => r.status !== 'cancelled')
  const cancelled = order.schedules.filter((r) => r.status === 'cancelled')
  const linkRow = linkFor !== null ? rows.find((r) => r.id === linkFor) : undefined
  const lineType = (r: SalesOrderSchedule) => order.lines.find((l) => l.id === r.so_line_id)?.line_type

  return (
    <div>
      <ErrorBanner error={error} />
      <div data-tour="sales-detail-schedule" style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 style={{ ...h2Style, margin: 0 }}>Vehicles / lots</h2>
          <div style={{ fontSize: 13, color: TEXT.secondary }}>LD accrued <b>{formatINR(order.ld_accrued)}</b> · forecast <b>{formatINR(order.ld_forecast)}</b></div>
        </div>
        <div style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
            <thead><tr>{['Vehicle', 'Consignee', 'Contract date', 'Current date', 'Committed', 'Build', 'Stage', 'Status', 'Risk', 'LD accrued', 'LD forecast', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={rows.length} />}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600 }}>L{r.line_number} / {r.sequence}{r.quantity !== 1 ? ` (${r.quantity})` : ''}</td>
                  <td style={tdStyle}>{r.consignee_name || '—'}{r.consignee_contact_name ? <div style={{ fontSize: 11.5, color: TEXT.muted }}>{r.consignee_contact_name} {r.consignee_contact_phone}</div> : null}</td>
                  <td style={tdStyle}>{formatDate(r.contract_delivery_date)}</td>
                  <td style={{ ...tdStyle, fontWeight: r.current_delivery_date !== r.contract_delivery_date ? 700 : 400 }}>{formatDate(r.current_delivery_date)}{r.ld_waived ? <div style={{ fontSize: 11, color: '#16A34A' }}>LD waived</div> : null}</td>
                  <td style={tdStyle}>{formatDate(r.committed_date)}</td>
                  <td style={tdStyle}>
                    {r.build_number ? <a href={recordPath('/dashboard/production/rrv-builds', r, 'rrv_build_id')} style={{ color: '#FF6A2A', fontWeight: 600 }}>{r.build_number}</a>
                      : lineType(r) === 'rrv' && order.can.link_build ? (
                        <button data-tour="sales-link-build" style={smallBtn} onClick={() => { setSheetError(''); setLinkFor(r.id); setPickBuild('') }}>Link build</button>
                      ) : <span style={{ color: TEXT.muted }}>—</span>}
                  </td>
                  <td style={tdStyle}>{r.build_stage || '—'}</td>
                  <td style={tdStyle}><Pill label={ROW_STATUS_LABELS[r.status] || r.status} hex={ROW_STATUS_HEX[r.status] || '#78716c'} /></td>
                  <td style={tdStyle}>{r.risk ? <Pill label={r.risk === 'overdue' ? 'Overdue' : 'At risk'} hex={r.risk === 'overdue' ? '#DC2626' : '#F59E0B'} /> : '—'}</td>
                  <td style={tdStyle}>{r.ld_amount ? `${formatINR(r.ld_amount)} (${r.ld_weeks})` : '—'}</td>
                  <td style={tdStyle}>{r.ld_forecast_amount ? `${formatINR(r.ld_forecast_amount)} (${r.ld_forecast_periods})` : '—'}</td>
                  <td style={tdStyle}>{r.build_number && order.can.link_build && r.build_status === 'planned' && <button style={smallBtn} onClick={() => setUnlinkFor(r)}>Unlink</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cancelled.length > 0 && <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>{cancelled.length} cancelled row(s) are kept for history.</p>}
        <p style={{ fontSize: 12, color: TEXT.muted, margin: '8px 0 0' }}>
          LD is computed per vehicle (rate × weeks late, &quot;or part thereof&quot;, capped) — shown, never posted. The committed date comes from the build&apos;s target handover date.
        </p>
      </div>

      <DeliveryConfirmPanel order={order} onChange={onChange} />

      <div data-tour="sales-detail-extensions" style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 style={{ ...h2Style, margin: 0 }}>Delivery-period (DP) extensions</h2>
          {order.can.request_extension && (
            <button style={secondaryBtnStyle} onClick={() => { setSheetError(''); setExtForm({ ids: [], date: '', cat: 'customer_cause', reason: '', letter: '' }) }}>+ Request DP extension</button>
          )}
        </div>
        {extForm && (
          <FormSheet tour="sales-ext-request-form" width={580} icon="calendar" title="Request DP Extension" subtitle={`${order.display_number} — record the extension asked of the customer`}
            onClose={closeSheets} busy={busy}
            footer={<>
              <button type="button" onClick={closeSheets} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
              <button type="button" disabled={busy} style={sheetBtn('primary', SHEET.BLUE, busy)}
                onClick={() => { const f = extForm; run(() => salesApi.requestExtension(order.id, { schedule_ids: f.ids, requested_new_date: f.date || null, reason_category: f.cat, reason: f.reason, customer_letter_ref: f.letter || null }), true) }}>
                <SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Record request'}
              </button>
            </>}>
            <div style={{ padding: '20px 24px' }}>
              <ErrorBanner error={sheetError} />
              <SheetSection icon="truck" title="Vehicles">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rows.filter((r) => ['open', 'build_planned', 'in_production', 'ready', 'dispatched'].includes(r.status)).map((r) => (
                    <label key={r.id} style={{ fontSize: 13, color: SHEET.BODY, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                      <input type="checkbox" checked={extForm.ids.includes(r.id)} onChange={(e) => setExtForm({ ...extForm, ids: e.target.checked ? [...extForm.ids, r.id] : extForm.ids.filter((x) => x !== r.id) })} />
                      L{r.line_number}/{r.sequence} (due {formatDate(r.current_delivery_date)})
                    </label>
                  ))}
                </div>
              </SheetSection>
              <SheetSection icon="calendar" title="Request">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '0 1 170px', minWidth: 150 }}><label style={sheetLabel}>New date requested</label><DateField value={extForm.date} onChange={(v) => setExtForm({ ...extForm, date: v })} /></div>
                  <div style={{ flex: '1 1 240px', minWidth: 200, maxWidth: 320 }}><label style={sheetLabel}>Reason category</label>
                    <Select style={sheetInput} value={extForm.cat} onChange={(e) => setExtForm({ ...extForm, cat: e.target.value })}>
                      {Object.entries(EXTENSION_REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select></div>
                </div>
                <label style={{ ...sheetLabel, marginTop: 14 }}>Reason</label>
                <textarea style={{ ...sheetInput, minHeight: 64, resize: 'vertical' }} value={extForm.reason} onChange={(e) => setExtForm({ ...extForm, reason: e.target.value })} />
                <div style={{ maxWidth: 240, marginTop: 14 }}><label style={sheetLabel}>Our letter ref. <Optional /></label><input style={sheetInput} value={extForm.letter} onChange={(e) => setExtForm({ ...extForm, letter: e.target.value })} /></div>
              </SheetSection>
            </div>
          </FormSheet>
        )}
        {exts.length === 0 ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>No DP extensions on this order.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Vehicles', 'Requested', 'Reason', 'Status', 'Granted', ''].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={exts.length} />}</th>)}</tr></thead>
              <tbody>
                {exts.map((e) => (
                  <tr key={e.id}>
                    <td style={tdStyle}>{e.vehicles.join(', ')}</td>
                    <td style={tdStyle}>{formatDate(e.requested_new_date)}</td>
                    <td style={tdStyle}>{EXTENSION_REASON_LABELS[e.reason_category]}: {e.reason}</td>
                    <td style={tdStyle}><Pill label={e.status_label || e.status} hex={e.status === 'granted' ? '#16A34A' : e.status_label === 'Closed (order ended)' ? '#78716c' : e.status === 'refused' ? '#DC2626' : '#F59E0B'} /></td>
                    <td style={tdStyle}>{e.granted_new_date ? `${formatDate(e.granted_new_date)} ${e.with_ld ? 'with LD' : 'without LD'} · ${e.customer_letter_ref || ''}` : e.decision_remarks || '—'}</td>
                    <td style={tdStyle}>
                      {e.status === 'requested' && order.can.decide_extension && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={smallBtn} onClick={() => { setSheetError(''); setGrantFor(e); setGrant({ date: e.requested_new_date, withLd: false, letter: '', letterDate: '' }) }}>Granted</button>
                          <button style={{ ...smallBtn, color: '#DC2626' }} onClick={() => setRefuseFor(e)}>Refused</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {grantFor && (
          <FormSheet tour="sales-ext-grant-form" width={580} icon="check" iconColor="#16A34A" title="Customer Granted the Extension" subtitle={`Vehicles ${grantFor.vehicles.join(', ')} — record the customer's grant letter`}
            onClose={closeSheets} busy={busy}
            footer={<>
              <button type="button" onClick={closeSheets} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
              <button type="button" disabled={busy} style={sheetBtn('primary', '#16A34A', busy)}
                onClick={() => { const e = grantFor; run(() => salesApi.extensionAction(e.id, 'grant', { granted_new_date: grant.date, with_ld: grant.withLd, customer_letter_ref: grant.letter, customer_letter_date: grant.letterDate || null }), true) }}>
                <SheetIcon name="check" size={16} />{busy ? 'Saving…' : 'Save grant'}
              </button>
            </>}>
            <div style={{ padding: '20px 24px' }}>
              <ErrorBanner error={sheetError} />
              <SheetSection icon="calendar" title="Grant">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '0 1 170px', minWidth: 150 }}><label style={sheetLabel}>Granted date</label><DateField value={grant.date} onChange={(v) => setGrant({ ...grant, date: v })} /></div>
                </div>
                <label style={{ fontSize: 13, color: SHEET.BODY, display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={grant.withLd} onChange={(e) => setGrant({ ...grant, withLd: e.target.checked })} /> Granted with LD
                </label>
              </SheetSection>
              <SheetSection icon="doc" title="Customer letter">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 180, maxWidth: 300 }}><label style={sheetLabel}>Customer letter ref. <Req /></label><input style={sheetInput} value={grant.letter} onChange={(e) => setGrant({ ...grant, letter: e.target.value })} /></div>
                  <div style={{ flex: '0 1 170px', minWidth: 150 }}><label style={sheetLabel}>Letter date</label><DateField value={grant.letterDate} onChange={(v) => setGrant({ ...grant, letterDate: v })} /></div>
                </div>
              </SheetSection>
            </div>
          </FormSheet>
        )}
      </div>

      {linkFor !== null && (
        <FormSheet tour="sales-link-build-form" width={580} icon="link" title="Link RRV Build" subtitle={linkRow ? `Vehicle L${linkRow.line_number} / ${linkRow.sequence}${linkRow.consignee_name ? ` · ${linkRow.consignee_name}` : ''}` : order.display_number}
          onClose={closeSheets} busy={busy}
          footer={<>
            <button type="button" onClick={closeSheets} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" disabled={!pickBuild || busy} style={sheetBtn('primary', SHEET.BLUE, !pickBuild || busy)}
              onClick={() => { const rid = linkFor; const bid = Number(pickBuild); run(() => salesApi.linkBuild(rid, bid), true) }}>
              <SheetIcon name="link" size={16} />{busy ? 'Saving…' : 'Link'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            <ErrorBanner error={sheetError} />
            <SheetSection icon="tool" title="Build">
              <label style={sheetLabel}>RRV build <Req /></label>
              <SearchableSelect value={pickBuild} onChange={setPickBuild} placeholder="Pick a build…"
                options={builds.map((b) => ({ value: String(b.id), label: `${b.build_number} · ${b.rrv_model} · ${b.status}` }))} />
              <p style={sheetHint}>The vehicle&apos;s committed date then follows the build&apos;s target handover date.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      <ConfirmDialog open={!!unlinkFor} title={`Unlink ${unlinkFor?.build_number ?? ''}?`} danger
        message="The build stays in Production as a planned build without an order. Only builds that haven't started can be unlinked."
        confirmLabel="Unlink" onCancel={() => setUnlinkFor(null)}
        onConfirm={() => { const r = unlinkFor; setUnlinkFor(null); if (r) run(() => salesApi.unlinkBuild(r.id)) }} />
      <ReasonSheet open={!!refuseFor} title="Customer refused the extension" message="Quote the customer's reply." requireValue confirmLabel="Record refusal" label="Customer's reply"
        onCancel={() => setRefuseFor(null)}
        onConfirm={(reason) => { const e = refuseFor; setRefuseFor(null); if (e) run(() => salesApi.extensionAction(e.id, 'refuse', { reason })) }} />
    </div>
  )
}
