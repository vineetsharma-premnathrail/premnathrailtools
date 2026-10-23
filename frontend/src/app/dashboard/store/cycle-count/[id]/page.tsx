'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { useAssigneeFilter } from '@/hooks/useAssigneeFilter'
import { useCan } from '@/lib/permissions'
import { physicalCountsApi, storeApi, usersApi } from '@/lib/api'
import { DirectoryUser, StoreItem, StorePhysicalCount } from '@/types'
import { BORDER, DANGER, SUCCESS } from '@/lib/theme'
import StoreNav from '@/components/store/StoreNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import PromptDialog from '@/components/erp/PromptDialog'
import MessageDialog from '@/components/erp/MessageDialog'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import { FormPage, SheetSection, SheetIcon, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { formatDate } from '@/lib/format'
import { extractErrorMessages } from '@/lib/validation'
import { useRecordId, recordPath } from '@/lib/recordRef'

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', color: SHEET.MUTED, borderBottom: `1px solid ${BORDER.normal}` }
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: SHEET.INK, borderBottom: `1px solid ${BORDER.normal}` }

const STATUS_LABELS: Record<string, string> = { counting: 'Counting — stock frozen', submitted: 'Awaiting Store Manager approval', posted: 'Posted', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { counting: '#d97706', submitted: '#2563eb', posted: '#16a34a', cancelled: '#94a3b8' }

export default function PhysicalCountDetailPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('store')
  const { canFeature } = useCan()
  // Store › Adjustments › Physical / cycle count: edit = enter counts / add
  // items, submit, cancel (each inherits Adjustments › Create).
  const canEditCount = canFeature('store', 'adjustments', 'cycle_count', 'edit')
  const canSubmit = canFeature('store', 'adjustments', 'cycle_count', 'submit')
  const canCancel = canFeature('store', 'adjustments', 'cycle_count', 'cancel')
  const canWork = canEditCount || canSubmit
  // The role's assign-to rule for the approver (Role & Permissions › Store › Adjustments › Physical / cycle count).
  const allowApprover = useAssigneeFilter('store:adjustments.cycle_count')
  const router = useRouter()
  const params = useParams()
  const { id: countId, error: linkError } = useRecordId(params.id as string)

  const [count, setCount] = useState<StorePhysicalCount | null>(null)
  const [entries, setEntries] = useState<Record<number, { qty: string; remarks: string }>>({})
  const [items, setItems] = useState<StoreItem[]>([])
  const [addItemId, setAddItemId] = useState('')
  const [directory, setDirectory] = useState<DirectoryUser[]>([])
  const [approverId, setApproverId] = useState('')
  const [reason, setReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  const [notice, setNotice] = useState('')

  const apply = (c: StorePhysicalCount) => {
    setCount(c)
    setEntries(Object.fromEntries(c.items.map((l) => [l.id, { qty: l.counted_quantity != null ? String(l.counted_quantity) : '', remarks: l.remarks || '' }])))
  }
  useEffect(() => {
    if (!isAuthorized || !countId) return
    physicalCountsApi.get(countId).then(apply).catch((err) => setError(extractErrorMessages(err, 'Could not open this count.')))
  }, [isAuthorized, countId])
  useEffect(() => {
    if (!isAuthorized || count?.status !== 'counting' || !canWork) return
    if (!items.length) storeApi.listItems({ status: 'active' }).then(setItems).catch(() => setItems([]))
    if (!directory.length) usersApi.directory().then(setDirectory).catch(() => setDirectory([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, count?.status, canWork])

  const run = async (fn: () => Promise<StorePhysicalCount>, done?: string) => {
    setError('')
    setBusy(true)
    try {
      apply(await fn())
      if (done) setNotice(done)
    } catch (err) {
      setError(extractErrorMessages(err, 'Action failed.'))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><StoreNav /><InvalidRecordLink message={linkError} listHref="/dashboard/store/cycle-count" listLabel="Back to physical counts" /></div>)
  if (!count) return (<div><StoreNav /><MessageDialog open={!!error} variant="error" title="Physical Count" message={error} onClose={() => setError('')} /></div>)

  const counting = count.status === 'counting'
  const editable = counting && canEditCount
  const changed = count.items.filter((l) => {
    const e = entries[l.id]
    return e && e.qty !== '' && (Number(e.qty) !== l.counted_quantity || (e.remarks || '') !== (l.remarks || ''))
  })
  const save = () => {
    const bad = changed.find((l) => !(Number(entries[l.id].qty) >= 0))
    if (bad) { setError(`'${bad.item_name}': enter a quantity of 0 or more.`); return }
    run(() => physicalCountsApi.enterCounts(count.id, changed.map((l) => ({ line_id: l.id, counted_quantity: Number(entries[l.id].qty), remarks: entries[l.id].remarks.trim() || undefined }))), 'Counts saved.')
  }
  const submit = () => {
    if (changed.length) { setError('Save the counts you entered first.'); return }
    // No approver needed when nothing differs — the server closes the count; otherwise it names who is missing.
    run(() => physicalCountsApi.submit(count.id, { approver_id: Number(approverId) || 0, reason: reason.trim() || undefined }),
      'Count submitted. If there were differences, the Store Manager approves them before stock changes.')
  }

  return (
    <FormPage nav={<StoreNav />} icon="list" title={count.count_number}
      subtitle={`Physical Count · ${count.location_name} · ${formatDate(count.count_date)}`}
      onBack={() => router.push('/dashboard/store/cycle-count')} backTour="store-count-back-btn"
      footer={counting && (canEditCount || canSubmit || canCancel) ? <>
        {canCancel && <button data-tour="store-count-cancel-btn" type="button" onClick={() => setCancelling(true)} disabled={busy} style={{ ...sheetBtn('secondary', SHEET.INK, busy), color: DANGER.text }}><SheetIcon name="x" size={15} />Cancel count</button>}
        {canEditCount && <button data-tour="store-count-save-btn" type="button" disabled={busy || !changed.length} onClick={save} style={sheetBtn('secondary', SHEET.INK, busy || !changed.length)}><SheetIcon name="check" size={15} />{busy ? 'Saving…' : 'Save counts'}</button>}
        {canSubmit && <button type="button" disabled={busy} onClick={submit} style={sheetBtn('primary', SHEET.BLUE, busy)}><SheetIcon name="send" size={16} />{busy ? 'Saving…' : 'Submit count'}</button>}
      </> : <span style={{ fontSize: 12.5, color: SHEET.MUTED, alignSelf: 'center' }}>{STATUS_LABELS[count.status] || count.status}</span>}>
      <MessageDialog open={!!error} variant="error" title="Physical Count" message={error} onClose={() => setError('')} />
      <MessageDialog open={!!notice} variant="success" title="Done" message={notice} onClose={() => setNotice('')} />
      <PromptDialog open={cancelling} title={`Cancel ${count.count_number}?`} message="Nothing is posted and the frozen items can move again."
        placeholder="Why is it being cancelled?" confirmLabel="Cancel count" danger requireValue
        onConfirm={(v) => { setCancelling(false); run(() => physicalCountsApi.cancel(count.id, v), 'Count cancelled.') }} onCancel={() => setCancelling(false)} />

      <div style={{ padding: '20px 24px' }}>
        <SheetSection icon="building" title="Count Details" extra={<span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[count.status]}1a`, color: STATUS_HEX[count.status] }}>{STATUS_LABELS[count.status]}</span>}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, fontSize: 13, color: SHEET.BODY }}>
            <div><span style={{ color: SHEET.MUTED }}>Store: </span><strong>{count.location_name}</strong></div>
            <div><span style={{ color: SHEET.MUTED }}>Date: </span><strong>{formatDate(count.count_date)}</strong></div>
            <div><span style={{ color: SHEET.MUTED }}>Scope: </span><strong>{count.scope || '—'}</strong></div>
            <div><span style={{ color: SHEET.MUTED }}>Counted: </span><strong>{count.lines_counted}/{count.lines_total}</strong></div>
            {count.lines_with_difference != null && <div><span style={{ color: SHEET.MUTED }}>With difference: </span><strong>{count.lines_with_difference}</strong></div>}
            {count.adjustment_number && (
              <div><span style={{ color: SHEET.MUTED }}>Adjustment: </span>
                <a href={recordPath('/dashboard/store/adjustments', { id: count.adjustment_id })} style={{ fontWeight: 700, color: '#2563eb' }}>{count.adjustment_number}</a> ({count.adjustment_status})
              </div>
            )}
            {count.cancel_reason && <div><span style={{ color: SHEET.MUTED }}>Cancelled: </span>{count.cancel_reason}</div>}
          </div>
          {counting && (
            <p style={{ fontSize: 12.5, color: '#b45309', margin: '12px 0 0' }}>
              These items can&apos;t be received, issued or transferred at {count.location_name} until this count is submitted or cancelled.
              {count.book_hidden ? ' Blind count — book stock is hidden; count what is physically there, and enter 0 for anything not found.' : ''}
            </p>
          )}
        </SheetSection>

        <div data-tour="store-count-lines">
          <SheetSection icon="box" title="Count Lines">
            <div style={{ overflow: 'auto', border: `1px solid ${SHEET.LINE}`, borderRadius: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                <thead><tr style={{ background: SHEET.SOFT }}>
                  {['Item', 'UOM', 'Book', 'Counted', 'First count', 'Difference', 'Remarks'].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {count.items.map((l) => (
                    <tr key={l.id}>
                      <td style={td}><strong>{l.item_code}</strong> — {l.item_name}</td>
                      <td style={td}>{l.uom || '—'}</td>
                      <td style={td}>{l.book_quantity ?? <span style={{ color: SHEET.MUTED }}>hidden</span>}</td>
                      <td style={td}>
                        {editable ? (
                          <input type="number" min={0} step="any" value={entries[l.id]?.qty ?? ''} style={{ ...sheetInput, width: 100, padding: '7px 10px' }}
                            onChange={(e) => setEntries((s) => ({ ...s, [l.id]: { ...s[l.id], qty: e.target.value } }))} />
                        ) : (l.counted_quantity ?? '—')}
                      </td>
                      <td style={td}>{l.count_rounds > 1 ? l.first_counted_quantity : '—'}</td>
                      <td style={{ ...td, fontWeight: 700, color: l.difference ? (l.difference > 0 ? SUCCESS.text : DANGER.text) : SHEET.MUTED }}>
                        {l.difference == null ? '—' : l.difference > 0 ? `+${l.difference}` : l.difference}
                      </td>
                      <td style={td}>
                        {editable ? (
                          <input value={entries[l.id]?.remarks ?? ''} style={{ ...sheetInput, width: 180, padding: '7px 10px' }} placeholder="e.g. 2 pcs damaged"
                            onChange={(e) => setEntries((s) => ({ ...s, [l.id]: { ...s[l.id], remarks: e.target.value } }))} />
                        ) : (l.remarks || '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editable && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
                <div style={{ flex: '0 1 340px', minWidth: 240 }}>
                  <SearchableSelect value={addItemId} onChange={setAddItemId} placeholder="Found something not on the list? Add item…"
                    options={items.filter((i) => !count.items.some((l) => l.item_id === i.id)).map((i) => ({ value: String(i.id), label: `${i.item_code} — ${i.item_name}` }))} />
                </div>
                <button type="button" disabled={!addItemId || busy} onClick={() => { run(() => physicalCountsApi.addItem(count.id, Number(addItemId))); setAddItemId('') }} style={sheetBtn('secondary', SHEET.INK, !addItemId || busy)}><SheetIcon name="plus" size={15} />Add to count</button>
              </div>
            )}
          </SheetSection>
        </div>

        {counting && canSubmit && (
          <div data-tour="store-count-submit">
            <SheetSection icon="shield" title="Submit Count">
              <p style={{ fontSize: 12.5, color: SHEET.MUTED, margin: '0 0 12px' }}>
                Every line must be counted. Differences become one Stock Adjustment that a Store Manager (not you) approves; stock changes only on approval. With no difference the count closes at once.
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 1 340px', minWidth: 240 }}>
                  <label style={sheetLabel}>Store Manager to approve differences</label>
                  <SearchableSelect value={approverId} onChange={setApproverId} placeholder="Search name or email…"
                    options={directory.filter((u) => u.id !== user?.id && allowApprover(u.id)).map((u) => ({ value: String(u.id), label: `${u.name} — ${u.email}` }))} />
                </div>
                <div style={{ flex: '1 1 240px', maxWidth: 380 }}>
                  <label style={sheetLabel}>Reason</label>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} style={sheetInput} placeholder="e.g. Year-end physical count" />
                </div>
              </div>
              <p style={sheetHint}>Save the counts first, then submit with the footer button.</p>
            </SheetSection>
          </div>
        )}
      </div>
    </FormPage>
  )
}
