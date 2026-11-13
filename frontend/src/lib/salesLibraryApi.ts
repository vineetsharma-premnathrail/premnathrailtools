// CRM › Sales Library (/crm/library): folders, documents, versions, links, favourites, share.
// Kept in its own file so the shared api.ts is untouched. Contract: docs/agent-runs/2026-11-12-sales-library/spec.md §3.
import { apiClient } from '@/lib/api'
import { uploadToSession, type UploadSession } from '@/lib/largeUpload'

export type LibFileKind = 'pdf' | 'video' | 'image' | 'spreadsheet' | 'document' | 'presentation' | 'other'
export type LibLinkType = 'product' | 'project' | 'organization'

export interface LibFolder {
  id: number
  id_ref?: string
  parent_id: number | null
  name: string
  description?: string | null
  product_id?: number | null
  product_name?: string | null
  is_confidential: boolean
  is_pricing: boolean
  sort_order: number
  document_count: number
  created_by_id?: number | null
}

export interface LibLink {
  link_type: LibLinkType
  link_id: number
  /** Display name (product name, project number, organization name). */
  name?: string | null
}

export interface LibVersion {
  id: number
  version_no: number
  file_name: string
  file_size?: number | null
  mime_type?: string | null
  change_note?: string | null
  uploaded_by_id?: number | null
  uploaded_by_name?: string | null
  created_at?: string | null
}

export interface LibDocument {
  id: number
  id_ref?: string
  folder_id: number
  /** "Products › RRV" */
  folder_path?: string | null
  title: string
  description?: string | null
  file_kind: LibFileKind
  tags: string[]
  expiry_date?: string | null
  current_version_no: number
  /** Current version's file (name, size, mime). */
  file_name?: string | null
  file_size?: number | null
  mime_type?: string | null
  links: LibLink[]
  is_favorite: boolean
  is_expired: boolean
  created_by_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
  updated_at?: string | null
  /** Only on the single-document call. */
  versions?: LibVersion[]
}

export interface LibSummary {
  folders: number
  documents: number
  videos: number
  expired: number
  expiring_30d: number
  recent: LibDocument[]
}

export interface LibProductResourceGroup {
  folder_id: number
  folder_path: string
  documents: LibDocument[]
}

export interface LibDocumentQuery {
  folder_id?: number
  q?: string
  file_kind?: string
  product_id?: number
  project_id?: number
  organization_id?: number
  favorites?: boolean
  expiry?: 'expired' | 'expiring'
  include_subfolders?: boolean
}

export interface LibFolderPayload {
  name?: string
  parent_id?: number | null
  description?: string | null
  product_id?: number | null
  is_confidential?: boolean
  is_pricing?: boolean
}

export interface LibDocumentPatch {
  title?: string
  description?: string | null
  tags?: string[]
  expiry_date?: string | null
  folder_id?: number
  links?: { link_type: LibLinkType; link_id: number }[]
}

export interface LibCompleteUpload {
  title?: string
  description?: string
  tags?: string[]
  expiry_date?: string
  change_note?: string
  links?: { link_type: LibLinkType; link_id: number }[]
}

type RawDoc = Omit<LibDocument, 'links' | 'tags'> & {
  current_version?: { file_name?: string | null; file_size?: number | null; mime_type?: string | null } | null
  links?: (LibLink & { link_name?: string | null; label?: string | null })[] | null
  tags?: string[] | null
}

/** Reads a document row whichever way the API nests the current version and link names. */
function norm(d: RawDoc): LibDocument {
  return {
    ...d,
    tags: d.tags ?? [],
    file_name: d.file_name ?? d.current_version?.file_name ?? null,
    file_size: d.file_size ?? d.current_version?.file_size ?? null,
    mime_type: d.mime_type ?? d.current_version?.mime_type ?? null,
    links: (d.links ?? []).map((l) => ({ link_type: l.link_type, link_id: l.link_id, name: l.name ?? l.link_name ?? l.label ?? null })),
  }
}

const JSON_TIMEOUT = 30000

