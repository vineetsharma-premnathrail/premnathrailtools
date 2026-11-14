'use client'

// Left side of the Knowledge Hub: the folder tree with a ⋯ menu per folder.

import { CaretDown, CaretRight, Folder, FolderOpen, LockSimple } from '@phosphor-icons/react'
import { TEXT } from '@/lib/theme'
import { folderTotal, type FolderNode, type LibFolder } from '@/lib/salesLibraryApi'
import { RowMenu, type MenuItem } from '@/components/crm/library/libraryUi'

export default function FolderTree({ tree, folders, selectedId, expanded, onSelect, onToggle, menuFor }: {
  tree: FolderNode[]
  /** Flat list, for the document totals per folder (sub-folders included). */
  folders: LibFolder[]
  selectedId: number | null
  expanded: Set<number>
  onSelect: (id: number | null) => void
  onToggle: (id: number) => void
  /** Menu entries for one folder (already limited to what this person may do). */
  menuFor: (f: LibFolder) => MenuItem[]
}) {
  const rows: { node: FolderNode; depth: number }[] = []
  const walk = (nodes: FolderNode[], depth: number) => {
    for (const n of nodes) {
      rows.push({ node: n, depth })
      if (expanded.has(n.id)) walk(n.children, depth + 1)
    }
  }
  walk(tree, 0)

  return (
    <nav aria-label="Folders" data-tour="lib-tree" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <button type="button" onClick={() => onSelect(null)} aria-current={selectedId === null ? 'page' : undefined}
        style={rowStyle(selectedId === null)}>
        <FolderOpen size={16} aria-hidden="true" color="#c2410c" />
        <span style={{ flex: 1, textAlign: 'left', fontWeight: 700 }}>Knowledge Hub</span>
      </button>
      {rows.map(({ node, depth }) => {
        const open = expanded.has(node.id)
        const active = selectedId === node.id
        const items = menuFor(node)
        return (
          <div key={node.id} style={{ display: 'flex', alignItems: 'center', gap: 2, paddingLeft: depth * 16 }}>
            {node.children.length > 0
              ? <button type="button" aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`} aria-expanded={open} onClick={() => onToggle(node.id)}
                  style={{ flex: 'none', width: 22, height: 28, border: 'none', background: 'transparent', cursor: 'pointer', color: TEXT.muted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                  {open ? <CaretDown size={13} aria-hidden="true" /> : <CaretRight size={13} aria-hidden="true" />}
                </button>
              : <span style={{ flex: 'none', width: 22 }} />}
            <button type="button" onClick={() => onSelect(node.id)} aria-current={active ? 'page' : undefined} title={node.description || node.name}
              style={{ ...rowStyle(active), flex: 1, minWidth: 0 }}>
              {open || active ? <FolderOpen size={16} aria-hidden="true" color="#c2410c" /> : <Folder size={16} aria-hidden="true" color="#78716c" />}
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
              {node.is_confidential && <LockSimple size={12} aria-label="Confidential" color="#b45309" />}
              <span style={{ flex: 'none', fontSize: 11.5, color: TEXT.muted }}>{folderTotal(folders, node.id)}</span>
            </button>
            <RowMenu items={items} label={`Folder actions for ${node.name}`} />
          </div>
        )
      })}
      {rows.length === 0 && <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '8px 4px' }}>No folders yet.</p>}
    </nav>
  )
}

function rowStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 28, padding: '4px 8px', border: 'none', borderRadius: 8,
    background: active ? 'rgba(255,122,69,0.12)' : 'transparent', color: active ? '#9a3412' : '#1f1108',
    fontSize: 13, fontWeight: active ? 700 : 500, fontFamily: 'inherit', cursor: 'pointer',
  }
}
