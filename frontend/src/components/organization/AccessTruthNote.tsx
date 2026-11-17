'use client'

import { EffectivePermissions } from '@/types'

/** /users/{id}/effective-permissions as the backend now sends it: `grants` is only
 * what is in force today; roles / extra grants outside their validity window and
 * inactive roles are in `sources` (active=false + reason) and what they would give
 * is in `inactive_grants`. Optional so an older backend still type-checks. */
export type EffectiveAccess = EffectivePermissions & {
  user_active?: boolean
  inactive_grants?: Record<string, string[]>
  sources?: { kind: 'role' | 'everyone' | 'extra'; role_id: number | null; name: string; active: boolean; reason: string | null; valid_from: string | null; valid_to: string | null }[]
}

/**
 * Says plainly why some of a user's access gives nothing today — a deactivated
 * user, a role / extra grant outside its validity dates, an inactive role — so
 * the effective-access matrix next to it is not mistaken for the whole story.
 * Renders nothing when everything is in force.
 */
export default function AccessTruthNote({ effective, userName }: { effective: EffectiveAccess | null; userName: string }) {
  if (!effective) return null
  const off = (effective.sources || []).filter((s) => !s.active)
  const inactiveUser = effective.user_active === false
  if (!off.length && !inactiveUser) return null
  return (
    <div role="status" data-tour="org-access-truth" style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 0 12px' }}>
      {inactiveUser && (
        <div style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 12.5 }}>
          <b>{userName} is deactivated</b> — they can&apos;t sign in, so none of the access below is used. Reactivate them on the User Details tab if they should work again.
        </div>
      )}
      {off.length > 0 && (
        <div style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)', color: '#92400e', fontSize: 12.5 }}>
          <b>Not active today</b> — these give {userName} nothing right now, and their ticks are not shown below:
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {off.map((s) => (
              <li key={`${s.kind}-${s.role_id ?? s.name}`}>{s.name}: {s.reason || 'not active today'}</li>
            ))}
          </ul>
          <span style={{ fontSize: 11.5 }}>Change validity dates under Access validity, or make the role active again in Organization › Role &amp; Permissions.</span>
        </div>
      )}
    </div>
  )
}
