'use client'

// "Similar already exists" box for create forms (Item, Vendor). It never blocks
// saving: it only tells the person that a record with a near-identical name is
// already there, with a link (new tab, signed record link) to check it first.
//
//   <SimilarRecordsHint kind="item" name={itemName} />
//   <SimilarRecordsHint kind="vendor" name={form.name} excludeId={vendor?.id} />
import { useEffect, useState } from 'react'
import { typingAssistApi, SimilarKind, SimilarMatch } from '@/lib/typingAssistApi'
import { recordPath } from '@/lib/recordRef'

const BASE: Partial<Record<SimilarKind, string>> = {
  item: '/dashboard/store',
  vendor: '/dashboard/p2p/vendors',
  organization: '/dashboard/crm/organizations',
}

function hrefOf(kind: SimilarKind, m: SimilarMatch): string | null {
  const base = BASE[kind]
  if (!base || !m.id_ref) return null
  try { return recordPath(base, m) } catch { return null }
}

export default function SimilarRecordsHint({ kind, name, excludeId }: { kind: SimilarKind; name: string; excludeId?: number | null }) {
  const [matches, setMatches] = useState<SimilarMatch[]>([])
  const q = name.trim()

  useEffect(() => {
    if (q.length < 3) { setMatches([]); return }
    const ctl = new AbortController()
    const t = setTimeout(() => {
      typingAssistApi.similar(kind, q, 5, ctl.signal)
        .then((r) => { if (!ctl.signal.aborted) setMatches(r.matches) })
        // No view access, offline or a slow reply: the hint is only advice, so stay quiet.
        .catch(() => { if (!ctl.signal.aborted) setMatches([]) })
    }, 400)
    return () => { clearTimeout(t); ctl.abort() }
  }, [kind, q])

  const shown = q.length < 3 ? [] : matches.filter((m) => m.id !== excludeId).slice(0, 5)
  if (!shown.length) return null

  return (
    <div role="status" aria-live="polite" data-no-assist style={{
      marginTop: 8, padding: '8px 12px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5,
      background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)', color: '#92400e',
    }}>
      <div style={{ fontWeight: 600 }}>Similar already exists:</div>
      {shown.map((m) => {
        const href = hrefOf(kind, m)
        const label = `${m.code ? `${m.code} · ` : ''}${m.name} (${Math.round(m.score * 100)}%)`
        return (
          <div key={`${m.id}`} style={{ overflowWrap: 'anywhere' }}>
            {href
              ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#92400e', textDecoration: 'underline' }}>{label}</a>
              : label}
          </div>
        )
      })}
      <div style={{ marginTop: 2, opacity: 0.85 }}>Check before saving so the same {kind === 'item' ? 'item' : kind === 'vendor' ? 'vendor' : 'record'} is not entered twice. You can still save.</div>
    </div>
  )
}
