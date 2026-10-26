// Fixed categorical order, slots assigned by position, never re-cycled (moved from the old Service Reports page).
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
export const STATUS_COLOR = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' }
export const INK_MUTED = '#898781'
export const GRID = '#e1e0d9'
export const chartFont = { size: 10.5, family: 'system-ui, -apple-system, "Segoe UI", sans-serif' }

/** Status chip colours (same set as the Service Request Registry). */
export const STATUS_HEX: Record<string, string> = {
  open: '#3B82F6', acknowledged: '#8B5CF6', assigned: '#F59E0B', scheduled: '#06B6D4', in_progress: '#D97706',
  pending_parts: '#EF4444', on_hold: '#94A3B8', work_completed: '#10B981', review: '#6366F1', closed: '#22C55E', cancelled: '#CBD5E1',
  not_billable: '#94A3B8', to_bill: '#F59E0B', invoiced: '#2563EB', paid: '#16A34A',
}
