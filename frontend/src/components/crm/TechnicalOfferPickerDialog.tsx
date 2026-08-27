'use client'

import { useEffect, useState } from 'react'
import { crmApi } from '@/lib/api'
import { CrmDocument } from '@/types'
import Checkbox from '@/components/Checkbox'

export default function TechnicalOfferPickerDialog({
  open,
  relatedModule,
  relatedId,
  sending,
  onSend,
  onCancel,
}: {
  open: boolean
  relatedModule: 'inquiry' | 'tender'
  relatedId: number
  sending: boolean
  onSend: (documentIds: number[]) => void
  onCancel: () => void
}) {
  const [clientDocs, setClientDocs] = useState<CrmDocument[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelected([])
    setLoading(true)
    crmApi.listDocuments({ related_module: relatedModule, related_id: relatedId })
      .then((docs: CrmDocument[]) => setClientDocs(docs.filter((d) => d.folder_type === 'client')))
      .catch(() => setClientDocs([]))
      .finally(() => setLoading(false))
  }, [open, relatedModule, relatedId])

  if (!open) return null

  const toggle = (id: number) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}
      >
        <p style={{ fontSize: 16, fontWeight: 700, color: '#1f1108', margin: '0 0 6px' }}>Send Technical Offer Request to R&D</p>
        <p style={{ fontSize: 13, color: '#78716c', margin: '0 0 16px', lineHeight: 1.6 }}>
          Optionally include links to already-uploaded Client Documents as reference material in the email.
        </p>

        {loading ? (
          <p style={{ fontSize: 13, color: '#a8a29e' }}>Loading client documents…</p>
        ) : clientDocs.length === 0 ? (
          <p style={{ fontSize: 13, color: '#a8a29e', fontStyle: 'italic' }}>No client documents uploaded yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto', marginBottom: 16 }}>
            {clientDocs.map((d) => (
              <div key={d.id} onClick={() => toggle(d.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', cursor: 'pointer', fontSize: 13 }}>
                <span onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selected.includes(d.id)} onChange={() => toggle(d.id)} />
                </span>
                <span style={{ color: '#1f1108' }}>{d.file_name}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={sending}
            style={{ fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', color: '#57534e', cursor: sending ? 'not-allowed' : 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSend(selected)}
            disabled={sending}
            style={{ fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(140deg,#FF7A45,#ffe3d0)', color: '#fff', cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.7 : 1 }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
