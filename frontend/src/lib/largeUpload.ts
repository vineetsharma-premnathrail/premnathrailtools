// Direct browser -> SharePoint upload for large files (up to 100 GB).
//
// Big files can't go through the portal: the Next.js proxy caps request
// bodies, and the API would have to hold the whole file. Instead the API
// opens a Graph upload session (backend/app/utils/sharepoint.py
// create_upload_session) and returns its pre-authenticated uploadUrl; this
// PUTs the file to it in chunks, then the module's complete-upload endpoint
// verifies and records the file.
//
// Progress is published to lib/requestActivity so components/shared/
// GlobalActivity.tsx can show it and warn before the tab is closed.

import { finishUpload, startUpload, updateUpload } from '@/lib/requestActivity'

/** Files bigger than this go direct to SharePoint instead of through the API. */
export const DIRECT_UPLOAD_THRESHOLD = 20 * 1024 * 1024

export type UploadSession = { upload_url: string; chunk_size: number; file_name: string }
export type DriveItem = { id: string; name: string; size: number }

const MAX_RETRIES = 4

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function putChunk(url: string, blob: Blob, start: number, end: number, total: number): Promise<Response> {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      // No Authorization header — the upload URL is itself the credential,
      // and Graph rejects bearer tokens on it.
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${start}-${end - 1}/${total}` },
        body: blob,
      })
      if (res.ok || res.status === 202) return res
      // 4xx other than throttling won't get better by retrying.
      if (res.status < 500 && res.status !== 429) {
        const text = await res.text().catch(() => '')
        throw new Error(`SharePoint refused part of the upload (${res.status}). ${text.slice(0, 200)}`)
      }
      lastError = new Error(`SharePoint returned ${res.status}`)
      const retryAfter = Number(res.headers.get('Retry-After')) || 0
      await sleep(Math.max(retryAfter * 1000, 1000 * 2 ** attempt))
    } catch (err) {
      lastError = err
      if (attempt === MAX_RETRIES) break
      await sleep(1000 * 2 ** attempt)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The upload failed — check your connection and try again.')
}

/** Uploads `file` to an open session in chunks; resolves with the stored drive item. */
export async function uploadToSession(file: File, session: UploadSession): Promise<DriveItem> {
  const chunk = session.chunk_size || 10 * 1024 * 1024
  const id = startUpload(session.file_name || file.name, file.size)
  try {
    let offset = 0
    let last: Response | null = null
    while (offset < file.size) {
      const end = Math.min(offset + chunk, file.size)
      last = await putChunk(session.upload_url, file.slice(offset, end), offset, end, file.size)
      offset = end
      updateUpload(id, offset)
    }
    if (!last || (last.status !== 200 && last.status !== 201)) {
      throw new Error('SharePoint did not confirm the finished upload — please try again.')
    }
    const item = (await last.json()) as DriveItem
    finishUpload(id, true)
    return item
  } catch (err) {
    finishUpload(id, false)
    throw err
  }
}
