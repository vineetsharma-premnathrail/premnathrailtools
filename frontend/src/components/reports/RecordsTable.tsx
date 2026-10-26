'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CaretDown, CaretUp } from '@phosphor-icons/react'
import { Pill, RowCount, TableScroll, pageBtnStyle, thStyle, tdStyle } from '@/components/shared/ui'
import { fmtCell, fmtNumber, isNumeric, prettyKey } from '@/lib/reports/format'
import { STATUS_HEX } from '@/lib/reports/palette'
import { recordPath } from '@/lib/recordRef'
import type { ColumnDef, DetailResult } from '@/lib/reports/types'

/** The signed link of a row's record, or null when the row carries none (never throws). */
function hrefOf(row: Record<string, unknown>, col: ColumnDef | undefined): string | null {
  if (!col?.link || !col.id_key) return null
  try { return recordPath(col.link, row, col.id_key) } catch { return null }
}

/** One record per row (paged and sorted on the server). Rows and link cells open the record through its signed link. */
export default function RecordsTable({ result, sort, dir, onSort, onPage, loading, noun, maxHeight = 'calc(100vh - 300px)', tour }: {
  result: DetailResult
  sort: string
  dir: 'asc' | 'desc'
  onSort: (key: string) => void
  onPage: (page: number) => void
  loading?: boolean
  noun: string
  maxHeight?: number | string
  tour?: string
}) {
  const router = useRouter()
  const cols = result.columns
  const rowLink = cols.find((c) => c.link && c.id_key)
  const pages = Math.max(1, Math.ceil(result.row_count / (result.page_size || 100)))
  const from = result.row_count === 0 ? 0 : (result.page - 1) * result.page_size + 1
  const to = Math.min(result.row_count, result.page * result.page_size)

  const render = (c: ColumnDef, row: Record<string, unknown>) => {
    const v = row[c.key]
    if (c.type === 'status' && v) {
      const key = String(v).toLowerCase().replace(/\s+/g, '_')
      return <Pill label={/^[a-z_]+$/.test(String(v)) ? prettyKey(String(v)) : String(v)} hex={STATUS_HEX[key] || '#64748b'} />
    }
    const text = isNumeric(c.type) ? fmtNumber(c.type, v) : c.type === 'longtext' || c.cut ? (v === null || v === undefined || v === '' ? '—' : String(v)) : fmtCell(c.type, v)
    const href = hrefOf(row, c)
    if (href && v) return <Link href={href} onClick={(e) => e.stopPropagation()} style={{ color: '#c2410c', fontWeight: 600, textDecoration: 'none' }}>{text}</Link>
    if (c.cut) return <div title={text} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</div>
    return text
  }

  const arrow = (k: string) => (sort === k ? (dir === 'asc' ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />) : null)

  return (
    <div>
      <TableScroll maxHeight={maxHeight} style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
        <table data-tour={tour} style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={c.key} data-fit-min={60} data-fit-cut={c.cut ? '' : undefined} aria-sort={sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  onClick={() => onSort(c.key)} title={`Sort by ${c.label}`}
                  style={{ ...thStyle, whiteSpace: 'nowrap', cursor: 'pointer', textAlign: isNumeric(c.type) ? 'right' : 'left' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{c.label}{arrow(c.key)}</span>
                  {i === 0 && <RowCount count={result.row_count} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, ri) => {
              const href = hrefOf(row, rowLink)
              return (
                <tr key={ri} onClick={href ? () => router.push(href) : undefined} style={{ cursor: href ? 'pointer' : 'default' }}>
                  {cols.map((c) => (
                    <td key={c.key} data-fit-clamp={c.cut ? '' : undefined}
                      style={{ ...tdStyle, whiteSpace: 'nowrap', textAlign: isNumeric(c.type) ? 'right' : 'left', fontVariantNumeric: isNumeric(c.type) ? 'tabular-nums' : undefined }}>
                      {render(c, row)}
                    </td>
                  ))}
                </tr>
              )
            })}
            {result.rows.length === 0 && (
              <tr><td colSpan={cols.length} style={{ ...tdStyle, textAlign: 'center', color: '#78716c' }}>No {noun} match.</td></tr>
            )}
            {result.rows.length > 0 && result.totals && Object.keys(result.totals).length > 0 && (
              <tr style={{ background: '#fdf1e6' }}>
                {cols.map((c, i) => (
                  <td key={c.key} style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap', borderTop: '2px solid rgba(0,0,0,0.12)', textAlign: isNumeric(c.type) ? 'right' : 'left' }}>
                    {i === 0 ? 'Total' : result.totals && c.key in result.totals ? fmtNumber(c.type, result.totals[c.key]) : ''}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </TableScroll>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <span style={{ fontSize: 12.5, color: '#57534e' }}>
          {result.row_count === 0 ? `No ${noun}` : `${from.toLocaleString('en-IN')}–${to.toLocaleString('en-IN')} of ${result.row_count.toLocaleString('en-IN')} ${noun}`}
        </span>
        {pages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" disabled={result.page <= 1} onClick={() => onPage(result.page - 1)} style={pageBtnStyle(result.page <= 1)}>Previous</button>
            <span style={{ fontSize: 12.5, color: '#57534e' }}>Page {result.page} of {pages}</span>
            <button type="button" disabled={result.page >= pages} onClick={() => onPage(result.page + 1)} style={pageBtnStyle(result.page >= pages)}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
