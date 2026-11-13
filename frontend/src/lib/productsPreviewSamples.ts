import type { FinishedProduct } from '@/types'

/**
 * Made-up products for the Role editor's "Preview & choose" (lib/visibility.ts): the list and the
 * product page draw these instead of loading anything. Never sent to the server.
 */

const base = {
  uom: 'Nos', hsn_code: '8604', warranty_months: 12, applications: [], specifications: [], created_by_name: 'Sample user',
  description: 'Sample detailed description — only here to show the block.',
  technical_specification: 'Max speed on rail: 40 km/h\nEngine: 4-cylinder diesel, 110 HP\nTrack gauge: 1676 mm',
}

export const sampleProducts = [
  { ...base, id: -1, code: '01', name: 'Sample sanding vehicle', product_type: 'vehicle', model_number: 'PRT-SV-01', status: 'active',
    short_description: 'Self-propelled road-rail vehicle for rail-head sanding', store_item_code: '0101', store_item_name: 'Sanding vehicle (FG)' },
  { ...base, id: -2, code: '01', name: 'Sample rail bound tower wagon', product_type: 'rail_bound_vehicle', model_number: 'SL-600', status: 'development' },
  { ...base, id: -3, code: '01', name: 'Sample OHE inspection add-on', product_type: 'application', model_number: null, status: 'phased_out' },
] as unknown as FinishedProduct[]

export const sampleProduct = sampleProducts[0]
