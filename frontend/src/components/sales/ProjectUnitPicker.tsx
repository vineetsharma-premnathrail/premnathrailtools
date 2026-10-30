'use client'

// Project picker for the departments (Design, Purchase, Store, Production,
// Quality, Dispatch): links a record to a project (PEW-82). One project = one
// machine, so a project made in Project Management has no units — its row
// ("PEW-82 · Central Railway · machine MC-1042", project_level) links the work
// to the project itself. Only an old sales-order project still lists its
// units — a vehicle or lot ("PEW-78 / 01 · Vehicle 1 · Central Railway").
// Server search against GET /projects/units/lookup — only live projects and
// live units are offered. ProjectUnitChip is the read-only display. The OrderProject* names at the bottom are kept so pages that still
// use them keep compiling; new code uses the ProjectUnit* names.
import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen } from '@phosphor-icons/react'
import SearchableSelect, { SearchableOption } from '@/components/erp/SearchableSelect'
import { projectsApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import type { ProjectUnitLookupItem } from '@/types'

export interface ProjectUnitValue {
  projectId: number
  elementId: number | null
}

const keyOf = (projectId: number, elementId: number | null) => `${projectId}:${elementId ?? ''}`

export default function ProjectUnitPicker({
  value,
  onChange,
  requireElement = true,
  kind,
  placeholder,
  disabled = false,
}: {
  value: ProjectUnitValue | null
  /** Gets the picked value and its lookup row (labels for display / snapshots). */
  onChange: (v: ProjectUnitValue | null, item: ProjectUnitLookupItem | null) => void
  /** true (default): a project without units, or a unit of an old sales-order project, must be picked;
   *  false: "whole project" rows of old sales-order projects are offered too. */
  requireElement?: boolean
  /** Only vehicles or only lots. */
  kind?: 'vehicle' | 'lot'
  placeholder?: string
  disabled?: boolean
}) {
  const [items, setItems] = useState<ProjectUnitLookupItem[]>([])
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<ProjectUnitLookupItem | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback((q: string) => {
    projectsApi.unitsLookup({ q: q || undefined, kind, include_projects: !requireElement })
      .then((rows) => { setItems(rows); setError('') })
      .catch((err) => {
        const msg = extractErrorMessages(err, 'Could not load projects. Check your connection and reload the page.')
        setError(Array.isArray(msg) ? msg.join(' ') : msg)
      })
  }, [kind, requireElement])

  useEffect(() => { load('') }, [load])

  // A value set from outside (an existing record) that the first page of the
  // lookup doesn't contain: fetch its row once so its label shows.
  const valueKey = value ? keyOf(value.projectId, value.elementId) : ''
  const pickedKey = picked ? keyOf(picked.project_id, picked.element_id) : ''
  useEffect(() => {
    if (!value || valueKey === pickedKey) return
    let ignore = false
    projectsApi.unitsLookup({ project_id: value.projectId, include_projects: true })
      .then((rows) => {
        const row = rows.find((i) => keyOf(i.project_id, i.element_id) === valueKey)
        if (row && !ignore) setPicked(row)
      })
      .catch(() => { /* the label stays blank; the save validates the value */ })
    return () => { ignore = true }
  }, [value, valueKey, pickedKey])

  const onSearch = (q: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => load(q.trim()), 250)
  }

  const shown = [...items]
  if (picked && pickedKey === valueKey && !shown.some((i) => keyOf(i.project_id, i.element_id) === pickedKey)) shown.unshift(picked)
  const options: SearchableOption[] = shown.map((i) => ({ value: keyOf(i.project_id, i.element_id), label: i.display }))

  return (
    <div>
      <SearchableSelect
        value={value ? keyOf(value.projectId, value.elementId) : ''}
        onChange={(v) => {
          if (!v) { onChange(null, null); return }
          const item = shown.find((i) => keyOf(i.project_id, i.element_id) === v) || null
          if (!item) return
          setPicked(item)
          onChange({ projectId: item.project_id, elementId: item.element_id }, item)
        }}
        options={options}
        onSearch={onSearch}
        disabled={disabled}
        placeholder={placeholder || (requireElement ? 'Pick project (or its vehicle / lot)…' : 'Pick project…')}
      />
      {error && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>{error}</div>}
    </div>
  )
}

/** Read-only "PEW-78 / 01 · Vehicle 1" chip. `onClick` makes it a button (e.g. open the project). */
export function ProjectUnitChip({ opNumber, elementNo, label, onClick, title }: {
  opNumber: string
  elementNo?: string | null
  label?: string | null
  onClick?: () => void
  title?: string
}) {
  const tail = elementNo ? elementNo.split('/').pop() : null
  const text = `${opNumber}${tail ? ` / ${tail}` : ''}${label ? ` · ${label}` : ''}`
  const style: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 9999,
    background: '#2563EB14', color: '#1d4ed8', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    border: '1px solid #2563EB33', cursor: onClick ? 'pointer' : 'default', fontFamily: 'inherit',
  }
  const body = <><FolderOpen size={14} />{text}{onClick ? <span aria-hidden>→</span> : null}</>
  return onClick
    ? <button type="button" onClick={onClick} title={title || 'Open the project'} style={style}>{body}</button>
    : <span title={title} style={style}>{body}</span>
}

/** @deprecated old names — use ProjectUnitValue / ProjectUnitChip / ProjectUnitPicker. */
export type OrderProjectValue = ProjectUnitValue
export const OrderProjectChip = ProjectUnitChip
