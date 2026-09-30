'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { hrApi, usersApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { HrVisitor, HrVisitorBoard, HrBranchLookup, DirectoryUser } from '@/types'
import HrNav from '@/components/hr/HrNav'
import MyHrTabs from '@/components/hr/MyHrTabs'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import PromptDialog from '@/components/erp/PromptDialog'
import { secondaryBtnStyle } from '@/components/shared/ui'
import { RegisterVisitorDialog, CheckInDialog } from '@/components/hr/admin/VisitorDialogs'
import {
  PageHeader, ErrorBanner, SuccessBanner, Pill, EmptyRow, primaryActionStyle, filterInputStyle, sectionStyle,
  tableWrapStyle, thStyle, tdStyle, linkActionStyle, fmtDateTime, fmtTime, todayIso, fmtDate,
} from '@/components/hr/admin/adminUi'
import { TEXT, BORDER } from '@/lib/theme'

const STATUS_LABELS: Record<string, string> = { expected: 'Expected', checked_in: 'Inside', checked_out: 'Checked Out', cancelled: 'Cancelled' }
const STATUS_HEX: Record<string, string> = { expected: '#F59E0B', checked_in: '#16A34A', checked_out: '#64748B', cancelled: '#DC2626' }

type PendingAction = { kind: 'cancel' | 'checkout'; visitor: HrVisitor }

function VisitorCard({ v, actions }: { v: HrVisitor; actions?: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.75)', border: `1px solid ${BORDER.light}`, borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: TEXT.heading }}>{v.visitor_name}{v.number_of_persons > 1 ? ` +${v.number_of_persons - 1}` : ''}</span>
        {v.badge_no && <span style={{ fontSize: 11, fontWeight: 700, color: '#2563EB' }}>Badge {v.badge_no}</span>}
      </div>
      {v.visitor_company && <span style={{ fontSize: 12, color: TEXT.muted }}>{v.visitor_company}</span>}
      <span style={{ fontSize: 12, color: TEXT.body }}>Meeting <b>{v.host_name || '—'}</b>{v.host_department ? ` · ${v.host_department}` : ''}</span>
      {v.purpose && <span style={{ fontSize: 12, color: TEXT.muted }}>{v.purpose}</span>}
      <span style={{ fontSize: 11.5, color: TEXT.muted }}>
        {v.status === 'expected' && (v.expected_at ? `Expected ${fmtTime(v.expected_at)}` : 'Time not given')}
        {v.status === 'checked_in' && `In since ${fmtDate(v.check_in_at) !== fmtDate(new Date().toISOString()) ? fmtDateTime(v.check_in_at) : fmtTime(v.check_in_at)}`}
        {v.status === 'checked_out' && `${fmtTime(v.check_in_at)} → ${fmtTime(v.check_out_at)}`}
        {v.vehicle_no ? ` · ${v.vehicle_no}` : ''}
        {v.branch_name ? ` · ${v.branch_name}` : ''}
        {' · '}{v.visit_no}
      </span>
      {actions && <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>{actions}</div>}
    </div>
  )
}

function BoardColumn({ title, hex, rows, render }: { title: string; hex: string; rows: HrVisitor[]; render: (v: HrVisitor) => React.ReactNode }) {
  return (
    <div style={{ ...sectionStyle, flex: '1 1 300px', marginBottom: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: hex }}>{title}</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: hex }}>{rows.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
        {rows.length === 0 ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>None.</p> : rows.map(render)}
      </div>
    </div>
  )
}

