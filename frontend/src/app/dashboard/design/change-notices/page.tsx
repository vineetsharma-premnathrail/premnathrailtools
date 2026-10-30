'use client'

import { primaryBtnStyle, secondaryBtnStyle, chipBtnStyle, segmentBtnStyle, RowCount, pillStyle } from '@/components/shared/ui'
import Select from '@/components/shared/Select'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignChangeNotice, DesignChangeRequest } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import DesignNav from '@/components/design/DesignNav'
import { useDesignMe } from '@/components/design/useDesignMe'
import { ECN_REASON_LABELS, ECN_STATUS_LABELS, ECR_SOURCE_LABELS, ECR_STATUS_LABELS, ECR_URGENCY_LABELS } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'
import { priorityLabel, priorityTone } from '@/lib/priority'

const ECN_STATUS_HEX: Record<string, string> = { draft: '#78716c', submitted: '#F59E0B', approved: '#2563EB', rejected: '#DC2626', implemented: '#16A34A', closed: '#0f766e', cancelled: '#a8a29e' }
const ECR_STATUS_HEX: Record<string, string> = { open: '#F59E0B', impact_checked: '#7C3AED', approved: '#16A34A', rejected: '#DC2626', deferred: '#78716c', withdrawn: '#a8a29e' }
const URGENCY_HEX: Record<string, string> = { low: '#78716c', normal: '#2563EB', high: '#F59E0B', critical: '#DC2626' }

