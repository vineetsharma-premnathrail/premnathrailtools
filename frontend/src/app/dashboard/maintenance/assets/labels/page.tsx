'use client'

// Printable QR asset labels — an A4 sheet of 3 × 6 labels (≈ 63 × 42 mm,
// fits common 18/21-up adhesive label stock). Each QR encodes the scan
// resolver URL for the asset code; scanning opens "Report Breakdown".
// Reached with ?ids=<ref>,<ref> (signed asset refs, selected on the Assets list) or by picking a
// plant here (?branch_id= also works). The sheet is portaled to <body> for
// printing because the dashboard shell is a fixed-height overflow:hidden box
// that would clip everything after the first printed page.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAssetTagLabel } from '@/types'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import MaintenanceNav from '@/components/maintenance/MaintenanceNav'
import { extractErrorMessages } from '@/lib/validation'
import { resolveRecordRef, INVALID_LINK } from '@/lib/recordRef'
import InvalidRecordLink from '@/components/erp/InvalidRecordLink'
import Select from '@/components/shared/Select'

const LABELS_PER_PAGE = 18

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

const PRINT_CSS = `
.mt-print-root { display: none; }
.mt-sheet { width: 210mm; box-sizing: border-box; padding: 10mm 6mm; display: grid; grid-template-columns: repeat(3, 63mm); grid-auto-rows: 42mm; gap: 3mm 3mm; justify-content: center; background: #fff; }
.mt-label { box-sizing: border-box; border: 0.3mm dashed #bbb; border-radius: 2mm; padding: 2.5mm; display: flex; gap: 2mm; align-items: center; overflow: hidden; color: #111; font-family: Arial, Helvetica, sans-serif; break-inside: avoid; page-break-inside: avoid; }
.mt-label-qr { flex: none; width: 30mm; height: 30mm; }
.mt-label-qr svg { width: 100%; height: 100%; display: block; }
.mt-label-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1mm; }
.mt-label-code { font-size: 12pt; font-weight: 700; line-height: 1.1; word-break: break-all; }
.mt-label-name { font-size: 8pt; font-weight: 600; line-height: 1.15; max-height: 2.4em; overflow: hidden; }
.mt-label-plant { font-size: 6.5pt; color: #444; line-height: 1.15; max-height: 2.4em; overflow: hidden; }
.mt-label-cta { font-size: 6.5pt; font-weight: 700; margin-top: 0.5mm; border-top: 0.2mm solid #999; padding-top: 0.8mm; }
.mt-page { page-break-after: always; break-after: page; }
.mt-page:last-child { page-break-after: auto; break-after: auto; }
@media print {
  @page { size: A4 portrait; margin: 0; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(.mt-print-root) { display: none !important; }
  .mt-print-root { display: block !important; }
  .mt-label { border-color: #ddd; }
}
`

/** Our own backend's segno output — still refuse anything that isn't a bare <svg> with no script. */
function safeSvg(svg: string): string {
  const s = (svg || '').trim()
  if (!s.startsWith('<svg') || /<script|on\w+\s*=|javascript:/i.test(s)) return ''
  return s
}

function Label({ l }: { l: MaintenanceAssetTagLabel }) {
  return (
    <div className="mt-label">
      <div className="mt-label-qr" dangerouslySetInnerHTML={{ __html: safeSvg(l.qr_svg) }} />
      <div className="mt-label-text">
        <div className="mt-label-code">{l.asset_code}</div>
        <div className="mt-label-name">{l.name}</div>
        <div className="mt-label-plant">{[l.branch_name, l.location_text].filter(Boolean).join(' · ')}</div>
        <div className="mt-label-cta">Scan to report a breakdown</div>
      </div>
    </div>
  )
}

function Sheets({ labels }: { labels: MaintenanceAssetTagLabel[] }) {
  const pages: MaintenanceAssetTagLabel[][] = []
  for (let i = 0; i < labels.length; i += LABELS_PER_PAGE) pages.push(labels.slice(i, i + LABELS_PER_PAGE))
  return (
    <>
      {pages.map((page, idx) => (
        <div key={idx} className="mt-page mt-sheet">
          {page.map((l) => <Label key={l.id} l={l} />)}
        </div>
      ))}
    </>
  )
}

/** ?ids= carries signed asset refs (lib/recordRef.ts), comma-separated. */
function parseRefs(raw: string | null): string[] {
  if (!raw) return []
  return Array.from(new Set(raw.split(',').map((x) => x.trim()).filter(Boolean)))
}