export default function HrVisitorsPage() {
  // Reception (hr app) runs the full board; any other employee sees the
  // visitors they host and can pre-register their own.
  const { user, isLoading } = useAuth()
  const isHr = !!user?.apps?.includes('hr')

  const [tab, setTab] = useState<'board' | 'history'>('board')
  const [error, setError] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [branches, setBranches] = useState<HrBranchLookup[]>([])
  const [people, setPeople] = useState<DirectoryUser[]>([])
  const [registerOpen, setRegisterOpen] = useState(false)
  const [checkInFor, setCheckInFor] = useState<HrVisitor | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)

  // board
  const [boardDate, setBoardDate] = useState(todayIso())
  const [boardBranch, setBoardBranch] = useState('')
  const [board, setBoard] = useState<HrVisitorBoard | null>(null)
  const [boardLoading, setBoardLoading] = useState(true)

  // history / mine
  const [rows, setRows] = useState<HrVisitor[]>([])
  const [rowsLoading, setRowsLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusF, setStatusF] = useState('')
  const [hostF, setHostF] = useState('')
  const [branchF, setBranchF] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!user) return
    hrApi.branchLookup().then(setBranches).catch(() => setBranches([]))
    if (isHr) usersApi.directory().then(setPeople).catch(() => setPeople([]))
  }, [user, isHr])

  const loadBoard = useCallback(() => {
    if (!isHr) return
    setBoardLoading(true)
    const params: Record<string, unknown> = { date: boardDate || todayIso() }
    if (boardBranch) params.branch_id = Number(boardBranch)
    hrApi.visitorBoard(params)
      .then((b) => { setBoard(b); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'The visitor board could not be loaded.')))
      .finally(() => setBoardLoading(false))
  }, [isHr, boardDate, boardBranch])

  const loadRows = useCallback(() => {
    if (!user) return
    setRowsLoading(true)
    const params: Record<string, unknown> = {}
    if (statusF) params.status = statusF
    const req = isHr
      ? hrApi.listVisitors({
        ...params,
        ...(dateFrom ? { date_from: dateFrom } : {}), ...(dateTo ? { date_to: dateTo } : {}),
        ...(hostF ? { host_user_id: Number(hostF) } : {}), ...(branchF ? { branch_id: Number(branchF) } : {}),
        ...(debounced.trim() ? { search: debounced.trim() } : {}),
      })
      : hrApi.myVisitors(params)
    req
      .then((r) => { setRows(r); setError([]) })
      .catch((err) => setError(extractErrorMessages(err, 'The visitor list could not be loaded.')))
      .finally(() => setRowsLoading(false))
  }, [user, isHr, statusF, dateFrom, dateTo, hostF, branchF, debounced])

  useEffect(() => { if (isHr && tab === 'board') loadBoard() }, [isHr, tab, loadBoard])
  useEffect(() => { if (user && (!isHr || tab === 'history')) loadRows() }, [user, isHr, tab, loadRows])

  const refresh = () => { if (isHr && tab === 'board') loadBoard(); else loadRows() }

  const runPending = async (remarks: string) => {
    if (!pending) return
    const { kind, visitor } = pending
    setPending(null)
    try {
      if (kind === 'cancel') {
        await hrApi.cancelVisitor(visitor.id, { remarks: remarks || null })
        setNotice(`Visit ${visitor.visit_no} by ${visitor.visitor_name} cancelled.`)
      } else {
        await hrApi.checkOutVisitor(visitor.id, { remarks: remarks || null })
        setNotice(`${visitor.visitor_name} checked out.`)
      }
      refresh()
    } catch (err) {
      setError(extractErrorMessages(err, kind === 'cancel' ? 'The visit could not be cancelled.' : 'The visitor could not be checked out.'))
    }
  }

  if (isLoading || !user) return null

  const canCancel = (v: HrVisitor) => v.status === 'expected' && (isHr || v.host_user_id === user.id || v.created_by_id === user.id)

  const tabBtn = (key: 'board' | 'history', label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{
        fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 9999, cursor: 'pointer',
        border: tab === key ? '1px solid #FF6A2A' : '1px solid rgba(0,0,0,0.1)',
        background: tab === key ? 'rgba(255,106,42,0.1)' : 'rgba(255,255,255,0.7)', color: tab === key ? '#e0521a' : '#57534e',
      }}
    >
      {label}
    </button>
  )

  return (
    <div>
      <HrNav />
      {!isHr && <MyHrTabs />}

      <PageHeader
        title={isHr ? 'Visitors' : 'My Visitors'}
        subtitle={isHr ? 'Gate register — who is expected, who is inside right now, and who has left.' : 'Visitors you are hosting. Pre-register them so reception can check them in quickly.'}
        actions={<button type="button" style={primaryActionStyle} onClick={() => setRegisterOpen(true)}>{isHr ? '+ Register Visitor' : '+ Pre-register Visitor'}</button>}
      />

      <ErrorBanner error={error} />
      <SuccessBanner message={notice} />

      {isHr && <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>{tabBtn('board', "Today's board")}{tabBtn('history', 'All visits')}</div>}

      {isHr && tab === 'board' ? (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '0 1 170px' }}><DateField value={boardDate} onChange={setBoardDate} /></div>
            <select style={{ ...filterInputStyle, flex: '0 1 190px' }} value={boardBranch} onChange={(e) => setBoardBranch(e.target.value)}>
              <option value="">All plants</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {boardDate !== todayIso() && <button type="button" style={linkActionStyle} onClick={() => setBoardDate(todayIso())}>Back to today</button>}
            <button type="button" style={{ ...secondaryBtnStyle, marginLeft: 'auto' }} onClick={loadBoard}>{boardLoading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
          {boardLoading && !board ? (
            <div style={sectionStyle}><p style={{ margin: 0, fontSize: 13, color: TEXT.muted }}>Loading…</p></div>
          ) : board ? (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <BoardColumn title="Expected" hex={STATUS_HEX.expected} rows={board.expected} render={(v) => (
                <VisitorCard key={v.id} v={v} actions={<>
                  <button type="button" style={linkActionStyle} onClick={() => setCheckInFor(v)}>Check in</button>
                  <button type="button" style={{ ...linkActionStyle, color: '#DC2626' }} onClick={() => setPending({ kind: 'cancel', visitor: v })}>Cancel</button>
                </>} />
              )} />
              <BoardColumn title="Inside now" hex={STATUS_HEX.checked_in} rows={board.inside} render={(v) => (
                <VisitorCard key={v.id} v={v} actions={<button type="button" style={linkActionStyle} onClick={() => setPending({ kind: 'checkout', visitor: v })}>Check out</button>} />
              )} />
              <BoardColumn title="Checked out" hex={STATUS_HEX.checked_out} rows={board.checked_out} render={(v) => <VisitorCard key={v.id} v={v} />} />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {isHr && (
              <>
                <input style={{ ...filterInputStyle, flex: '1 1 220px', maxWidth: 300 }} placeholder="Search name, company, phone, badge, vehicle…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <div style={{ flex: '0 1 150px' }}><DateField value={dateFrom} onChange={setDateFrom} /></div>
                <span style={{ fontSize: 12, color: TEXT.muted }}>to</span>
                <div style={{ flex: '0 1 150px' }}><DateField value={dateTo} onChange={setDateTo} /></div>
                <div style={{ flex: '0 1 200px', minWidth: 170 }}>
                  <SearchableSelect value={hostF} onChange={setHostF} placeholder="Any host" options={[{ value: '', label: 'Any host' }, ...people.map((p) => ({ value: String(p.id), label: p.name }))]} />
                </div>
                <select style={{ ...filterInputStyle, flex: '0 1 160px' }} value={branchF} onChange={(e) => setBranchF(e.target.value)}>
                  <option value="">All plants</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </>
            )}
            <select style={{ ...filterInputStyle, flex: '0 1 150px' }} value={statusF} onChange={(e) => setStatusF(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {(dateFrom || dateTo || statusF || hostF || branchF || search) && (
              <button type="button" style={linkActionStyle} onClick={() => { setDateFrom(''); setDateTo(''); setStatusF(''); setHostF(''); setBranchF(''); setSearch('') }}>Clear filters</button>
            )}
          </div>
          <div style={tableWrapStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr>{['Visit', 'Visitor', 'Host', 'Purpose', 'Expected', 'In', 'Out', 'Badge / Vehicle', 'Status', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rowsLoading ? <EmptyRow colSpan={10} text="Loading…" /> : rows.length === 0 ? (
                  <EmptyRow colSpan={10} text={isHr ? 'No visits match these filters.' : 'You have no visitors yet. Use “+ Pre-register Visitor” before someone comes to meet you.'} />
                ) : rows.map((v) => (
                  <tr key={v.id}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{v.visit_no}</td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{v.visitor_name}{v.number_of_persons > 1 ? ` +${v.number_of_persons - 1}` : ''}</div>
                      <div style={{ fontSize: 12, color: TEXT.muted }}>{[v.visitor_company, v.visitor_phone].filter(Boolean).join(' · ') || '—'}</div>
                    </td>
                    <td style={tdStyle}>{v.host_name || '—'}</td>
                    <td style={{ ...tdStyle, maxWidth: 220 }}>{v.purpose || '—'}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDateTime(v.expected_at)}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDateTime(v.check_in_at)}</td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{fmtDateTime(v.check_out_at)}</td>
                    <td style={tdStyle}>{[v.badge_no, v.vehicle_no].filter(Boolean).join(' / ') || '—'}</td>
                    <td style={tdStyle}><Pill hex={STATUS_HEX[v.status] || '#64748B'} label={STATUS_LABELS[v.status] || v.status} /></td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        {isHr && v.status === 'expected' && <button type="button" style={linkActionStyle} onClick={() => setCheckInFor(v)}>Check in</button>}
                        {isHr && v.status === 'checked_in' && <button type="button" style={linkActionStyle} onClick={() => setPending({ kind: 'checkout', visitor: v })}>Check out</button>}
                        {canCancel(v) && <button type="button" style={{ ...linkActionStyle, color: '#DC2626' }} onClick={() => setPending({ kind: 'cancel', visitor: v })}>Cancel</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <RegisterVisitorDialog
        open={registerOpen}
        isHr={isHr}
        selfId={user.id}
        people={people}
        branches={branches}
        onClose={() => setRegisterOpen(false)}
        onSaved={(v) => {
          setRegisterOpen(false)
          setNotice(v.status === 'checked_in' ? `${v.visitor_name} checked in (${v.visit_no}). ${v.host_name} has been notified.` : `${v.visitor_name} registered as ${v.visit_no}.`)
          refresh()
        }}
      />
      <CheckInDialog
        visitor={checkInFor}
        onClose={() => setCheckInFor(null)}
        onDone={(v) => { setCheckInFor(null); setNotice(`${v.visitor_name} checked in. ${v.host_name} has been notified.`); refresh() }}
      />
      <PromptDialog
        open={!!pending}
        title={pending?.kind === 'cancel' ? `Cancel visit by ${pending.visitor.visitor_name}?` : `Check out ${pending?.visitor.visitor_name || ''}?`}
        message={pending?.kind === 'cancel' ? 'The host will be told the visit is cancelled. Add a reason (optional).' : 'Records the exit time as now. Collect the badge before they leave.'}
        placeholder={pending?.kind === 'cancel' ? 'Reason (optional)…' : 'Remarks (optional)…'}
        confirmLabel={pending?.kind === 'cancel' ? 'Cancel visit' : 'Check out'}
        cancelLabel="Back"
        danger={pending?.kind === 'cancel'}
        onConfirm={runPending}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
