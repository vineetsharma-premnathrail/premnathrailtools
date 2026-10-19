import type { SRServiceType } from '@/types'

// Why the service visit happens — mirrors SR_SERVICE_TYPES in
// backend/app/modules/erp/models/service_request.py.
export const SERVICE_TYPES: { value: SRServiceType; label: string; hint: string }[] = [
  { value: 'installation_commissioning', label: 'Installation & Commissioning', hint: 'Install and make the unit ready for use' },
  { value: 'warranty', label: 'Warranty', hint: 'Service covered by the warranty' },
  { value: 'amc', label: 'AMC', hint: 'Service covered by an active maintenance contract' },
  { value: 'repair_breakdown', label: 'Repair / Breakdown', hint: 'Fix a failed or faulty unit' },
  { value: 'inspection_maintenance', label: 'Inspection / Maintenance', hint: 'Check or maintain the unit' },
  { value: 'paid_service', label: 'Paid Service', hint: 'Customer pays for the service outside warranty/AMC' },
]

export function serviceTypeLabel(value?: string | null): string {
  if (!value) return 'Not set'
  return SERVICE_TYPES.find((t) => t.value === value)?.label || value
}
