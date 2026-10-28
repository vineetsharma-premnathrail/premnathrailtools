'use client'

// "Unsaved data restored" strip for forms that use lib/formDraft.ts.

import { FormDraft } from '@/lib/formDraft'
import { formatDateTime } from '@/lib/format'
import { smallSecondaryBtnStyle } from '@/components/shared/ui'

export default function DraftBanner({ draft, style }: { draft: FormDraft; style?: React.CSSProperties }) {
  if (!draft.restored) return null
  return (
    <div role="status" data-tour="form-draft-restored" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      padding: '8px 12px', marginBottom: 14, borderRadius: 10, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', fontSize: 13, ...style,
    }}>
      <span>
        Your unsaved data{draft.restoredAt ? ` from ${formatDateTime(draft.restoredAt)}` : ''} was filled back in — check it and save.
        {draft.filesDropped ? ' Attached files could not be kept; attach them again.' : ''}
      </span>
      <button type="button" onClick={draft.discard} style={smallSecondaryBtnStyle}>Discard</button>
    </div>
  )
}
