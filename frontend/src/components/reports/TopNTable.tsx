'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { RowCount, TableScroll, thStyle, tdStyle } from '@/components/shared/ui'
import { fmtCell, fmtNumber, isNumeric } from '@/lib/reports/format'
import { recordPath } from '@/lib/recordRef'
import type { ColumnDef } from '@/lib/reports/types'

function hrefOf(row: Record<string, unknown>, col?: ColumnDef): string | null {
  if (!col?.link || !col.id_key) return null
  try { return recordPath(col.link, row, col.id_key) } catch { return null }
}

/** A short list (top customers, overdue jobs ...). A row opens its record. */
export default function TopNTable({ columns, rows, noun = 'rows', selected = [], onPick }: { columns: ColumnDef[]; rows: Record<string, unknown>[]; noun?: string; selected?: string[]; onPick?: (index: number, additive: boolean) => void }) {
  const router = useRouter()
  const rowCol = columns.find((c) => c.link && c.id_key)
  return (
    <TableScroll maxHeight={250} style={{ border: 'none', background: 'transparent' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c.key} data-fit-min={60} data-fit-cut={c.cut ? '' : undefined} style={{ ...thStyle, whiteSpace: 'nowrap', textAlign: isNumeric(c.type) ? 'right' : 'left' }}>
                {c.label}{i === 0 && <RowCount count={rows.length} title={`${rows.length} ${noun}`} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const href = hrefOf(row, rowCol)
            return (
              <tr key={ri} onClick={href ? () => router.push(href) : onPick && row.__token !== undefined ? (e) => onPick(ri, e.shiftKey || e.ctrlKey || e.metaKey) : undefined}
                style={{ cursor: href || (onPick && row.__token !== undefined) ? 'pointer' : 'default', background: selected.includes(String(row.__token)) ? 'rgba(255,122,69,0.12)' : undefined }}>
                {columns.map((c) => {
                  const v = row[c.key]
                  const text = isNumeric(c.type) ? fmtNumber(c.type, v) : fmtCell(c.type, v)
                  const link = hrefOf(row, c)
                  return (
                    <td key={c.key} data-fit-clamp={c.cut ? '' : undefined} style={{ ...tdStyle, whiteSpace: 'nowrap', textAlign: isNumeric(c.type) ? 'right' : 'left', fontVariantNumeric: isNumeric(c.type) ? 'tabular-nums' : undefined }}>
                      {link && v ? <Link href={link} onClick={(e) => e.stopPropagation()} style={{ color: '#c2410c', fontWeight: 600, textDecoration: 'none' }}>{text}</Link>
                        : c.cut ? <div title={text} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</div> : text}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableScroll>
  )
}
