// Windows app installer (desktop/, Electron): the portal admin uploads the
// Setup .exe once, every signed-in user downloads it from the profile menu.
// Kept in its own file so the shared api.ts / types/index.ts stay untouched.
import { apiClient } from '@/lib/api'
import { uploadToSession, UploadSession } from '@/lib/largeUpload'

export interface DesktopAppInfo {
  available: boolean
  version?: string | null
  file_name?: string | null
  file_size?: number | null
  released_at?: string | null
  uploaded_by_name?: string | null
}

export const desktopAppApi = {
  info: () => apiClient.get<DesktopAppInfo>('/desktop-app').then((r) => r.data),
  /** Short-lived direct link to the file (about 1 hour). */
  downloadLink: () => apiClient.get<{ url: string; file_name?: string | null }>('/desktop-app/download-link').then((r) => r.data),
  /** ~100 MB: the file goes browser -> SharePoint directly (like every big file), then the API checks it. */
  upload: async (version: string, file: File) => {
    const session = (await apiClient.post<UploadSession>('/desktop-app/upload-session',
      { version, file_name: file.name, file_size: file.size })).data
    const item = await uploadToSession(file, session)
    return (await apiClient.post<DesktopAppInfo>('/desktop-app/complete', { version, item_id: item.id }, { timeout: 60000 })).data
  },
}