export const salesLibraryApi = {
  summary: async (): Promise<LibSummary> => {
    const { data } = await apiClient.get('/crm/library/summary')
    return { ...data, recent: ((data.recent ?? []) as RawDoc[]).map(norm) }
  },
  folders: async (): Promise<LibFolder[]> => (await apiClient.get('/crm/library/folders')).data,
  createFolder: async (payload: LibFolderPayload & { name: string }): Promise<LibFolder> =>
    (await apiClient.post('/crm/library/folders', payload)).data,
  updateFolder: async (id: number, payload: LibFolderPayload): Promise<LibFolder> =>
    (await apiClient.patch(`/crm/library/folders/${id}`, payload)).data,
  deleteFolder: async (id: number): Promise<void> => { await apiClient.delete(`/crm/library/folders/${id}`) },

  documents: async (params: LibDocumentQuery = {}): Promise<LibDocument[]> => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== false))
    const { data } = await apiClient.get('/crm/library/documents', { params: clean, timeout: JSON_TIMEOUT })
    return (data as RawDoc[]).map(norm)
  },
  document: async (id: number): Promise<LibDocument> => norm((await apiClient.get(`/crm/library/documents/${id}`)).data),
  updateDocument: async (id: number, payload: LibDocumentPatch): Promise<LibDocument> =>
    norm((await apiClient.patch(`/crm/library/documents/${id}`, payload)).data),
  deleteDocument: async (id: number): Promise<void> => { await apiClient.delete(`/crm/library/documents/${id}`) },
  favorite: async (id: number, on: boolean): Promise<void> => {
    if (on) await apiClient.post(`/crm/library/documents/${id}/favorite`)
    else await apiClient.delete(`/crm/library/documents/${id}/favorite`)
  },
  share: async (id: number, payload: { user_ids: number[]; message?: string }): Promise<{ sent: number; skipped: { reason: string }[] }> =>
    (await apiClient.post(`/crm/library/documents/${id}/share`, payload)).data,
  /** Short-lived SharePoint link (downloads, video playback). */
  downloadUrl: async (id: number, versionNo?: number): Promise<{ url: string; file_name?: string }> =>
    (await apiClient.get(`/crm/library/documents/${id}/download-url`, { params: versionNo ? { version_no: versionNo } : {} })).data,
  /** The file's bytes for the in-app preview (PDF, image). */
  content: async (id: number, versionNo?: number): Promise<Blob> =>
    (await apiClient.get(`/crm/library/documents/${id}/content`, { params: versionNo ? { version_no: versionNo } : {}, responseType: 'blob', timeout: 180000 })).data,
  productResources: async (productId: number): Promise<LibProductResourceGroup[]> => {
    const { data } = await apiClient.get(`/crm/library/products/${productId}/resources`)
    return (data as LibProductResourceGroup[]).map((g) => ({ ...g, documents: g.documents.map((d) => norm(d as RawDoc)) }))
  },

  /**
   * Uploads one file straight from the browser to SharePoint in chunks (any size), then records it:
   * a new document, or — with `documentId` — a new version of that document.
   */
  uploadFile: async (file: File, opts: { folderId: number; documentId?: number; meta?: LibCompleteUpload }): Promise<LibDocument> => {
    if (file.size === 0) throw new Error(`${file.name} is empty (0 bytes). Pick the real file and try again.`)
    const { data: session } = await apiClient.post<UploadSession & { upload_token: string }>('/crm/library/documents/upload-session', {
      folder_id: opts.folderId, file_name: file.name, file_size: file.size, mime_type: file.type || null,
      ...(opts.documentId ? { document_id: opts.documentId } : {}),
    }, { timeout: JSON_TIMEOUT })
    const item = await uploadToSession(file, session)
    const { data } = await apiClient.post('/crm/library/documents/complete-upload', {
      upload_token: session.upload_token, drive_item_id: item.id, ...(opts.meta ?? {}),
    }, { timeout: 120000 })
    return norm(data)
  },

  /** Search-as-you-type pickers for the link fields (View on the Sales Library is enough). `q` filters on the server; at most 50 rows. */
  pick: async (kind: 'product' | 'project' | 'organization', q = ''): Promise<{ id: number; code: string; name: string }[]> => {
    const path = kind === 'product' ? 'products' : kind === 'project' ? 'projects' : 'organizations'
    const { data } = await apiClient.get(`/crm/library/pickers/${path}`, { params: { ...(q ? { q } : {}), limit: 50 } })
    return (data as { id: number; code?: string | null; name?: string | null }[]).map((r) => ({ id: r.id, code: r.code || '', name: r.name || '' }))
  },
  listUsers: async (): Promise<{ id: number; name: string; email: string; department?: string | null }[]> =>
    (await apiClient.get('/users/directory')).data,
}

// ---- Display helpers -------------------------------------------------------

