import { useCan, type PermissionAction } from '@/lib/permissions'

/**
 * Role-level Design features (Design › tab › feature, see
 * backend/app/core/features/design.py). Same rule as the backend
 * (modules/design/features.py): the feature gate applies only to users who
 * hold that tab's View — someone reaching a record without the tab (a change
 * board voter, an ECN acknowledger, a named checker following a
 * notification) keeps the pre-feature behaviour.
 */
export function useDesignFeature() {
  const { can, canFeature } = useCan()
  return (tab: string, feature: string, action: PermissionAction = 'view') =>
    !can('design', tab, 'view') || canFeature('design', tab, feature, action)
}
