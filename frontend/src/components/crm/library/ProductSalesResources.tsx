'use client'

// Product detail › Sales resources: the Sales Library documents linked to this product, grouped by folder.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Section, smallSecondaryBtnStyle, pillStyle } from '@/components/shared/ui'
import { useCan } from '@/lib/permissions'
import { recordHref } from '@/lib/recordRef'
import { TEXT } from '@/lib/theme'
import { FILE_KIND_HEX, FILE_KIND_LABEL, salesLibraryApi, sortDocuments, type LibProductResourceGroup } from '@/lib/salesLibraryApi'
import { ExpiryBadge, FileTypeBadge, LIBRARY_PATH, documentHref, errorText } from '@/components/crm/library/libraryUi'

export default function ProductSalesResources({ product }: { product: { id: number; id_ref?: string } }) {
  const { can } = useCan()
  const router = useRouter()
  const allowed = can('crm', 'sales_library', 'view')
  const [groups, setGroups] = useState<LibProductResourceGroup[] | null>(null)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!allowed) return
    let live = true
    salesLibraryApi.productResources(product.id)
      .then((g) => { if (live) { setGroups(g); setError('') } })
      .catch(async (err) => {
        // No Sales Library access: the section simply is not shown.
        if ((err as { response?: { status?: number } })?.response?.status === 403) { if (live) setHidden(true); return }
        if (live) setError(await errorText(err, 'The sales resources could not be loaded. Reload the page and try again.')) })
    return () => { live = false }
  }, [allowed, product.id])

  if (!allowed || hidden) return null

  const all = (groups ?? []).flatMap((g) => g.documents)
  const byKind = new Map<string, number>()
  for (const d of all) byKind.set(d.file_kind, (byKind.get(d.file_kind) ?? 0) + 1)
  const libraryHref = product.id_ref ? recordHref(LIBRARY_PATH, product, 'id', undefined, 'product') : LIBRARY_PATH

  return (
    <Section title="Sales resources" style={{ marginBottom: 16 }}>
      <div data-tour="prod-sales-resources" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>
          Catalogues, videos, price lists and other material linked to this product in the Sales Library.
        </p>
        <button type="button" style={smallSecondaryBtnStyle} onClick={() => router.push(libraryHref)}>Open in Sales Library</button>
      </div>
      {error && <p role="alert" style={{ fontSize: 13, color: '#b91c1c', margin: 0 }}>{error}</p>}
      {!error && groups === null && <p role="status" style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Loading…</p>}
      {groups !== null && all.length === 0 && (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: 0 }}>Nothing is linked to this product yet. Upload a file in the Sales Library and link it to this product (or upload into a folder linked to it).</p>
      )}
      {all.length > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ ...pillStyle('#334155'), fontWeight: 700 }}>{all.length} {all.length === 1 ? 'document' : 'documents'}</span>
            {[...byKind.entries()].sort((a, b) => (FILE_KIND_LABEL[a[0]] || a[0]).localeCompare(FILE_KIND_LABEL[b[0]] || b[0])).map(([k, n]) => (
              <span key={k} style={pillStyle(FILE_KIND_HEX[k] || '#78716c')}>{n} {FILE_KIND_LABEL[k] || k}</span>
            ))}
          </div>
          {[...(groups ?? [])].sort((a, b) => a.folder_path.localeCompare(b.folder_path)).map((g) => (
            <div key={g.folder_id}>
              <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 6px' }}>{g.folder_path}</p>
              <div style={{ border: '1px solid rgba(15,23,42,0.10)', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                {sortDocuments(g.documents).map((d, i) => {
                  const href = documentHref(d)
                  return (
                    <button key={d.id} type="button" disabled={!href} onClick={() => href && router.push(href)} title={href ? `Open ${d.title}` : d.title}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderTop: i ? '1px solid rgba(15,23,42,0.06)' : 'none', background: 'transparent', cursor: href ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                      <FileTypeBadge kind={d.file_kind} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1f1108', overflowWrap: 'anywhere' }}>{d.title}</span>
                        <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>v{d.current_version_no}{d.tags.length ? ` · ${d.tags.slice(0, 3).join(' · ')}` : ''}</span>
                      </span>
                      <ExpiryBadge doc={d} />
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </Section>
  )
}
