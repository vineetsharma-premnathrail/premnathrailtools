// Private Android app ("Premnath ERP"): published versions and the APK download.
// Admins publish versions on Organization › Mobile App; every signed-in employee
// downloads the latest one on /dashboard/app. Kept in its own file so the shared
// api.ts / types/index.ts stay untouched.
import type { AxiosError, AxiosProgressEvent } from 'axios'
import { apiClient } from '@/lib/api'

/** The newest active version (what phones and the download page get). */
export interface MobileAppLatest {
  id: number
  version_name: string
  version_code: number
  notes?: string | null
  /** True = phones on an older version are blocked until they update. */
  required: boolean
  /** Phones below this version code must update, even when `required` is off. */
  min_supported_version_code?: number | null
  file_size: number
  sha256: string
  released_at: string
  download_path?: string | null
}

/** One row of the admin list. */
export interface MobileAppRelease extends MobileAppLatest {
  is_active: boolean
  file_name?: string | null
  uploaded_by_name?: string | null
  created_at?: string | null
}

export interface MobileAppPublishInput {
  file: File
  version_name: string
  version_code: number
  notes?: string
  required: boolean
  min_supported_version_code?: number | null
}

export interface MobileAppReleaseUpdate {
  notes?: string | null
  required?: boolean
  is_active?: boolean
  min_supported_version_code?: number | null
}

// An APK can be 30-100 MB on a slow office / mobile line: no 10 s timeout for these.
const LONG_TIMEOUT = 15 * 60 * 1000


export const mobileAppApi = {
  /** Newest active version, or null when nothing has been published yet (404). */
  latest: async (): Promise<MobileAppLatest | null> => {
    try {
      return (await apiClient.get('/mobile-app/latest')).data
    } catch (err) {
      if ((err as AxiosError)?.response?.status === 404) return null
      throw err
    }
  },
  /** URL for a plain browser navigation to the APK (same base as apiClient; the
   * sign-in cookie goes along). The server answers 307 to a temporary SharePoint
   * link (or streams the file), so this must NOT be fetched with XHR/axios:
   * the cross-origin redirect would fail and a phone would hold the whole APK in memory. */
  downloadUrl: (id: number): string =>
    `${String(apiClient.defaults.baseURL || '').replace(/\/$/, '')}/mobile-app/releases/${id}/download`,

  // Admin only (Organization › Mobile App).
  list: async (): Promise<MobileAppRelease[]> =>
    (await apiClient.get('/mobile-app/releases')).data,
  publish: async (input: MobileAppPublishInput, onProgress?: (fraction: number | null) => void): Promise<MobileAppRelease> => {
    const fd = new FormData()
    fd.append('file', input.file)
    fd.append('version_name', input.version_name)
    fd.append('version_code', String(input.version_code))
    fd.append('notes', input.notes ?? '')
    fd.append('required', input.required ? 'true' : 'false')
    if (input.min_supported_version_code != null) fd.append('min_supported_version_code', String(input.min_supported_version_code))
    return (await apiClient.post('/mobile-app/releases', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: LONG_TIMEOUT,
      onUploadProgress: (ev: AxiosProgressEvent) => onProgress?.(ev.total ? ev.loaded / ev.total : null),
    })).data
  },
  update: async (id: number, patch: MobileAppReleaseUpdate): Promise<MobileAppRelease> =>
    (await apiClient.patch(`/mobile-app/releases/${id}`, patch)).data,
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/mobile-app/releases/${id}`)
  },
}

/** "48.2 MB" */
export function formatFileSize(bytes?: number | null): string {
  if (!bytes && bytes !== 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "12-11-2026" (the app's date style). */
export function formatReleaseDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB').replace(/\//g, '-')
}
