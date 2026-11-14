'use client'

// CRM › Knowledge Hub — folder tree, documents, preview, versions, upload / share.
// Spec: docs/agent-runs/2026-11-12-sales-library/spec.md

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Folder, LockSimple, Star } from '@phosphor-icons/react'
import { useRequireApp } from '@/hooks/useAuth'
import { useCan } from '@/lib/permissions'
import { useRecordId } from '@/lib/recordRef'
import { TEXT } from '@/lib/theme'
import { formatDate } from '@/lib/format'
import CrmNav from '@/components/crm/CrmNav'
import FilterMenu from '@/components/shared/FilterMenu'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
import { RowCount, TableScroll, inputStyle, primaryBtnStyle, secondaryBtnStyle, tdStyle, thStyle, pillStyle, smallPrimaryBtnStyle } from '@/components/shared/ui'
import {
  FILE_KIND_LABEL, buildFolderTree, folderPath, folderTotal, salesLibraryApi, sortDocuments, sortFolders,
  type LibDocument, type LibDocumentQuery, type LibFolder, type LibSummary,
} from '@/lib/salesLibraryApi'
import FolderTree from '@/components/crm/library/FolderTree'
import FolderSheet, { type FolderSheetMode } from '@/components/crm/library/FolderSheet'
import UploadSheet from '@/components/crm/library/UploadSheet'
import DocumentDrawer from '@/components/crm/library/DocumentDrawer'
import {
  ExpiryBadge, FileTypeBadge, LIBRARY_PATH, LinkChips, documentHref, errorText, RemoteSelect, useRemotePicker, type MenuItem,
} from '@/components/crm/library/libraryUi'

type Filters = { file_kind: string; product: string; project: string; org: string; favorites: string; expiry: string }
const NO_FILTERS: Filters = { file_kind: '', product: '', project: '', org: '', favorites: '', expiry: '' }
/** `product: null` = follow the ?product= link; any string (even '') is what the person chose. */
type RawFilters = Omit<Filters, 'product'> & { product: string | null }
const START_FILTERS: RawFilters = { ...NO_FILTERS, product: null }

