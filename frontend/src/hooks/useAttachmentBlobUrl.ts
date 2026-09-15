'use client'

import { useEffect, useState } from 'react'

/** Fetches an attachment's bytes through our own backend (never the raw
 * SharePoint webUrl) and exposes them as a local blob: object URL for
 * <img>/<a> use. Revokes the previous object URL whenever the source
 * changes or the component unmounts, since blob URLs otherwise leak. */
export function useAttachmentBlobUrl(fetchBlob: (() => Promise<Blob>) | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!fetchBlob) {
      setUrl(null)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    fetchBlob().then((blob) => {
      if (cancelled) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => {
      if (!cancelled) setUrl(null)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchBlob])

  return url
}

/** For an on-click "open in new tab" action (documents, not thumbnails) —
 * fetches the blob on demand and opens it, instead of a static href pointing
 * at a real SharePoint URL. A bare `window.open(objectUrl)` has no filename
 * to offer: `blob:` URLs carry none, so if the browser can't render the mime
 * type inline (e.g. .docx) and the user saves it from the new tab, it falls
 * back to the UUID from the blob URL itself as the suggested filename — the
 * server's Content-Disposition header never reaches the save dialog since
 * the response was already consumed into a Blob before this point. Passing
 * `filename` routes the download through a hidden `<a download>` instead,
 * which lets the browser use the real name. */
export async function openAttachmentBlob(fetchBlob: () => Promise<Blob>, filename?: string): Promise<void> {
  const blob = await fetchBlob()
  const objectUrl = URL.createObjectURL(blob)
  if (filename) {
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } else {
    window.open(objectUrl, '_blank')
  }
  // Give the new tab/download time to start before revoking; browsers keep
  // the blob alive as long as something references it, but we don't want to
  // leak forever.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}
