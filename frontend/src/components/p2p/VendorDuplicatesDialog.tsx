'use client'

// Procurement › Vendors › Find duplicates (2026-11-14). One click lists groups of
// vendors that are probably the same company — same GSTIN, same name once
// "Pvt Ltd / M/s / punctuation" is ignored, a similar name (typo), or one PAN
// with several GSTINs. Read-only: each vendor opens in a new tab so the list
// stays open while the team blocks / corrects the extra one.
// Backend: GET /p2p/vendor-duplicates (p2p/routes/vendor_duplicates.py).

import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import { FormSheet, SHEET, sheetBtn } from '@/components/shared/FormSheet'
import { StatChip, Pill, RowCount } from '@/components/shared/ui'

type DupVendor = { id: number; id_ref?: string; code: string; name: string; gstin: string | null; pan: string | null; city: string | null; state: string | null; status: string; po_count: number }
type DupKind = 'same_gstin' | 'same_name' | 'similar_name' | 'same_pan'
type DupGroup = { kind: DupKind; reason: string; vendors: DupVendor[] }
type DupResult = { groups: DupGroup[]; counts: Record<DupKind, number>; vendors_checked: number }

const KINDS: { kind: DupKind; label: string; color: string; hint: string }[] = [
  { kind: 'same_gstin', label: 'Same GSTIN', color: '#dc2626', hint: 'Two vendors with one GSTIN are the same company — keep one, block the other.' },
  { kind: 'same_name', label: 'Same name', color: '#ea580c', hint: 'Same name once case, punctuation and Pvt / Ltd / M/s are ignored.' },
  { kind: 'similar_name', label: 'Similar name', color: '#d97706', hint: 'Names that differ by a typo or a word — check the GSTIN / address before merging.' },
  { kind: 'same_pan', label: 'Same PAN', color: '#2563eb', hint: 'One PAN, different GSTINs — usually one company registered in several states, which is fine.' },
]
const STATUS_HEX: Record<string, string> = { active: '#16a34a', inactive: '#78716c', blocked: '#dc2626' }
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: SHEET.MUTED, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '7px 8px', fontSize: 13, color: SHEET.BODY, borderTop: `1px solid ${SHEET.LINE}`, verticalAlign: 'top' }

export default function VendorDuplicatesDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<DupResult | null>(null)
  const [error, setError] = useState('')
  const [kind, setKind] = useState<DupKind | ''>('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError('')
    apiClient.get<DupResult>('/p2p/vendor-duplicates')
      .then(({ data: d }) => { if (!cancelled) setData(d) })
      .catch((err) => { if (!cancelled) setError(extractErrorMessages(err, 'Could not check the vendors for duplicates — check your connection and try again.').join(' ')) })
    return () => { cancelled = true }
  }, [reload])

  const shown = useMemo(() => (data ? data.groups.filter((g) => !kind || g.kind === kind) : []), [data, kind])
  const meta = (k: DupKind) => KINDS.find((x) => x.kind === k)!

  return (
    <FormSheet icon="list" title="Find duplicate vendors" busy={false} onClose={onClose} width={980} tour="vendors-duplicates"
      subtitle={data ? `${data.vendors_checked} vendors checked — ${data.groups.length} possible duplicate group${data.groups.length === 1 ? '' : 's'}` : 'Checking every vendor…'}>
      <div style={{ padding: '18px 24px 24px' }}>
        {error && (
          <div role="alert" style={{ padding: '10px 12px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span>{error}</span>
            <button type="button" style={sheetBtn('secondary', SHEET.INK)} onClick={() => setReload((x) => x + 1)}>Try again</button>
          </div>
        )}
        {!data && !error && <p role="status" style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>Checking every vendor…</p>}
        {data && (
          <>
            <div data-tour="vendors-duplicates-counts" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              <StatChip label="All groups" value={data.groups.length} color="#3b82f6" onClick={() => setKind('')} active={kind === ''} />
              {KINDS.map((k) => (
                <StatChip key={k.kind} label={k.label} value={data.counts[k.kind] || 0} color={k.color}
                  onClick={() => setKind((cur) => (cur === k.kind ? '' : k.kind))} active={kind === k.kind} />
              ))}
            </div>
            {kind && <p style={{ fontSize: 12.5, color: SHEET.MUTED, margin: '0 0 12px' }}>{meta(kind).hint}</p>}
            {data.groups.length === 0 && (
              <p role="status" style={{ fontSize: 13.5, color: '#15803d', margin: 0 }}>No duplicates found — every vendor has its own name and GSTIN.</p>
            )}
            {data.groups.length > 0 && shown.length === 0 && (
              <p role="status" style={{ fontSize: 13, color: SHEET.MUTED, margin: 0 }}>No group of this kind — click another count above.</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {shown.map((g, gi) => {
                const m = meta(g.kind)
                return (
                  <section key={`${g.kind}-${gi}`} aria-label={`${m.label}: ${g.vendors.map((v) => v.name).join(', ')}`}
                    style={{ border: `1px solid ${SHEET.LINE}`, borderLeft: `4px solid ${m.color}`, borderRadius: 12, padding: '10px 12px', background: '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <Pill label={m.label} hex={m.color} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: SHEET.INK }}>{g.reason}</span>
                      <span style={{ fontSize: 12, color: SHEET.MUTED }}>· {g.vendors.length} vendors</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                        <thead><tr>{['Code', 'Company', 'GSTIN', 'PAN', 'City', 'Status', 'POs', ''].map((h, i) => <th key={h || 'open'} style={th}>{h}{i === 0 && <RowCount count={g.vendors.length} />}</th>)}</tr></thead>
                        <tbody>
                          {g.vendors.map((v) => (
                            <tr key={v.id}>
                              <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{v.code}</td>
                              <td style={td}>{v.name}</td>
                              <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{v.gstin || '—'}</td>
                              <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{v.pan || '—'}</td>
                              <td style={td}>{[v.city, v.state].filter(Boolean).join(', ') || '—'}</td>
                              <td style={td}><Pill label={v.status.charAt(0).toUpperCase() + v.status.slice(1)} hex={STATUS_HEX[v.status] || '#78716c'} /></td>
                              <td style={{ ...td, textAlign: 'right' }} title="Purchase orders placed on this vendor — keep the one that has the history">{v.po_count}</td>
                              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                <a href={recordPath('/dashboard/p2p/vendors', v)} target="_blank" rel="noopener noreferrer"
                                  style={{ color: SHEET.BLUE, fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}>Open ↗</a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )
              })}
            </div>
          </>
        )}
      </div>
    </FormSheet>
  )
}