export default function SalesLibraryPage() {
  const { isAuthorized: hasApp, isLoading } = useRequireApp('crm')
  const { can, canDelete } = useCan()
  const router = useRouter()
  const searchParams = useSearchParams()
  const allowed = hasApp && can('crm', 'sales_library', 'view')
  useEffect(() => { if (!isLoading && hasApp && !allowed) router.push('/dashboard/crm') }, [isLoading, hasApp, allowed, router])

  const canCreate = can('crm', 'sales_library', 'create')
  const canEdit = can('crm', 'sales_library', 'edit')

  const [folders, setFolders] = useState<LibFolder[]>([])
  const [summary, setSummary] = useState<LibSummary | null>(null)
  const [docs, setDocs] = useState<LibDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [selected, setSelected] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [rawFilters, setFilters] = useState<RawFilters>(START_FILTERS)
  const [allDocs, setAllDocs] = useState(false)

  const [localDocId, setLocalDocId] = useState<number | null>(null)
  const [upload, setUpload] = useState<{ folderId: number | null } | null>(null)
  const [folderSheet, setFolderSheet] = useState<{ mode: FolderSheetMode; folder?: LibFolder; parentId?: number | null } | null>(null)
  const [deleteFolder, setDeleteFolder] = useState<LibFolder | null>(null)

  // Product / project / customer filters search the server as you type (View on the Knowledge Hub is enough).
  const productPick = useRemotePicker('product')
  const projectPick = useRemotePicker('project')
  const orgPick = useRemotePicker('organization')

  // Signed deep links: ?doc=<ref> (or ?id=<ref>) opens a document, ?product=<ref> filters by a product.
  const docRef = searchParams.get('doc') ?? searchParams.get('id')
  const { id: urlDocId, error: docLinkError } = useRecordId(docRef)
  const { id: urlProductId } = useRecordId(searchParams.get('product'))
  const openDocId = urlDocId ?? localDocId
  const filters = useMemo<Filters>(() => ({ ...rawFilters, product: rawFilters.product ?? (urlProductId ? String(urlProductId) : '') }), [rawFilters, urlProductId])

  // Search box → query (word-by-word match is done by the server).
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const filtersOn = Object.values(filters).some(Boolean)
  const globalMode = !!q || filtersOn || allDocs
  const rootView = !globalMode && selected === null

  const tree = useMemo(() => buildFolderTree(folders), [folders])
  const children = useMemo(() => (selected === null ? tree : sortFolders(folders.filter((f) => f.parent_id === selected))), [tree, folders, selected])
  const selectedFolder = folders.find((f) => f.id === selected) ?? null

  // ---- loading ----
  const loadFolders = useCallback(async () => {
    try {
      const [f, s] = await Promise.all([salesLibraryApi.folders(), salesLibraryApi.summary()])
      setFolders(f); setSummary(s); setError('')
    } catch (err) {
      setError(await errorText(err, 'The Knowledge Hub could not be loaded. Check your connection and reload the page; if it keeps failing, ask an admin to check the SharePoint connection.'))
    }
  }, [])

  const docParams = useMemo<LibDocumentQuery | null>(() => {
    if (rootView) return null
    if (!globalMode) return { folder_id: selected ?? undefined }
    return {
      q: q || undefined, file_kind: filters.file_kind || undefined,
      product_id: filters.product ? Number(filters.product) : undefined,
      project_id: filters.project ? Number(filters.project) : undefined,
      organization_id: filters.org ? Number(filters.org) : undefined,
      favorites: filters.favorites === 'true' || undefined,
      expiry: (filters.expiry as 'expired' | 'expiring') || undefined,
    }
  }, [rootView, globalMode, selected, q, filters])

  const reqId = useRef(0)
  const loadDocs = useCallback(async () => {
    // Bumped first, so a slow answer for a folder that was left can never paint into the root view.
    const my = ++reqId.current
    if (!docParams) { setDocs([]); setLoading(false); return }
    setLoading(true)
    try {
      const rows = await salesLibraryApi.documents(docParams)
      if (my === reqId.current) { setDocs(rows); setError('') }
    } catch (err) {
      if (my === reqId.current) setError(await errorText(err, 'The documents could not be loaded. Reload the page and try again.'))
    } finally {
      if (my === reqId.current) setLoading(false)
    }
  }, [docParams])

  // Deferred so the effects themselves set no state.
  useEffect(() => { if (allowed) Promise.resolve().then(loadFolders) }, [allowed, loadFolders])
  useEffect(() => { if (allowed) Promise.resolve().then(loadDocs) }, [allowed, loadDocs])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 7000)
    return () => clearTimeout(t)
  }, [notice])

  const refreshAll = () => { loadFolders(); loadDocs() }

  // ---- navigation ----
  const selectFolder = (id: number | null) => {
    setSelected(id); setSearch(''); setQ(''); setFilters({ ...NO_FILTERS }); setAllDocs(false)
    if (id !== null) {
      const open = new Set(expanded)
      let cur = folders.find((f) => f.id === id)
      while (cur?.parent_id != null) { open.add(cur.parent_id); cur = folders.find((f) => f.id === cur!.parent_id) }
      setExpanded(open)
    }
  }
  const toggleExpand = (id: number) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const clearAll = () => { setSearch(''); setQ(''); setFilters({ ...NO_FILTERS }); setAllDocs(false) }

  // The address keeps every other parameter (e.g. ?product=) while a document is opened or closed.
  const withDoc = (ref: string | null): string => {
    const sp = new URLSearchParams(searchParams.toString())
    sp.delete('id'); sp.delete('doc')
    if (ref) sp.set('doc', ref)
    const qs = sp.toString()
    return qs ? `${LIBRARY_PATH}?${qs}` : LIBRARY_PATH
  }
  const openDoc = (d: LibDocument) => {
    if (documentHref(d) && d.id_ref) router.replace(withDoc(d.id_ref), { scroll: false })
    else setLocalDocId(d.id)
  }
  const closeDoc = () => {
    setLocalDocId(null)
    if (docRef) router.replace(withDoc(null), { scroll: false })
  }

  const toggleFavorite = async (d: LibDocument) => {
    const next = !d.is_favorite
    setDocs((rows) => rows.map((r) => (r.id === d.id ? { ...r, is_favorite: next } : r)))
    try {
      await salesLibraryApi.favorite(d.id, next)
      if (filters.favorites === 'true' && !next) loadDocs()
    } catch (err) {
      setDocs((rows) => rows.map((r) => (r.id === d.id ? { ...r, is_favorite: !next } : r)))
      setError(await errorText(err, 'The favourite could not be saved. Try again.'))
    }
  }

  const folderMenu = (f: LibFolder): MenuItem[] => {
    const items: MenuItem[] = []
    if (canCreate) items.push({ label: 'New sub-folder', onClick: () => setFolderSheet({ mode: 'create', parentId: f.id }) })
    if (canEdit) {
      items.push({ label: 'Edit folder', onClick: () => setFolderSheet({ mode: 'edit', folder: f }) })
      items.push({ label: 'Move', onClick: () => setFolderSheet({ mode: 'move', folder: f }) })
    }
    if (canDelete('crm', 'sales_library', f.created_by_id)) items.push({ label: 'Delete', danger: true, onClick: () => setDeleteFolder(f) })
    return items
  }

  const removeFolder = async () => {
    const f = deleteFolder
    setDeleteFolder(null)
    if (!f) return
    try {
      await salesLibraryApi.deleteFolder(f.id)
      setNotice(`Folder “${f.name}” was deleted.`)
      if (selected === f.id) selectFolder(f.parent_id)
      refreshAll()
    } catch (err) {
      setError(await errorText(err, 'The folder could not be deleted. Only an empty folder can be deleted — move or delete what is inside first.'))
    }
  }

  const sortedDocs = useMemo(() => sortDocuments(docs), [docs])

  if (isLoading || !allowed) return null

  const setFilter = (k: string, v: string) => { setAllDocs(false); setFilters((f) => ({ ...f, [k]: v })) }
  const counts = summary ?? { folders: folders.length, documents: 0, videos: 0, expired: 0, expiring_30d: 0, recent: [] }

  // Breadcrumb
  const crumbs: { id: number | null; name: string }[] = [{ id: null, name: 'Knowledge Hub' }]
  if (!globalMode && selectedFolder) {
    const chain: LibFolder[] = []
    let cur: LibFolder | undefined = selectedFolder
    while (cur) { chain.unshift(cur); cur = cur.parent_id != null ? folders.find((f) => f.id === cur!.parent_id) : undefined }
    chain.forEach((f) => crumbs.push({ id: f.id, name: f.name }))
  }

  const emptyFolder = !!selectedFolder && !globalMode && !loading && docs.length === 0 && children.length === 0

  return (
    <div>
      <CrmNav />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT.heading, margin: 0 }}>Knowledge Hub</h1>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '4px 0 0' }}>All product, project and sales material in one place</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canCreate && <button type="button" data-tour="lib-new-folder" style={secondaryBtnStyle} onClick={() => setFolderSheet({ mode: 'create', parentId: selected })}>+ New folder</button>}
          {canCreate && <button type="button" data-tour="lib-upload" style={primaryBtnStyle} onClick={() => setUpload({ folderId: selected })}>+ Upload</button>}
        </div>
      </div>

      {error && <div role="alert" style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      {docLinkError && <div role="alert" style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>{docLinkError}</div>}
      {notice && <div role="status" style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', color: '#166534', fontSize: 13 }}>{notice}</div>}

      <div data-tour="lib-counts" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <CountCard label="Folders" value={counts.folders} hex="#3b82f6" active={rootView} onClick={() => { selectFolder(null) }} />
        <CountCard label="Documents" value={counts.documents} hex="#16a34a" active={allDocs && !q && !filtersOn} onClick={() => { if (allDocs) clearAll(); else { setSelected(null); setSearch(''); setQ(''); setFilters({ ...NO_FILTERS }); setAllDocs(true) } }} />
        <CountCard label="Videos" value={counts.videos} hex="#7c3aed" active={filters.file_kind === 'video'} onClick={() => setFilter('file_kind', filters.file_kind === 'video' ? '' : 'video')} />
        <CountCard label="Expired" value={counts.expired} hex="#dc2626" active={filters.expiry === 'expired'} onClick={() => setFilter('expiry', filters.expiry === 'expired' ? '' : 'expired')} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <input data-tour="lib-search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the Knowledge Hub"
          placeholder="Search title, tags, file name or product — any word order (e.g. rrv demo)…"
          style={{ ...inputStyle, flex: '1 1 280px', maxWidth: 520, width: 'auto' }} />
        <FilterMenu tourId="lib-filter"
          fields={[
            { key: 'file_kind', label: 'File type', value: filters.file_kind, allLabel: 'All types', options: Object.entries(FILE_KIND_LABEL).map(([value, label]) => ({ value, label })) },
            { key: 'favorites', label: 'Favourites', value: filters.favorites, allLabel: 'All documents', options: [{ value: 'true', label: 'My favourites only' }] },
            { key: 'expiry', label: 'Expiry', value: filters.expiry, allLabel: 'Any expiry', options: [{ value: 'expired', label: 'Expired' }, { value: 'expiring', label: 'Expiring within 30 days' }] },
          ]}
          onChange={(k, v) => setFilter(k, v)}
          extraActive={[filters.product, filters.project, filters.org].filter(Boolean).length}
          onClear={() => { setAllDocs(false); setFilters({ ...NO_FILTERS }) }}>
          <FilterPick label="Product" kind="product" picker={productPick} value={filters.product} allLabel="All products" fallback="Chosen product" onChange={(v) => setFilter('product', v)} />
          <FilterPick label="Project" kind="project" picker={projectPick} value={filters.project} allLabel="All projects" fallback="Chosen project" onChange={(v) => setFilter('project', v)} />
          <FilterPick label="Customer" kind="organization" picker={orgPick} value={filters.org} allLabel="All customers" fallback="Chosen customer" onChange={(v) => setFilter('org', v)} />
        </FilterMenu>
        {(q || filtersOn || allDocs) && <button type="button" style={secondaryBtnStyle} onClick={clearAll}>Clear</button>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <aside style={{ flex: '1 1 250px', maxWidth: 340, minWidth: 0, padding: 10, borderRadius: 14, background: '#fff', border: '1px solid rgba(15,23,42,0.10)' }}>
          <FolderTree tree={tree} folders={folders} selectedId={globalMode ? null : selected} expanded={expanded} onSelect={selectFolder} onToggle={toggleExpand} menuFor={folderMenu} />
        </aside>

        <section style={{ flex: '3 1 520px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, fontSize: 13 }}>
            {globalMode
              ? <><strong style={{ color: TEXT.heading }}>{q ? `Results for “${q}”` : allDocs && !filtersOn ? 'All documents' : 'Filtered documents'}</strong><span style={{ color: TEXT.muted }}>across every folder you can see · {loading ? 'loading…' : `${docs.length} found`}</span></>
              : crumbs.map((c, i) => (
                <span key={`${c.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {i > 0 && <span aria-hidden="true" style={{ color: '#a8a29e' }}>›</span>}
                  {i < crumbs.length - 1
                    ? <button type="button" onClick={() => selectFolder(c.id)} style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', color: '#c2410c', fontWeight: 600, cursor: 'pointer' }}>{c.name}</button>
                    : <strong style={{ color: TEXT.heading }}>{c.name}</strong>}
                </span>
              ))}
          </div>

          {rootView && (
            <div data-tour="lib-recent" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 13.5, fontWeight: 700, color: '#1f1108', margin: '0 0 8px' }}>Recently added</h2>
              {(counts.recent ?? []).length === 0
                ? <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>Nothing uploaded yet.{canCreate ? ' Use “+ Upload” to add the first file.' : ''}</p>
                : (
                  <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
                    {counts.recent.map((d) => (
                      // ui-audit-ignore-next-line custom-button — a file card (badge + title), not an action button
                      <button key={d.id} type="button" onClick={() => openDoc(d)} title={`${d.title} — ${d.folder_path ?? ''}`}
                        style={{ flex: '0 0 220px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(15,23,42,0.10)', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <FileTypeBadge kind={d.file_kind} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1f1108', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</span>
                          <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.folder_path || '—'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
            </div>
          )}

          {emptyFolder ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', borderRadius: 14, border: '1px dashed rgba(15,23,42,0.18)', background: 'rgba(255,255,255,.6)' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: TEXT.heading, margin: '0 0 4px' }}>This folder is empty</p>
              <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 14px' }}>{canCreate ? 'Upload the first file here, or create a sub-folder to organise it further.' : 'Nothing has been added to it yet.'}</p>
              {canCreate && <button type="button" style={smallPrimaryBtnStyle} onClick={() => setUpload({ folderId: selected })}>+ Upload to this folder</button>}
            </div>
          ) : (
            <div data-tour="lib-table">
              <TableScroll minWidth={globalMode ? 880 : 760}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Title<RowCount count={docs.length + (globalMode ? 0 : children.length)} /></th>
                      {globalMode && <th style={thStyle}>Folder</th>}
                      <th style={thStyle}>Linked to</th>
                      <th style={thStyle}>Version</th>
                      <th style={thStyle}>Expiry</th>
                      <th style={thStyle}>Updated</th>
                      <th style={{ ...thStyle, width: 44 }}><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Favourite</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {!globalMode && children.map((f) => (
                      <tr key={`f-${f.id}`} onClick={() => selectFolder(f.id)} style={{ cursor: 'pointer' }}>
                        <td style={tdStyle} colSpan={globalMode ? 7 : 6}>
                          <button type="button" onClick={(e) => { e.stopPropagation(); selectFolder(f.id) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, border: 'none', background: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: '#1f1108', textAlign: 'left' }}>
                            <span style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(255,122,69,0.12)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Folder size={18} color="#c2410c" aria-hidden="true" /></span>
                            <span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                                {f.name}
                                {f.is_confidential && <LockSimple size={13} color="#b45309" aria-label="Confidential" />}
                                {f.is_pricing && <span style={pillStyle('#d97706')}>Pricing</span>}
                              </span>
                              <span style={{ fontSize: 12, color: TEXT.muted }}>{f.description || `${folderTotal(folders, f.id)} ${folderTotal(folders, f.id) === 1 ? 'document' : 'documents'}`}</span>
                            </span>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {sortedDocs.map((d) => (
                      <tr key={d.id} onClick={() => openDoc(d)} style={{ cursor: 'pointer' }}>
                        <td style={tdStyle}>
                          <button type="button" onClick={(e) => { e.stopPropagation(); openDoc(d) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, border: 'none', background: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: '#1f1108', textAlign: 'left', maxWidth: 420 }}>
                            <FileTypeBadge kind={d.file_kind} />
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: 'block', fontWeight: 600, overflowWrap: 'anywhere' }}>{d.title}</span>
                              {d.tags.length > 0 && <span style={{ display: 'block', fontSize: 11.5, color: TEXT.muted }}>{d.tags.slice(0, 4).join(' · ')}</span>}
                            </span>
                          </button>
                        </td>
                        {globalMode && <td style={{ ...tdStyle, color: TEXT.muted }}>{d.folder_path || folderPath(folders, d.folder_id) || '—'}</td>}
                        <td style={tdStyle}><LinkChips links={d.links} /></td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>v{d.current_version_no}</td>
                        <td style={tdStyle}><ExpiryBadge doc={d} /></td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: TEXT.muted }}>{d.updated_at ? formatDate(d.updated_at) : '—'}</td>
                        <td style={tdStyle}>
                          <button type="button" aria-pressed={d.is_favorite} aria-label={d.is_favorite ? `Remove ${d.title} from favourites` : `Add ${d.title} to favourites`}
                            onClick={(e) => { e.stopPropagation(); toggleFavorite(d) }}
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, display: 'inline-flex' }}>
                            <Star size={17} weight={d.is_favorite ? 'fill' : 'regular'} color={d.is_favorite ? '#d97706' : '#a8a29e'} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {loading && docs.length === 0 && !rootView && (
                      <tr><td colSpan={globalMode ? 7 : 6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>Loading…</td></tr>
                    )}
                    {!loading && globalMode && docs.length === 0 && (
                      <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>
                        {q || filtersOn ? 'No documents match this search or these filters. Try fewer words, or press Clear.' : 'No documents yet — use “+ Upload” to add the first file.'}
                      </td></tr>
                    )}
                    {rootView && children.length === 0 && !loading && (
                      <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: TEXT.muted }}>No folders yet.{canCreate ? ' Use “+ New folder” to create the first one.' : ''}</td></tr>
                    )}
                  </tbody>
                </table>
              </TableScroll>
            </div>
          )}
        </section>
      </div>

      {openDocId !== null && (
        <DocumentDrawer key={openDocId} docId={openDocId} folders={folders} onClose={closeDoc} onNotice={setNotice}
          onChanged={(deleted) => { if (deleted) closeDoc(); refreshAll() }} />
      )}

      {upload && (
        <UploadSheet folders={folders} folderId={upload.folderId} onClose={() => setUpload(null)}
          onDone={(saved, complete) => {
            if (complete) { setUpload(null); setNotice(saved.length === 1 ? `“${saved[0].title}” was uploaded.` : `${saved.length} files were uploaded.`) }
            refreshAll()
          }} />
      )}

      {folderSheet && (
        <FolderSheet mode={folderSheet.mode} folders={folders} folder={folderSheet.folder} parentId={folderSheet.parentId} onClose={() => setFolderSheet(null)}
          onSaved={(f) => {
            const mode = folderSheet.mode
            setFolderSheet(null)
            setNotice(mode === 'create' ? `Folder “${f.name}” was created.` : mode === 'move' ? `Folder “${f.name}” was moved.` : `Folder “${f.name}” was saved.`)
            if (mode === 'create' && f.parent_id != null) setExpanded((s) => new Set(s).add(f.parent_id as number))
            refreshAll()
          }} />
      )}

      <ConfirmDialog open={!!deleteFolder} title="Delete folder?"
        message={deleteFolder ? `The folder “${deleteFolder.name}” will be deleted. A folder can only be deleted when it has no sub-folders and no documents; if it is not empty you will be told what is inside.` : ''}
        onConfirm={removeFolder} onCancel={() => setDeleteFolder(null)} />
    </div>
  )
}

function CountCard({ label, value, hex, active, onClick }: { label: string; value: number; hex: string; active: boolean; onClick: () => void }) {
  return (
    // ui-audit-ignore-next-line custom-button — count card used as a filter toggle, keeps the card look
    <button type="button" onClick={onClick} aria-pressed={active} title={active ? `Showing ${label} — click to show everything` : `Show ${label}`}
      style={{
        flex: '1 1 150px', minWidth: 130, maxWidth: 240, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: '12px 16px', borderRadius: 14,
        background: active ? `${hex}14` : '#fff', border: `${active ? 1.5 : 1}px solid ${active ? hex : 'rgba(15,23,42,0.10)'}`,
      }}>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, marginBottom: 4 }}>{label}</span>
      <span style={{ display: 'block', fontSize: 22, fontWeight: 700, color: hex }}>{value.toLocaleString('en-IN')}</span>
    </button>
  )
}

/** One server-searched filter inside the Filter panel (same look as the panel's own dropdowns). */
function FilterPick({ label, kind, picker, value, allLabel, fallback, onChange }: {
  label: string
  kind: 'product' | 'project' | 'organization'
  picker: ReturnType<typeof useRemotePicker>
  value: string
  allLabel: string
  fallback: string
  onChange: (v: string) => void
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#57534e' }}>
      {label}
      <RemoteSelect picker={picker} kind={kind} value={value} onChange={onChange} allLabel={allLabel} fallbackLabel={fallback} ariaLabel={label} />
    </label>
  )
}
