import { apiClient } from './api'

// Quality print calls. Kept apart from lib/api.ts (shared registry).

/** A failed download comes back as a Blob, so the server's `detail` is unreadable to
 *  extractErrorMessages. Turn the Blob back into JSON so the real reason reaches the user. */
async function unwrapBlobError(err: unknown): Promise<never> {
  const res = (err as { response?: { data?: unknown } } | null)?.response
  if (res && typeof Blob !== 'undefined' && res.data instanceof Blob) {
    try {
      res.data = JSON.parse(await res.data.text())
    } catch {
      res.data = { detail: 'The report could not be prepared. Try again; if it keeps failing, tell the administrator.' }
    }
  }
  throw err
}

export const qualityPrintApi = {
  /** Incoming inspection report of one lot, Excel (F/STR/01 layout). */
  lotReportXlsx: async (lotId: number): Promise<Blob> => {
    try {
      const { data } = await apiClient.get(`/quality/inspection-lots/${lotId}/report.xlsx`, {
        responseType: 'blob', timeout: 120000, activityLabel: 'Preparing inspection report',
      })
      return data as Blob
    } catch (err) {
      return unwrapBlobError(err)
    }
  },
}
