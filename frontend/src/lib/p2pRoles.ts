// Manager-role approval matrix for P2P — mirror of PR_APPROVAL_ROLE_SETS /
// PO_APPROVAL_ROLE_SETS in backend/app/modules/p2p/models/p2p_request.py.
// Which roles sign a PR (all of them) and a PO (any ONE of them) depends on
// whether the requisition is for an existing project or a new project.

import { User } from '@/types'

export type P2PProjectType = 'existing' | 'new'

export const PR_APPROVAL_ROLE_SETS: Record<P2PProjectType, string[]> = {
  existing: ['design_manager', 'production_manager', 'project_manager', 'store_manager'],
  new: ['rnd_manager', 'production_manager', 'store_manager'],
}

export const PO_APPROVAL_ROLE_SETS: Record<P2PProjectType, string[]> = {
  existing: ['director'],
  new: ['director'],
}

/** Role key -> the User boolean flag that marks a holder of that role.
 * Used for PO approval fan-out only — PR approver pickers are NOT filtered
 * by these flags (the requester picks any user per role slot). */
export const P2P_ROLE_FLAGS: Record<string, string> = {
  design_manager: 'is_design_manager',
  rnd_manager: 'is_rnd_manager',
  production_manager: 'is_production_manager',
  project_manager: 'is_project_manager',
  store_manager: 'is_store_manager',
  purchase_manager: 'is_purchase_manager',
  director: 'is_director',
  // Legacy roles still carried by PRs raised before the matrix.
  purchase_head: 'is_purchase_head',
  md: 'is_md',
}

export const P2P_ROLE_LABELS: Record<string, string> = {
  design_manager: 'Design Manager',
  rnd_manager: 'R&D Manager',
  production_manager: 'Production Manager',
  project_manager: 'Project Manager',
  store_manager: 'Store Manager',
  purchase_manager: 'Purchase Manager',
  director: 'Director',
  department_head: 'Department Head',
  project_head: 'Project Head',
  plant_head: 'Plant Head',
  purchase_head: 'Purchase Head',
  md: 'MD',
}

export const p2pRoleLabel = (role?: string | null): string => (role ? P2P_ROLE_LABELS[role] || role : '')

/** Which of this PR's PO-approval roles the user holds. Legacy PRs (no
 * project_type) fall back to the old Purchase Head / Director / MD chain. */
export function userPoRoles(user: User | null | undefined, pr: { project_type?: P2PProjectType | null }): string[] {
  if (!user) return []
  const roleSet = pr.project_type ? PO_APPROVAL_ROLE_SETS[pr.project_type] : ['purchase_head', 'director', 'md']
  const flags = user as unknown as Record<string, boolean>
  return roleSet.filter((role) => !!flags[P2P_ROLE_FLAGS[role]])
}
