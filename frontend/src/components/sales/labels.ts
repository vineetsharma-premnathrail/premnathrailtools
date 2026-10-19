// Display labels for the Sales module's coded values (backend
// app/modules/sales/models/*.py tuples). Values are coded in the backend —
// these maps only translate them for the UI.

export const SO_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', pending_approval: 'Pending approval', confirmed: 'Confirmed', in_execution: 'In execution',
  partially_delivered: 'Partially delivered', delivered: 'Delivered', closed: 'Closed', on_hold: 'On hold',
  cancelled: 'Cancelled', short_closed: 'Short-closed',
}
export const SO_STATUS_HEX: Record<string, string> = {
  draft: '#78716c', pending_approval: '#F59E0B', confirmed: '#2563EB', in_execution: '#7c3aed',
  partially_delivered: '#0891b2', delivered: '#16A34A', closed: '#0f766e', on_hold: '#9333EA',
  cancelled: '#78716c', short_closed: '#b45309',
}
export const ROW_STATUS_LABELS: Record<string, string> = {
  open: 'Open (no build)', build_planned: 'Build planned', in_production: 'In production', ready: 'Ready',
  dispatched: 'Dispatched', delivered: 'Delivered', commissioned: 'Commissioned', cancelled: 'Cancelled',
}
export const ROW_STATUS_HEX: Record<string, string> = {
  open: '#78716c', build_planned: '#2563EB', in_production: '#7c3aed', ready: '#0891b2',
  dispatched: '#0f766e', delivered: '#16A34A', commissioned: '#15803d', cancelled: '#78716c',
}
export const ORDER_TYPE_LABELS: Record<string, string> = {
  rrv_supply: 'RRV supply', spares: 'Spares supply', service: 'Service / AMC', other: 'Other',
}
export const PRICE_BASIS_LABELS: Record<string, string> = {
  ex_works: 'Ex-works', for_destination: 'FOR destination', for_dispatch: 'FOR dispatch station',
}
export const LD_PERIOD_LABELS: Record<string, string> = { week: 'Per week or part thereof', day: 'Per day' }
export const LD_BASIS_LABELS: Record<string, string> = { delayed_value: 'Value of delayed units', contract_value: 'Contract value' }
export const WARRANTY_RULE_LABELS: Record<string, string> = {
  from_delivery: 'From delivery', from_commissioning: 'From commissioning', earlier_of: 'Whichever is earlier', later_of: 'Whichever is later',
}
export const LINE_TYPE_LABELS: Record<string, string> = {
  rrv: 'RRV (vehicle)', spares: 'Spares', service: 'Service', freight: 'Freight', other: 'Other',
}
export const MILESTONE_LABELS: Record<string, string> = {
  advance: 'Advance', drawing_approval: 'Drawing approval', inspection: 'Inspection clearance', dispatch: 'On dispatch',
  delivery: 'On delivery (POD)', commissioning: 'On commissioning', retention_release: 'Retention release', other: 'Other',
}
export const LEVEL_LABELS: Record<string, string> = { sales_head: 'Sales Head', director: 'Director', partner: 'Partner' }
export const DEVIATION_LABELS: Record<string, string> = {
  ld_uncapped: 'LD has no cap', ld_cap_above_standard: 'LD cap above the standard',
  warranty_above_standard: 'Warranty longer than the standard', advance_below_standard: 'Advance below the standard minimum',
  price_below_list: 'Price below the price-list minimum',
}
export const EXTENSION_REASON_LABELS: Record<string, string> = {
  customer_cause: 'Customer cause (late drawing approval / inspection)', force_majeure: 'Force majeure', our_cause: 'Our cause',
}
export const DOC_TYPE_LABELS: Record<string, string> = {
  customer_po: 'Customer PO', loa: 'LOA', amendment_letter: 'Amendment letter', dp_extension_letter: 'DP extension letter',
  pod: 'Proof of delivery', inspection_certificate: 'Inspection certificate', bank_guarantee: 'Bank guarantee', other: 'Other',
}

export function formatINR(value: number | null | undefined): string {
  if (value == null) return '—'
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}