export const FILE_KIND_LABEL: Record<string, string> = {
  pdf: 'PDF', video: 'Video', image: 'Image', spreadsheet: 'Spreadsheet', document: 'Document', presentation: 'Presentation', other: 'Other',
}
export const FILE_KIND_HEX: Record<string, string> = {
  pdf: '#dc2626', video: '#7c3aed', image: '#9333ea', spreadsheet: '#16a34a', document: '#2563eb', presentation: '#ea580c', other: '#78716c',
}
/** Short badge text per kind (same look as the CRM document list). */
export const FILE_KIND_BADGE: Record<string, string> = {
  pdf: 'PDF', video: 'VID', image: 'IMG', spreadsheet: 'XLS', document: 'DOC', presentation: 'PPT', other: 'FILE',
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function fileExtension(name?: string | null): string {
  const n = name || ''
  const i = n.lastIndexOf('.')
  return i >= 0 ? n.slice(i + 1).toLowerCase() : ''
}

export const LINK_TYPE_LABEL: Record<LibLinkType, string> = { product: 'Product', project: 'Project', organization: 'Customer' }
export const LINK_TYPE_HEX: Record<LibLinkType, string> = { product: '#2563eb', project: '#ea580c', organization: '#16a34a' }

/** 'Products › RRV' → ['Products', 'RRV'] */
export function pathParts(path?: string | null): string[] {
  return (path || '').split('›').map((s) => s.trim()).filter(Boolean)
}

/** Folders sorted for display: sort_order, then name. */
export function sortFolders(rows: LibFolder[]): LibFolder[] {
  return [...rows].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name))
}

export function sortDocuments(rows: LibDocument[]): LibDocument[] {
  return [...rows].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }))
}

export type FolderNode = LibFolder & { children: FolderNode[] }

export function buildFolderTree(rows: LibFolder[]): FolderNode[] {
  const byId = new Map<number, FolderNode>()
  for (const f of rows) byId.set(f.id, { ...f, children: [] })
  const roots: FolderNode[] = []
  for (const f of sortFolders(rows)) {
    const node = byId.get(f.id)!
    const parent = f.parent_id != null ? byId.get(f.parent_id) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** Full path text of a folder ("Products › RRV"). */
export function folderPath(rows: LibFolder[], id: number | null | undefined): string {
  const byId = new Map(rows.map((f) => [f.id, f]))
  const names: string[] = []
  const seen = new Set<number>()
  let cur = id != null ? byId.get(id) : undefined
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    names.unshift(cur.name)
    cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined
  }
  return names.join(' › ')
}

/** Ids of a folder and everything inside it. */
export function folderAndDescendantIds(rows: LibFolder[], id: number): Set<number> {
  const out = new Set<number>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of rows) {
      if (f.parent_id != null && out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); grew = true }
    }
  }
  return out
}

/** Every folder as a pick-list entry, in tree order, labelled by its full path. */
export function folderOptions(rows: LibFolder[]): { id: number; label: string }[] {
  const out: { id: number; label: string }[] = []
  const walk = (nodes: FolderNode[], prefix: string) => {
    for (const n of nodes) {
      const label = prefix ? `${prefix} › ${n.name}` : n.name
      out.push({ id: n.id, label })
      walk(n.children, label)
    }
  }
  walk(buildFolderTree(rows), '')
  return out
}

/** Documents in a folder and everything under it (the API's document_count is direct documents only). */
export function folderTotal(rows: LibFolder[], id: number): number {
  const ids = folderAndDescendantIds(rows, id)
  return rows.filter((f) => ids.has(f.id)).reduce((n, f) => n + (f.document_count || 0), 0)
}

/** True when the folder or any folder above it is a Pricing folder (documents in it need an expiry date). */
export function isPricingFolder(rows: LibFolder[], id: number | null | undefined): boolean {
  return chainHas(rows, id, (f) => f.is_pricing)
}

/** True when the folder or any folder above it is Confidential (the server hides it from people without that access). */
export function isConfidentialFolder(rows: LibFolder[], id: number | null | undefined): boolean {
  return chainHas(rows, id, (f) => f.is_confidential)
}

function chainHas(rows: LibFolder[], id: number | null | undefined, test: (f: LibFolder) => boolean): boolean {
  const byId = new Map(rows.map((f) => [f.id, f]))
  const seen = new Set<number>()
  let cur = id != null ? byId.get(id) : undefined
  while (cur && !seen.has(cur.id)) {
    if (test(cur)) return true
    seen.add(cur.id)
    cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined
  }
  return false
}
