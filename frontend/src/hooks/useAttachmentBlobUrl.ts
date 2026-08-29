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
 * at a real SharePoint URL. */
export async function openAttachmentBlob(fetchBlob: () => Promise<Blob>): Promise<void> {
  const blob = await fetchBlob()
  const objectUrl = URL.createObjectURL(blob)
  window.open(objectUrl, '_blank')
  // Give the new tab time to load before revoking; browsers keep the blob
  // alive as long as a tab references it, but we don't want to leak forever.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}
