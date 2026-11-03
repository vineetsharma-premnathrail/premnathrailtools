'use client'

import { SheetColumns } from '@/components/shared/FormSheet'
import type { VisibilityApi } from '@/lib/visibility'

/** SheetColumns that drops the right-hand column when the role hides every section in it, so no empty grey
 *  column is left behind (the preview always draws both columns). `force` keeps the column when something in it
 *  is shown regardless of the role rule (e.g. a field the chosen type requires). */
export function VisColumns({ vis, rightKeys, left, right, force }: { vis: VisibilityApi; rightKeys: string[]; left: React.ReactNode; right: React.ReactNode; force?: boolean }) {
  if (force || vis.anySection(rightKeys)) return <SheetColumns left={left} right={right} />
  return <div style={{ padding: '20px 24px' }}>{left}</div>
}
