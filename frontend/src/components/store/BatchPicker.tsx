'use client'

import { useEffect, useState } from 'react'
import { storeBatchesApi } from '@/lib/api'
import { inputStyle } from '@/components/shared/ui'
import { TEXT } from '@/lib/theme'
import Select from '@/components/shared/Select'

interface AvailableBatch {
  batch_id: number | null
  batch_number: string
  heat_number?: string | null
  free_qty: number
  expiry_date?: string | null
  issuable: boolean
  reason?: string | null
}

/** Batch pick for an issue line of a batch-tracked item (SAP batch
 *  determination). "Auto" leaves it to the server, which splits the line
 *  FIFO (FEFO for expiry-controlled items) — the suggested split is shown
 *  under the picker. A named batch is checked against its own Free stock. */
export default function BatchPicker({ itemId, locationId, quantity, value, onChange }: {
  itemId: number; locationId: number; quantity: number; value: string; onChange: (v: string) => void
}) {
  const [batches, setBatches] = useState<AvailableBatch[]>([])
  const [suggestion, setSuggestion] = useState<{ batch_number: string; quantity: number }[]>([])
  const [shortfall, setShortfall] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    storeBatchesApi.available({ item_id: itemId, location_id: locationId, quantity: quantity > 0 ? quantity : undefined })
      .then((r) => { if (!live) return; setBatches(r.batches || []); setSuggestion(r.suggestion || []); setShortfall(r.shortfall || null); setError('') })
      .catch(() => { if (live) setError('Could not load the batches in this store.') })
    return () => { live = false }
  }, [itemId, locationId, quantity])

  const label = (b: AvailableBatch) =>
    `${b.batch_number}${b.heat_number ? ` · heat ${b.heat_number}` : ''} — ${b.free_qty} free${b.expiry_date ? ` · exp ${b.expiry_date.split('-').reverse().join('-')}` : ''}${b.issuable ? '' : ` (${b.reason})`}`

  return (
    <div>
      <Select style={{ ...inputStyle, minWidth: 200 }} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Auto — first in, first out</option>
        {batches.map((b) => <option key={b.batch_number} value={b.batch_number} disabled={!b.issuable}>{label(b)}</option>)}
      </Select>
      {error && <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 3 }}>{error}</div>}
      {!value && suggestion.length > 0 && (
        <div style={{ fontSize: 11, color: TEXT.muted, marginTop: 3 }}>
          Will issue {suggestion.map((s) => `${s.quantity} from ${s.batch_number}`).join(', ')}
        </div>
      )}
      {!value && shortfall && <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 3 }}>{shortfall}</div>}
    </div>
  )
}
