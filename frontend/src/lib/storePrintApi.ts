import { apiClient } from './api'

// Store print calls: the owner's ISO store formats (F/STR/02-06) filled from
// portal data and downloaded as Excel. Kept apart from lib/api.ts (shared registry).

/** A failed download comes back as a Blob, so the server's `detail` is unreadable to
 *  extractErrorMessages. Turn the Blob back into JSON so the real reason reaches the user. */
async function unwrapBlobError(err: unknown): Promise<never> {
  const res = (err as { response?: { data?: unknown } } | null)?.response
  if (res && typeof Blob !== 'undefined' && res.data instanceof Blob) {
    try {
      res.data = JSON.parse(await res.data.text())
    } catch {
      res.data = { detail: 'The register could not be prepared. Try again; if it keeps failing, tell the administrator.' }
    }
  }
  throw err
}

async function xlsx(path: string, params: Record<string, unknown>, activityLabel: string): Promise<Blob> {
  try {
    const { data } = await apiClient.get(path, { params, responseType: 'blob', timeout: 120000, activityLabel })
    return data as Blob
  } catch (err) {
    return unwrapBlobError(err)
  }
}

export interface RegisterRange { date_from: string; date_to: string; location_id?: number | null }

const clean = (p: object) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== null && v !== undefined))

export const storePrintApi = {
  /** F/STR/04 Store Requisition Slip of one material issue. */
  issueSlip: (issueId: number) =>
    xlsx(`/store/material-issues/${issueId}/print-slip`, {}, 'Preparing requisition slip'),
  /** F/STR/05 Material Issue Register for a date range (optionally one store). */
  issueRegister: (p: RegisterRange) =>
    xlsx('/store/material-issues/print-register', clean(p), 'Preparing issue register'),
  /** F/STR/02 Gate Inward Register: GRN lines + Before-PO receipt lines. */
  inwardRegister: (p: RegisterRange) =>
    xlsx('/p2p/goods-receipts/print-inward-register', clean(p), 'Preparing gate inward register'),
  /** F/STR/03 Gate Outward Register: challan issues, returns to vendor, transfers to another plant. */
  outwardRegister: (p: RegisterRange) =>
    xlsx('/store/material-issues/print-outward-register', clean(p), 'Preparing gate outward register'),
  /** F/STR/06 Inventory Register (rack-wise bin card) for one store and month (YYYY-MM). */
  inventoryRegister: (p: { location_id: number; month: string; rack?: string | null }) =>
    xlsx('/store/bin-stock/print-inventory-register', clean(p), 'Preparing inventory register'),
  /** Racks of a store as the Inventory Register groups its bins. */
  registerRacks: async (locationId: number): Promise<string[]> =>
    (await apiClient.get('/store/bin-stock/register-racks', { params: { location_id: locationId } })).data,
}
