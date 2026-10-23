'use client'

// Export to Excel for the Machines / Service Requests registers. Opens from
// the list's Export button with two modes:
//  - All: everything matching the list's search + filters, optionally
//    narrowed to a From–To range on a chosen date.
//  - Selective: tick exactly which records to export (picked here, so the
//    list itself carries no checkboxes).

import { useMemo, useState } from 'react'
import { erpApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { TEXT } from '@/lib/theme'
import { inputStyle, primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import DateField from '@/components/erp/DateField'
import Checkbox from '@/components/Checkbox'
import { createPortal } from 'react-dom'

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const linkBtn: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#2563eb', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }

export interface ExportItem {
  id: number | string
  label: string
  sub?: string
}

export default function ExportDialog({
  kind, download, selectionParams, onClose, items, filterParams, dateLabel, filename, noun,
}: {
  /** Service registers; other modules pass `download` instead. */
  kind?: 'projects' | 'service-requests'
  download?: (params: Record<string, string | undefined>) => Promise<Blob>
  /** How ticked ids are sent (default: ids=1,2,3). */
  selectionParams?: (ids: (number | string)[]) => Record<string, string | undefined>
  onClose: () => void
  /** Records offered in Selective mode (the list as currently loaded). */
  items: ExportItem[]
  /** The list page's current search + filters (used in All mode). */
  filterParams: Record<string, string | undefined>
  /** Which date the optional From–To range applies to, e.g. "Dispatch date" (fixed per register). */
  dateLabel: string
  /** Base file name without extension, e.g. "machines". */
  filename: string
  /** Plural shown in the copy, e.g. "machines". */
  noun: string
}) {
  const [mode, setMode] = useState<'all' | 'selective'>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<number | string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const close = () => { if (!busy) onClose() }
  useEscapeKey(true, close)

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? items.filter((i) => `${i.label} ${i.sub || ''}`.toLowerCase().includes(q)) : items
  }, [items, search])

  const toggle = (id: number | string) => setPicked((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  const run = async () => {
    if (mode === 'selective' && picked.size === 0) {
      setError(`Tick at least one of the ${noun} to export, or switch to All.`)
      return
    }
    if (mode === 'all' && from && to && from > to) {
      setError('From date is after To date — swap them or pick a later To date.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const params: Record<string, string | undefined> = mode === 'selective'
        ? (selectionParams ? selectionParams([...picked]) : { ids: [...picked].join(',') })
        : { ...filterParams, date_from: from || undefined, date_to: to || undefined }
      const blob = download ? await download(params) : kind ? await erpApi.exportExcel(kind, params) : null
      if (!blob) throw new Error('Export is not configured for this list.')
      const suffix = mode === 'selective' ? `_selected_${picked.size}` : from || to ? `_${from || 'start'}_to_${to || 'today'}` : ''
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename}${suffix}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (err) {
      setError(extractErrorMessages(err, 'Export failed — check your connection and try again.').join(' '))
    } finally {
      setBusy(false)
    }
  }

  const modeCard = (value: 'all' | 'selective', title: string, sub: string) => (
    <label style={{ flex: '1 1 180px', display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
      border: `1px solid ${mode === value ? 'rgba(255,122,69,0.5)' : 'rgba(0,0,0,0.1)'}`, background: mode === value ? 'rgba(255,122,69,0.06)' : '#fff' }}>
      <input type="radio" checked={mode === value} onChange={() => { setMode(value); setError('') }} style={{ marginTop: 3 }} />
      <span>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: TEXT.body }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12, color: TEXT.muted }}>{sub}</span>
      </span>
    </label>
  )

  if (typeof document === 'undefined') return null
  // Portal to <body>: a glass card (backdrop-filter) would otherwise trap the
  // fixed backdrop inside itself instead of covering the screen.
  return createPortal(
    <div onClick={close} className="dialog-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="dialog-panel" style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto', background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Export {noun} to Excel</h2>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {modeCard('all', 'All', `Every ${noun.replace(/s$/, '')} in the list — optionally only a date period.`)}
          {modeCard('selective', 'Selective', `Choose exactly which ${noun} to export.`)}
        </div>

        {mode === 'all' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}>
              <span style={labelStyle}>{dateLabel} from (optional)</span>
              <DateField value={from} onChange={setFrom} />
            </div>
            <div style={{ flex: '0 1 170px', minWidth: 150 }}>
              <span style={labelStyle}>{dateLabel} to (optional)</span>
              <DateField value={to} onChange={setTo} />
            </div>
            <p style={{ flex: '1 1 100%', fontSize: 11.5, color: TEXT.muted, margin: 0 }}>
              {`Leave both blank to export all ${noun}. Fill them to export only ${noun} whose ${dateLabel.toLowerCase()} falls between `
                + 'the two dates (both included); you can also fill just one. The list’s current search and filters also apply.'}
            </p>
          </div>
        )}

        {mode === 'selective' && (
          <div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${noun}…`} style={{ ...inputStyle, marginBottom: 8 }} autoFocus />
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 8, fontSize: 12.5, color: TEXT.secondary }}>
              <b>{picked.size} selected</b>
              <button type="button" style={linkBtn} onClick={() => setPicked((s) => new Set([...s, ...shown.map((i) => i.id)]))}>
                Select all{search.trim() ? ' shown' : ''} ({shown.length})
              </button>
              {picked.size > 0 && <button type="button" style={linkBtn} onClick={() => setPicked(new Set())}>Clear</button>}
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10 }}>
              {shown.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted, padding: 14, margin: 0 }}>{items.length ? `No ${noun} match the search.` : `No ${noun} in the list.`}</p>}
              {shown.map((i) => (
                <div key={i.id} onClick={() => toggle(i.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(0,0,0,0.05)', background: picked.has(i.id) ? 'rgba(255,122,69,0.06)' : undefined }}>
                  <span onClick={(e) => e.stopPropagation()}><Checkbox checked={picked.has(i.id)} onChange={() => toggle(i.id)} /></span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: TEXT.body }}>{i.label}</span>
                    {i.sub && <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.sub}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{ padding: '10px 14px', margin: '12px 0 0', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button type="button" style={secondaryBtnStyle} onClick={close} disabled={busy}>Cancel</button>
          <button type="button" style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }} onClick={run} disabled={busy}>
            {busy ? 'Exporting…' : mode === 'selective' ? `Export ${picked.size || ''} selected`.replace('  ', ' ') : 'Export'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