export default function MaintenanceAssetLabelsPage() {
  const { isAuthorized, isLoading } = useRequireApp('maintenance')
  const router = useRouter()
  const searchParams = useSearchParams()
  const idsParam = searchParams.get('ids')
  const refs = useMemo(() => parseRefs(idsParam), [idsParam])
  const [ids, setIds] = useState<number[]>([])
  const [linkError, setLinkError] = useState('')
  useEffect(() => {
    let live = true
    setLinkError('')
    if (!refs.length) { setIds([]); return }
    Promise.all(refs.map(resolveRecordRef))
      .then((resolved) => { if (live) setIds(Array.from(new Set(resolved))) })
      .catch(() => { if (live) { setIds([]); setLinkError(INVALID_LINK) } })
    return () => { live = false }
  }, [refs])

  const [branches, setBranches] = useState<{ id: number; name: string }[]>([])
  const [branchId, setBranchId] = useState(searchParams.get('branch_id') || '')
  const [labels, setLabels] = useState<MaintenanceAssetTagLabel[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const load = useCallback(async (params: { ids?: number[]; branch_id?: number }) => {
    setLoading(true)
    setError('')
    try {
      const data = await maintenanceApi.getAssetTagSheet(params)
      setLabels(Array.isArray(data) ? data : [])
      if (Array.isArray(data) && data.length === 0) {
        setError(params.ids?.length
          ? 'None of the selected assets were found — they may have been deleted.'
          : 'This plant has no active assets to label. Add assets in the register first.')
      }
    } catch (err) {
      setLabels([])
      setError(extractErrorMessages(err, 'Failed to load the label sheet.').join(' '))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAuthorized) return
    maintenanceApi.getLookups()
      .then((l) => setBranches(l.branches || []))
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the plant list.').join(' ')))
    if (refs.length) { if (ids.length) load({ ids }) }
    else if (searchParams.get('branch_id')) load({ branch_id: Number(searchParams.get('branch_id')) })
  }, [isAuthorized, refs, ids, load, searchParams])

  const loadPlant = () => {
    if (!branchId) { setError('Pick a plant to print its asset labels.'); return }
    load({ branch_id: Number(branchId) })
  }

  if (isLoading || !isAuthorized) return null
  if (linkError) return (<div><MaintenanceNav /><InvalidRecordLink message={linkError} listHref="/dashboard/maintenance/assets" listLabel="Back to assets" /></div>)

  const pageCount = Math.ceil(labels.length / LABELS_PER_PAGE)

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <MaintenanceNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Maintenance Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>QR Asset Labels</h1>
          <p style={{ fontSize: 13, color: TEXT.secondary, margin: '0 0 20px' }}>
            Stick a label on each machine. Scanning it with a phone opens a breakdown request for that machine.
          </p>
        </div>
        <button data-tour="maint-labels-back" onClick={() => router.push('/dashboard/maintenance/assets')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={sectionStyle}>
        {refs.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, color: TEXT.body }}>
              {refs.length} selected asset{refs.length === 1 ? '' : 's'} from the Assets list.
            </span>
            <button data-tour="maint-labels-pick-plant" type="button" style={secondaryBtnStyle} onClick={() => { setLabels([]); router.push('/dashboard/maintenance/assets/labels') }}>
              Pick a plant instead
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <label style={labelStyle}>Plant</label>
              <Select data-tour="maint-labels-plant" style={inputStyle} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">Select a plant…</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </div>
            <button data-tour="maint-labels-load" type="button" style={secondaryBtnStyle} onClick={loadPlant} disabled={loading}>
              {loading ? 'Loading…' : 'Load labels'}
            </button>
            <span style={{ fontSize: 12, color: TEXT.muted }}>Up to 200 labels per sheet; decommissioned assets are skipped.</span>
          </div>
        )}
      </div>

      {labels.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: TEXT.heading }}>
              {labels.length} label{labels.length === 1 ? '' : 's'} · {pageCount} A4 page{pageCount === 1 ? '' : 's'}
            </span>
            <button data-tour="maint-labels-print" type="button" style={primaryBtnStyle} onClick={() => window.print()}>Print labels</button>
          </div>
          <p style={{ fontSize: 12, color: TEXT.muted, margin: '0 0 12px' }}>
            In the print dialog set scale to 100% (Actual size) and margins to None so labels line up with the label stock.
          </p>
          {/* On-screen preview of the same sheet (scrolls horizontally on phones). */}
          <div data-tour="maint-labels-preview" style={{ overflowX: 'auto', background: '#f5f5f4', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', minWidth: 'fit-content' }}>
              <Sheets labels={labels} />
            </div>
          </div>
        </div>
      )}

      {mounted && labels.length > 0 && createPortal(
        <div className="mt-print-root"><Sheets labels={labels} /></div>,
        document.body,
      )}
    </div>
  )
}
