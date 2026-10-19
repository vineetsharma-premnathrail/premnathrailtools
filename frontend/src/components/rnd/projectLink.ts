import { useState } from 'react'
import { recordHref, useRecordId } from '@/lib/recordRef'

/** Apply a `?project_id=<ref>` link to a page's project filter/select (which keeps
 *  the numeric id as its value). `loading` is true while the ref is being
 *  resolved; `error` is set when the link was edited. */
export function useUrlProjectId(ref: string | null, apply: (projectId: string) => void) {
  const { id, error, loading } = useRecordId(ref)
  const [applied, setApplied] = useState<number | null>(null)
  if (id !== null && id !== applied) {
    setApplied(id)
    apply(String(id))
  }
  return { error, loading }
}

/** `base?project_id=<ref>` for the selected project (numeric id from a select), or
 *  just `base` when none is selected or the project list has not loaded. */
export function projectLinkHref(base: string, projects: { id: number }[], projectId: string): string {
  const project = projectId ? projects.find((p) => String(p.id) === projectId) : undefined
  return project ? recordHref(base, project, 'id', undefined, 'project_id') : base
}
