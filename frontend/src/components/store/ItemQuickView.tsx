'use client'

// Read-only item view in a right-side panel (owner, 2026-11-17): clicking a
// "Similar already exists" match on the Add Item form opens that item here,
// beside the form, instead of a new browser tab (the desktop app has no tabs).
// Closes only with its X (or Esc); the form behind stays usable.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'
import { storeApi } from '@/lib/api'
import { StoreItem } from '@/types'
import { TEXT, Z } from '@/lib/theme'
import { Pill, DetailGroup, DetailRow } from '@/components/shared/ui'
import { ITEM_TYPE_LABELS } from '@/components/store/itemTypes'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'

const STATUS: Record<string, [string, string]> = {
  active: ['Active', '#16a34a'], inactive: ['Inactive', '#78716c'], discontinued: ['Discontinued', '#dc2626'],
}

export default function ItemQuickView({ itemId, idRef, onClose }: { itemId: number; idRef?: string | null; onClose: () => void }) {
  const [item, setItem] = useState<StoreItem | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setItem(null); setError('')
    storeApi.getItem(itemId)
      .then((r) => { if (alive) setItem(r) })
      .catch((e) => { if (alive) setError(extractErrorMessages(e, 'Could not open this item — you may not have Store › Items › View, or it was deleted. Close this panel and try again.').join(' ')) })
    return () => { alive = false }
  }, [itemId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let fullHref: string | null = null
  if (idRef) { try { fullHref = recordPath('/dashboard/store', { id: itemId, id_ref: idRef }) } catch { fullHref = null } }
  const status = item ? STATUS[item.status] || [item.status, '#78716c'] : null

  return createPortal(
    <aside role="dialog" aria-modal="false" aria-label={item ? `Item ${item.item_code}` : 'Item'} style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 100vw)', zIndex: Z.sheet + 1,
      background: '#fff', borderLeft: '1px solid rgba(15,23,42,0.10)', boxShadow: '-12px 0 32px rgba(15,23,42,0.12)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '16px 18px', borderBottom: '1px solid rgba(15,23,42,0.08)' }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 2px' }}>Existing item</p>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{item ? item.item_code : '…'}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" title="Close" style={{
          width: 32, height: 32, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 8, border: '1px solid rgba(15,23,42,0.12)', background: '#fff', cursor: 'pointer', color: TEXT.body,
        }}><X size={16} /></button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
        {error ? <p role="alert" style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>{error}</p>
          : !item ? <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>
          : <>
            <p style={{ fontSize: 15, fontWeight: 600, color: TEXT.heading, margin: '0 0 6px', overflowWrap: 'anywhere' }}>{item.item_name}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12, fontSize: 12.5, color: TEXT.muted }}>
              {status && <Pill label={status[0]} hex={status[1]} />}
              {item.part_number && <span>Part code <strong style={{ color: TEXT.heading }}>{item.part_number}</strong></span>}
            </div>
            <DetailGroup title="Item Details">
              <DetailRow label="Item Type">{ITEM_TYPE_LABELS[item.item_type || ''] || item.item_type}</DetailRow>
              <DetailRow label="Category">{item.category ? `${item.category}${item.subcategory ? ` › ${item.subcategory}` : ''}` : null}</DetailRow>
              <DetailRow label="UOM">{item.uom}</DetailRow>
              {(item.unit_names || []).map((u) => <DetailRow key={u.branch_id} label={`Name at ${u.unit || 'unit'}`}>{u.name}</DetailRow>)}
              <DetailRow label="Technical Specification">{item.description}</DetailRow>
              <DetailRow label="Legacy code (v3 / Tally)">{item.legacy_code}</DetailRow>
            </DetailGroup>
          </>}
      </div>
      {fullHref && (
        <div style={{ padding: '12px 18px', borderTop: '1px solid rgba(15,23,42,0.08)' }}>
          <a href={fullHref} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: '#FF6A2A' }}>Open full item page ↗</a>
        </div>
      )}
    </aside>,
    document.body,
  )
}
