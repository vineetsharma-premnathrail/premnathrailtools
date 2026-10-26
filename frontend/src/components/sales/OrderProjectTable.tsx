'use client'

// The Order Project 360 table: one row per element (vehicle / lot), one
// column per department. Cells come from the backend `departments` dict
// (sales/order_projects.py department_cells) — null = "Not linked yet". Later
// phases only fill data on the backend; this renderer stays generic.
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import type { OrderProjectCell, OrderProjectDepartment, OrderProjectElement } from '@/types'
import { thStyle, tdStyle, Pill } from '@/components/sales/SalesUi'
import { RowCount } from '@/components/shared/ui'

export const OP_STATUS_LABELS: Record<string, string> = {
  active: 'Active', on_hold: 'On hold', delivered: 'Delivered', closed: 'Closed', cancelled: 'Cancelled',
}
export const OP_STATUS_HEX: Record<string, string> = {
  active: '#2563EB', on_hold: '#F59E0B', delivered: '#16A34A', closed: '#57534e', cancelled: '#DC2626',
}
export const ELEMENT_STATUS_LABELS: Record<string, string> = {
  planned: 'Planned', in_progress: 'In progress', ready: 'Ready', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled',
}
export const ELEMENT_STATUS_HEX: Record<string, string> = {
  planned: '#78716c', in_progress: '#2563EB', ready: '#7C3AED', dispatched: '#0891B2', delivered: '#16A34A', cancelled: '#DC2626',
}

const TONE_HEX: Record<OrderProjectCell['tone'], string> = {
  neutral: '#78716c', info: '#2563EB', success: '#16A34A', warning: '#F59E0B', danger: '#DC2626',
}

export const DEPARTMENT_COLUMNS: { key: OrderProjectDepartment; label: string }[] = [
  { key: 'design', label: 'Design' },
  { key: 'purchase', label: 'Purchase' },
  { key: 'store', label: 'Store' },
  { key: 'production', label: 'Production' },
  { key: 'quality', label: 'Quality' },
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'delivery', label: 'Delivered' },
]

export function DepartmentCell({ cell }: { cell: OrderProjectCell | null | undefined }) {
  if (!cell) return <span title="Not linked yet" style={{ color: TEXT.muted }}>—</span>
  const hex = TONE_HEX[cell.tone] || TONE_HEX.neutral
  return (
    <div title={cell.detail || undefined}>
      <Pill label={cell.label} hex={hex} />
      {cell.detail && <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 3, whiteSpace: 'nowrap' }}>{cell.detail}</div>}
    </div>
  )
}

export default function OrderProjectTable({ elements }: { elements: OrderProjectElement[] }) {
  const cols = ['Element', 'Contractual date', 'Status', ...DEPARTMENT_COLUMNS.map((c) => c.label)]
  // ui-audit-ignore table-scroll — the caller (projects/order-projects/[id]) wraps this in its own
  // overflow:auto box with a max height, so the sticky header scrolls with the page body.
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1250 }}>
      <thead><tr>{cols.map((h, hi) => <th key={h} style={thStyle}>{h}{hi === 0 && <RowCount count={elements.length} />}</th>)}</tr></thead>
      <tbody>
        {elements.length === 0 ? (
          <tr><td colSpan={cols.length} style={{ padding: 20, textAlign: 'center', fontSize: 13, color: TEXT.muted }}>
            This project has no vehicles or lots — the sales order has no RRV delivery rows yet.
          </td></tr>
        ) : elements.map((el) => {
          const cancelled = el.status === 'cancelled'
          return (
            <tr key={el.id} style={{ opacity: cancelled ? 0.55 : 1 }}>
              <td style={tdStyle}>
                <div style={{ fontWeight: 600, color: TEXT.heading, whiteSpace: 'nowrap' }}>{el.label}</div>
                <div style={{ fontSize: 11.5, color: TEXT.muted, marginTop: 2 }}>
                  {el.element_no}
                  {el.kind === 'vehicle' && el.rrv_model ? ` · ${el.rrv_model}` : ''}
                  {el.kind === 'lot' ? ` · ${el.quantity} ${el.uom || ''}` : ''}
                </div>
              </td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                {formatDate(el.contractual_date)}
                {el.current_delivery_date && el.current_delivery_date !== el.contractual_date && (
                  <div style={{ fontSize: 11, color: TEXT.muted }}>now {formatDate(el.current_delivery_date)}</div>
                )}
              </td>
              <td style={tdStyle}><Pill label={ELEMENT_STATUS_LABELS[el.status] || el.status} hex={ELEMENT_STATUS_HEX[el.status] || '#78716c'} /></td>
              {DEPARTMENT_COLUMNS.map((c) => (
                <td key={c.key} style={tdStyle}>{cancelled ? <span style={{ color: TEXT.muted }}>—</span> : <DepartmentCell cell={el.departments?.[c.key]} />}</td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
