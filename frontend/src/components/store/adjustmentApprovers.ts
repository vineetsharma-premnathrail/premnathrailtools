import { apiClient } from '@/lib/api'
import type { DirectoryUser } from '@/types'

/**
 * The Approver picker of a new stock adjustment / a physical count's
 * differences: active users holding Store › Adjustments › Approve (the matrix
 * tick decides since 2026-11-14, not the 'Store Manager' user flag). The
 * server leaves the caller out (nobody approves their own) and checks the
 * same grant on save. Backend: GET /store/stock-adjustments/approvers.
 */
export async function listAdjustmentApprovers(): Promise<DirectoryUser[]> {
  const { data } = await apiClient.get('/store/stock-adjustments/approvers')
  return data
}
