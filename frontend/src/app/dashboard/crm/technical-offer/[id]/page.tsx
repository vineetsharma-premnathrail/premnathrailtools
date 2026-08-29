'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useProtectedPage } from '@/hooks/useAuth'
import { crmApi } from '@/lib/api'
import { GLASS, SHADOWS, TEXT, BRAND } from '@/lib/theme'

// Technical Offer Request viewer — the link an inquiry/tender's "Send
// Technical Offer Request" action emails to R&D. Deliberately NOT gated by
// useRequireApp('crm'): R&D recipients often don't have the 'crm' module
// grant, and this document category is meant to cross that boundary by
// design. The backend enforces the real boundary — only logged-in users can
// fetch this specific document id (see documents.py get_document_content).
export default function TechnicalOfferViewerPage() {
  const { isAuthorized, isLoading } = useProtectedPage()
  const params = useParams()
  const id = Number(params.id)

  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [isPdf, setIsPdf] = useState(false)
  const [error, setError] = useState('')
  const [loadingDoc, setLoadingDoc] = useState(true)

  useEffect(() => {
    if (!isAuthorized || !id) return
    let objectUrl: string | null = null
    crmApi.getDocumentContent(id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setIsPdf(blob.type === 'application/pdf')
        setBlobUrl(objectUrl)
      })
      .catch((err) => {
        setError(err?.response?.status === 403
          ? 'You do not have access to this document.'
          : 'This document could not be loaded — it may have been removed.')
      })
      .finally(() => setLoadingDoc(false))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [isAuthorized, id])

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: TEXT.heading, margin: '0 0 16px' }}>
        Technical Offer Request
      </h1>
      <div style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), overflow: 'hidden', minHeight: 400 }}>
        {loadingDoc ? (
          <p style={{ padding: 24, fontSize: 13, color: TEXT.muted }}>Loading document…</p>
        ) : error ? (
          <p style={{ padding: 24, fontSize: 13, color: '#b91c1c' }}>{error}</p>
        ) : blobUrl ? (
          <>
            {isPdf && <embed src={blobUrl} type="application/pdf" style={{ width: '100%', height: '80vh', border: 'none' }} />}
            <div style={{ padding: 16, borderTop: isPdf ? `1px solid ${GLASS.border}` : undefined }}>
              <a href={blobUrl} download style={{ fontSize: 13, fontWeight: 600, color: BRAND.primary, textDecoration: 'none' }}>
                Download document
              </a>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
