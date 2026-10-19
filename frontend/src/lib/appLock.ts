// App password lock API (backend routes/app_lock.py). Activity tracking and
// the "locked" signal live in lib/appLockState.ts.
import { apiClient } from '@/lib/api'

export * from '@/lib/appLockState'

export type AppLockStatus = {
  enabled: boolean
  idle_minutes: number
  min_length: number
  has_password: boolean
  state: 'locked' | 'unlocked' | 'reset'
  locked_until: string | null
  temp_password_pending: boolean
  email: string | null
}

export const appLockApi = {
  status: async (): Promise<AppLockStatus> => (await apiClient.get('/auth/app-lock/status', { background: true })).data,
  set: async (new_password: string, current_password?: string): Promise<AppLockStatus> =>
    (await apiClient.post('/auth/app-lock/set', { new_password, current_password })).data,
  unlock: async (password: string): Promise<AppLockStatus> => (await apiClient.post('/auth/app-lock/unlock', { password })).data,
  heartbeat: async (): Promise<AppLockStatus> => (await apiClient.post('/auth/app-lock/heartbeat', {}, { background: true })).data,
  lock: async (): Promise<AppLockStatus> => (await apiClient.post('/auth/app-lock/lock', {}, { background: true })).data,
  forgot: async (): Promise<{ sent_to: string; valid_minutes: number }> => (await apiClient.post('/auth/app-lock/forgot')).data,
}