const ECN_TABS = [
  { key: 'draft,submitted,approved,implemented', label: 'Open' },
  { key: 'approved', label: 'Open — revising' },
  { key: 'implemented', label: 'Released — acknowledging' },
  { key: 'closed', label: 'Closed' },
  { key: 'draft,submitted', label: 'Draft / Awaiting approval' },
  { key: 'rejected,cancelled', label: 'Rejected / Cancelled' },
  { key: '', label: 'All' },
]
const ECR_TABS = [
  { key: 'open,impact_checked', label: 'Undecided' },
  { key: 'open', label: 'Impact check' },
  { key: 'impact_checked', label: 'With change board' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected,deferred,withdrawn', label: 'Rejected / Deferred / Withdrawn' },
  { key: '', label: 'All' },
]

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13, outline: 'none', color: TEXT.body,
}
const cellStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}` }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1 }
const tableWrap: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'auto', maxHeight: 'calc(100vh - 380px)',
}
const bigBtn: React.CSSProperties = primaryBtnStyle

function pill(label: string, hex: string) {
  return <span style={pillStyle(hex)}>{label}</span>
}

function chip(active: boolean, label: string, onClick: () => void, key?: string) {
  return (
    <button key={key ?? label} type="button" onClick={onClick} style={chipBtnStyle(active)}>
      {label}
    </button>
  )
}

export default function DesignChangesPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  const searchParams = useSearchParams()
  const me = useDesignMe(isAuthorized)
  const [section, setSection] = useState<'ecr' | 'ecn'>(searchParams.get('tab') === 'ecn' ? 'ecn' : 'ecr')
  const [error, setError] = useState<string | string[]>('')

  // ECR list
  const [ecrs, setEcrs] = useState<DesignChangeRequest[]>([])
  const [ecrLoading, setEcrLoading] = useState(true)
  const [ecrTab, setEcrTab] = useState(ECR_TABS[0].key)
  const [ecrSource, setEcrSource] = useState('')
  const [mine, setMine] = useState(false)
  const [ecrSearch, setEcrSearch] = useState('')

  // ECN list
  const [ecns, setEcns] = useState<DesignChangeNotice[]>([])
  const [ecnLoading, setEcnLoading] = useState(true)
  const [ecnTab, setEcnTab] = useState(ECN_TABS[0].key)
  const [ecnSearch, setEcnSearch] = useState('')

  useEffect(() => {
    if (!isAuthorized || section !== 'ecr') return
    const params: Record<string, unknown> = {}
    if (ecrTab) params.status = ecrTab
    if (ecrSource) params.source = ecrSource
    if (mine) params.mine = true
    if (ecrSearch.trim()) params.search = ecrSearch.trim()
    const handle = setTimeout(() => {
      setEcrLoading(true)
      designApi.listChangeRequests(params)
        .then((data) => { setEcrs(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load change requests.')))
        .finally(() => setEcrLoading(false))
    }, ecrSearch ? 250 : 0)
    return () => clearTimeout(handle)
  }, [isAuthorized, section, ecrTab, ecrSource, mine, ecrSearch])

  useEffect(() => {
    if (!isAuthorized || section !== 'ecn') return
    const params: Record<string, unknown> = {}
    if (ecnTab) params.status = ecnTab
    if (ecnSearch.trim()) params.search = ecnSearch.trim()
    const handle = setTimeout(() => {
      setEcnLoading(true)
      designApi.listChangeNotices(params)
        .then((data) => { setEcns(Array.isArray(data) ? data : []); setError('') })
        .catch((err) => setError(extractErrorMessages(err, 'Failed to load change notices.')))
        .finally(() => setEcnLoading(false))
    }, ecnSearch ? 250 : 0)
    return () => clearTimeout(handle)
  }, [isAuthorized, section, ecnTab, ecnSearch])

  if (isLoading || !isAuthorized) return null

  const switchSection = (s: 'ecr' | 'ecn') => {
    setSection(s)
    setError('')
    router.replace(s === 'ecn' ? '/dashboard/design/change-notices?tab=ecn' : '/dashboard/design/change-notices')
  }

  return (
    <div>
      <DesignNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>Design</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Changes</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>
            Anyone raises a change request (ECR) against a released drawing or BOM → Design checks the impact → the change board votes → an approved ECR becomes a change notice (ECN).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button data-tour="design-changes-raise-ecr-btn" onClick={() => router.push('/dashboard/design/change-requests/new')} style={bigBtn}>+ Raise ECR</button>
        </div>
      </div>

      {/* Section switch */}
      <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.normal}`, marginBottom: 16 }}>
        {([['ecr', 'Change requests (ECR)'], ['ecn', 'Change notices (ECN)']] as const).map(([k, label]) => {
          const active = section === k
          return (
            <button key={k} type="button" data-tour={`design-changes-section-${k}`} onClick={() => switchSection(k)} style={segmentBtnStyle(active)}>
              {label}
            </button>
          )
        })}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {section === 'ecr' ? (
        <>
          <div data-tour="design-ecrs-status-tabs" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {ECR_TABS.map((t) => chip(ecrTab === t.key, t.label, () => setEcrTab(t.key)))}
            <button type="button" data-tour="design-ecrs-mine" onClick={() => setMine((v) => !v)} style={{ ...chipBtnStyle(mine), marginLeft: 6 }}>
              {mine ? '✓ ' : ''}Raised by me
            </button>
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <input data-tour="design-ecrs-search" style={{ ...inputStyle, flex: '1 1 280px', maxWidth: 420 }} placeholder="Search by ECR number or title…" value={ecrSearch} onChange={(e) => setEcrSearch(e.target.value)} />
            <Select data-tour="design-ecrs-source" style={{ ...inputStyle, flex: '0 1 220px' }} value={ecrSource} onChange={(e) => setEcrSource(e.target.value)}>
              <option value="">All sources</option>
              {Object.entries(ECR_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>

          <div data-tour="design-ecrs-table" style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
              <thead>
                <tr>{['ECR', 'Title', 'Source', 'Urgency', 'Items', 'Raised by', 'Status', 'Votes', 'Days open', 'ECN'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={ecrs.length} />}</th>)}</tr>
              </thead>
              <tbody>
                {ecrLoading ? (
                  <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
                ) : ecrs.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No change requests here — use + Raise ECR to ask for a change to a released drawing or BOM.</td></tr>
                ) : (
                  ecrs.map((r) => (
                    <tr key={r.id} onClick={() => router.push(recordPath('/dashboard/design/change-requests', r))} style={{ cursor: 'pointer' }}>
                      <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{r.ecr_number}</td>
                      <td style={{ ...cellStyle, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                        {ECR_SOURCE_LABELS[r.source] || r.source}
                        {(r.ncr_number || r.capa_number) && <span style={{ color: TEXT.muted }}> · {r.ncr_number || r.capa_number}</span>}
                      </td>
                      <td style={cellStyle}>{pill(ECR_URGENCY_LABELS[r.urgency] || r.urgency, URGENCY_HEX[r.urgency] || '#78716c')}</td>
                      <td style={cellStyle}>{r.items.length}</td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{r.raised_by_name || '—'}</td>
                      <td style={cellStyle}>{pill(ECR_STATUS_LABELS[r.status] || r.status, ECR_STATUS_HEX[r.status] || '#78716c')}</td>
                      <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{r.votes_needed ? `${r.votes_cast} / ${r.votes_needed}` : '—'}</td>
                      <td style={cellStyle}>{['open', 'impact_checked'].includes(r.status) ? r.days_open : '—'}</td>
                      <td style={cellStyle} onClick={(ev) => { if (r.ecn_id) ev.stopPropagation() }}>
                        {r.ecn_id ? (
                          <span onClick={() => router.push(recordPath('/dashboard/design/change-notices', r, 'ecn_id'))} style={{ fontWeight: 600, color: '#FF6A2A', cursor: 'pointer', whiteSpace: 'nowrap' }}>{r.ecn_number}</span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          {me?.is_head && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.2)', color: '#1e40af', fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 320px' }}>
                ECNs normally come from an approved change request — open the ECR and use “Create ECN”. Raise one directly only for a change that skips the change board.
              </span>
              <button type="button" data-tour="design-ecns-new-btn" onClick={() => router.push('/dashboard/design/change-notices/new')} style={{ ...secondaryBtnStyle, border: '1px solid rgba(37,99,235,0.35)', color: '#1e40af' }}>
                + New ECN
              </button>
            </div>
          )}
          <div data-tour="design-ecns-status-tabs" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {ECN_TABS.map((t) => chip(ecnTab === t.key, t.label, () => setEcnTab(t.key)))}
          </div>
          <div style={{ marginBottom: 14 }}>
            <input data-tour="design-ecns-search" style={{ ...inputStyle, width: '100%', maxWidth: 420 }} placeholder="Search by ECN number, title or description…" value={ecnSearch} onChange={(e) => setEcnSearch(e.target.value)} />
          </div>

          <div data-tour="design-ecns-table" style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1240 }}>
              <thead>
                <tr>{['ECN', 'Title', 'ECR', 'Reason', 'Priority', 'Items', 'Raised by', 'Target', 'Acknowledged', 'Status'].map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={ecns.length} />}</th>)}</tr>
              </thead>
              <tbody>
                {ecnLoading ? (
                  <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>Loading…</td></tr>
                ) : ecns.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>No change notices here — they are created from an approved change request (“Create ECN”).</td></tr>
                ) : (
                  ecns.map((e) => {
                    const total = (e.documents?.length ?? e.document_count) + (e.boms?.length ?? 0)
                    const acks = e.acknowledgements?.length ?? 0
                    return (
                      <tr key={e.id} onClick={() => router.push(recordPath('/dashboard/design/change-notices', e))} style={{ cursor: 'pointer' }}>
                        <td style={{ ...cellStyle, fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{e.ecn_number}</td>
                        <td style={{ ...cellStyle, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</td>
                        <td style={cellStyle} onClick={(ev) => { if (e.ecr_id) ev.stopPropagation() }}>
                          {e.ecr_id ? (
                            <span onClick={() => router.push(recordPath('/dashboard/design/change-requests', e, 'ecr_id'))} style={{ fontWeight: 600, color: '#FF6A2A', cursor: 'pointer', whiteSpace: 'nowrap' }}>{e.ecr_number}</span>
                          ) : '—'}
                        </td>
                        <td style={cellStyle}>{ECN_REASON_LABELS[e.reason] || e.reason}</td>
                        <td style={cellStyle}>{pill(priorityLabel(e.priority), priorityTone(e.priority).color)}</td>
                        <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{['approved', 'implemented', 'closed'].includes(e.status) ? `${e.released_count} / ${total} released` : total}</td>
                        <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{e.created_by_name || '—'}</td>
                        <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{formatDate(e.target_date)}</td>
                        <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{acks ? `${e.acknowledged_count} / ${acks}` : '—'}</td>
                        <td style={cellStyle}>{pill(ECN_STATUS_LABELS[e.status] || e.status, ECN_STATUS_HEX[e.status] || '#78716c')}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
