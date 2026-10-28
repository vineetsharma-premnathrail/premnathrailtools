'use client'

import { useEffect, useState } from 'react'
import { salesApi } from '@/lib/api'
import { SalesCrmDocument } from '@/types'
import { extractErrorMessages } from '@/lib/validation'
import { formatDate } from '@/lib/format'
import Checkbox from '@/components/Checkbox'
import { SHEET, sheetBtn, sheetHint } from '@/components/shared/FormSheet'

/**
 * Tick the CRM documents of the order's source inquiry / tender that belong with
 * the order. Nothing is copied — the order keeps a link and opens the CRM file.
 * Nothing is ticked by default: the user chooses (owner, 2026-10-27).
 */
export default function CrmDocumentPicker({ inquiryId, tenderId, value, onChange }: {
  inquiryId?: number
  tenderId?: number
  value: number[]
  onChange: (ids: number[]) => void
}) {
  const [docs, setDocs] = useState<SalesCrmDocument[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!inquiryId && !tenderId) return
    let live = true
    salesApi.crmDocumentCandidates({ inquiry_id: inquiryId, tender_id: tenderId })
      .then((d) => { if (live) setDocs(d) })
      .catch((err) => { if (live) setError(extractErrorMessages(err, 'Could not load the CRM documents — reload the page.').join(' ')) })
    return () => { live = false }
  }, [inquiryId, tenderId])

  if (error) return <p style={{ ...sheetHint, color: '#b91c1c' }}>{error}</p>
  if (!docs) return <p style={sheetHint}>Loading CRM documents…</p>
  if (docs.length === 0) return <p style={sheetHint}>This {inquiryId ? 'inquiry' : 'tender'} has no documents in CRM.</p>

  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  const allPicked = docs.every((d) => value.includes(d.id))
  const folders = Array.from(new Set(docs.map((d) => d.folder)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12.5, color: SHEET.BODY }}>{value.length} of {docs.length} selected</span>
        <button type="button" onClick={() => onChange(allPicked ? [] : docs.map((d) => d.id))} style={sheetBtn('secondary', SHEET.INK)}>
          {allPicked ? 'Clear all' : 'Select all'}
        </button>
      </div>
      {folders.map((folder) => (
        <div key={folder}>
          <p style={{ margin: '0 0 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: SHEET.MUTED }}>{folder}</p>
          <div style={{ border: `1px solid ${SHEET.LINE}`, borderRadius: 10, overflow: 'hidden' }}>
            {docs.filter((d) => d.folder === folder).map((d, i) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderTop: i ? `1px solid ${SHEET.LINE}` : 'none', background: value.includes(d.id) ? 'rgba(37,99,235,0.05)' : 'transparent' }}>
                <Checkbox checked={value.includes(d.id)} onChange={() => toggle(d.id)} aria-label={`Link ${d.file_name}`} />
                <span onClick={() => toggle(d.id)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: SHEET.INK, overflowWrap: 'anywhere' }}>{d.file_name}</span>
                  <span style={{ fontSize: 11.5, color: SHEET.MUTED }}>
                    {[d.category, d.uploaded_by_name, d.uploaded_at ? formatDate(d.uploaded_at) : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p style={sheetHint}>Only a link is kept on the order — the file stays in CRM, so the order always opens the current file.</p>
    </div>
  )
}
