'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { notificationsApi } from '@/lib/api'
import { Notification } from '@/types'
import { useAuth } from '@/hooks/useAuth'
import { hrNotificationHref } from '@/components/hr/hrNotificationLink'
import { refOf } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { Bell } from '@phosphor-icons/react'

// Some notification types need a more specific link than their entity type
// alone gives (P2P approvals key their action buttons off ?from=).
const NOTIFICATION_TYPE_LINK: Record<string, (ref: string) => string> = {
  p2p_po_approval_pending: (ref) => `/dashboard/p2p/${ref}?from=po-approval`,
  p2p_po_approved: (ref) => `/dashboard/p2p/${ref}?from=po-approval`,
  // Project Management Milestones tab: milestone given / reopened / cancelled / done.
  pm_project_task: (ref) => `/dashboard/projects/${ref}?tab=Milestones`,
  // Milestone / sub-task given, done, remarks and due-date reminders — worked
  // in Project Management › My Tasks (each user's own work).
  pm_dept_task: () => '/dashboard/projects/my-tasks',
  pm_subtask: () => '/dashboard/projects/my-tasks',
  pm_task_remark: () => '/dashboard/projects/my-tasks',
  pm_goal_due_soon: () => '/dashboard/projects/my-tasks',
  pm_goal_due_today: () => '/dashboard/projects/my-tasks',
  pm_goal_overdue: () => '/dashboard/projects/my-tasks',
  pm_project_task_done: (ref) => `/dashboard/projects/${ref}?tab=Milestones`,
  // @mention in a requirement Discussion — open straight on the Discussion tab.
  req_mention_crm_inquiry: (ref) => `/dashboard/crm/inquiries/${ref}?tab=discussion`,
  req_mention_crm_tender: (ref) => `/dashboard/crm/tenders/${ref}?tab=discussion`,
  req_mention_rnd_inquiry: (ref) => `/dashboard/rnd/requirements/inquiry/${ref}?tab=discussion`,
  req_mention_rnd_tender: (ref) => `/dashboard/rnd/requirements/tender/${ref}?tab=discussion`,
  // Pending HR requests moved to a new manager (entity = the requester, a user).
  hr_approval_rerouted: () => '/dashboard/hr/approvals',
}

const ENTITY_LINK: Record<string, (ref: string) => string> = {
  access_review: () => '/dashboard/organization/access-reviews',
  job_run: () => '/dashboard/organization/monitor',
  p2p_request: (ref) => `/dashboard/p2p/${ref}?from=approval`,
  p2p_purchase_order: (ref) => `/dashboard/p2p/purchase-orders/${ref}`,
  hyd_circuit: (ref) => `/dashboard/hydraulic/circuits/${ref}`,
  hyd_bom: (ref) => `/dashboard/hydraulic/bom/${ref}`,
  hyd_test: (ref) => `/dashboard/hydraulic/testing/${ref}`,
  electrical_drawing_revision: (ref) => `/dashboard/electrical/approval/electrical_drawing_revision/${ref}`,
  electrical_bom_item: (ref) => `/dashboard/electrical/approval/electrical_bom_item/${ref}`,
  service_request: (ref) => `/dashboard/erp/service-requests/${ref}`,
  project: (ref) => `/dashboard/erp/projects/${ref}`,
  erp_machine: (ref) => `/dashboard/erp/projects/${ref}`,
  organization: (ref) => `/dashboard/crm/organizations/${ref}`,
  inquiry: (ref) => `/dashboard/crm/inquiries/${ref}`,
  rnd_req_inquiry: (ref) => `/dashboard/rnd/requirements/inquiry/${ref}`,
  rnd_req_tender: (ref) => `/dashboard/rnd/requirements/tender/${ref}`,
  design_rnd_requirement: (ref) => `/dashboard/design/requirements/${ref}`,
  electrical_rnd_requirement: (ref) => `/dashboard/electrical/requirements/${ref}`,
  hydraulic_rnd_requirement: (ref) => `/dashboard/hydraulic/requirements/${ref}`,
  tender: (ref) => `/dashboard/crm/tenders/${ref}`,
  activity: () => `/dashboard/crm/followups`,
  design_document: (ref) => `/dashboard/design/documents/${ref}`,
  design_ecn: (ref) => `/dashboard/design/change-notices/${ref}`,
  design_bom: (ref) => `/dashboard/design/boms/${ref}`,
  maintenance_request: (ref) => `/dashboard/maintenance/requests/${ref}`,
  maintenance_work_order: (ref) => `/dashboard/maintenance/work-orders/${ref}`,
  maintenance_pm_plan: (ref) => `/dashboard/maintenance/schedule/${ref}`,
  maintenance_spare: () => '/dashboard/maintenance/spares',
  maintenance_asset: (ref) => `/dashboard/maintenance/assets/${ref}`,
  sales_order: (ref) => `/dashboard/sales/orders/${ref}`,
  sales_amendment: (ref) => `/dashboard/sales/amendments/${ref}`,
  crm_quotation: (ref) => `/dashboard/crm/quotations/${ref}`,
  sales_extension: () => '/dashboard/sales/delivery',
  pm_project: (ref) => `/dashboard/projects/${ref}`,
  pm_milestone: (ref) => `/dashboard/projects/milestones/${ref}`,
  pm_task: (ref) => `/dashboard/projects/tasks/${ref}`,
  stock_adjustment: (ref) => `/dashboard/store/adjustments/${ref}`,
  material_return: (ref) => `/dashboard/store/returns/${ref}`,
  production_bom: (ref) => `/dashboard/production/bom/${ref}`,
  production_work_order: (ref) => `/dashboard/production/work-orders/${ref}`,
  production_rrv_build: (ref) => `/dashboard/production/rrv-builds/${ref}`,
  quality_ncr: (ref) => `/dashboard/quality/ncr/${ref}`,
  quality_inspection_plan: (ref) => `/dashboard/quality/inspection-plans/${ref}`,
  quality_approved_vendor: (ref) => `/dashboard/quality/supplier-quality/${ref}`,
  quality_capa: (ref) => `/dashboard/quality/capa/${ref}`,
  quality_complaint: (ref) => `/dashboard/quality/complaints/${ref}`,
  quality_inspection_lot: (ref) => `/dashboard/quality/lots/${ref}`,
  quality_first_article: (ref) => `/dashboard/quality/first-articles/${ref}`,
  quality_inspection_call: (ref) => `/dashboard/quality/inspection-calls/${ref}`,
  // Finance & Accounting approvals (list pages; the record's row carries the Approval panel)
  accounts_journal_entry: () => '/dashboard/finance/ledger',
  accounts_vendor_invoice: () => '/dashboard/finance/purchase',
  accounts_ar_transaction: () => '/dashboard/finance/sales',
  accounts_party_note: () => '/dashboard/organization/approvals',
  accounts_period_close: () => '/dashboard/finance/ledger',
  accounts_depreciation_run: () => '/dashboard/finance/assets',
  accounts_year_end_close: () => '/dashboard/finance/reports',
  accounts_bank_guarantee: () => '/dashboard/finance/banking?tab=guarantees',
  accounts_payment: () => '/dashboard/finance/payments',
  accounts_payment_proposal: () => '/dashboard/finance/payments/runs',
  accounts_credit_release: () => '/dashboard/finance/outstanding/credit',
  accounts_collection_note: () => '/dashboard/finance/outstanding/collections',
  accounts_dispute: () => '/dashboard/finance/outstanding/disputes',
  accounts_internal_order: () => '/dashboard/finance/masters',
  inventory_valuation: () => '/dashboard/finance/inventory',
  product_cost_estimate: () => '/dashboard/finance/costing',
  // Store
  stock_transfer: (ref) => `/dashboard/store/transfers/${ref}`,
  store_material_issue: (ref) => `/dashboard/store/issues/${ref}`,
  p2p_goods_receipt: (ref) => `/dashboard/store/grn/${ref}`,
  store_item: (ref) => `/dashboard/store/${ref}`,
  p2p_po_amendment: (ref) => `/dashboard/p2p/purchase-orders/amendments/${ref}`,
  electrical_job: (ref) => `/dashboard/electrical/jobs/${ref}`,
  erp_service_contract: (ref) => `/dashboard/erp/service-contracts/${ref}`,
  design_ecr: (ref) => `/dashboard/design/change-requests/${ref}`,
  design_request: (ref) => `/dashboard/design/requests/${ref}`,
  design_submission: (ref) => `/dashboard/design/reviews/submissions/${ref}`,
  // Final inspection raised from an Electrical job / RRV build (entity = the quality inspection).
  quality_inspection: (ref) => `/dashboard/quality/final-inspection/${ref}`,
  quality_gauge: () => '/dashboard/quality/gauges',
  // Supplier Quality's detail page is per approved-vendor entry — ratings / audits live on its list tabs.
  quality_supplier_scorecard: () => '/dashboard/quality/supplier-quality',
  quality_vendor_audit: () => '/dashboard/quality/supplier-quality',
  rnd_project: (ref) => `/dashboard/rnd/projects/${ref}`,
  rnd_prototype: (ref) => `/dashboard/rnd/prototypes/${ref}`,
  role: (ref) => `/dashboard/organization/roles/${ref}`,
  user: () => '/dashboard/organization/users',
  company: () => '/dashboard/organization/info',
}

// Deleted entities 404 on their normal detail route (soft-deleted rows are excluded
// from the GET-by-id queries) — send these straight to the recycle bin instead.
const DELETED_TYPE_LINK: Record<string, string> = {
  sr_deleted: '/dashboard/erp/recycle-bin',
  project_deleted: '/dashboard/erp/recycle-bin',
  // CRM has no recycle bin page yet — open the matching list instead of a 404.
  organization_deleted: '/dashboard/crm/organizations',
  inquiry_deleted: '/dashboard/crm/inquiries?type=inquiry',
  tender_deleted: '/dashboard/crm/inquiries?type=tender',
}

export default function NotificationBell() {
  const { user, fetchUser } = useAuth()
  const [open, setOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [savingPref, setSavingPref] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const notificationsEnabled = user?.notifications_enabled !== false

  const toggleNotificationsEnabled = async () => {
    setSavingPref(true)
    try {
      await notificationsApi.updatePreferences(!notificationsEnabled)
      await fetchUser()
    } finally {
      setSavingPref(false)
    }
  }

  const refreshCount = () => {
    notificationsApi.getUnreadCount().then((r) => setUnreadCount(r.count)).catch(() => {})
  }

  // Only poll while actually signed in — otherwise this fires every 30s
  // against a protected endpoint with no session, and enough stacked 401s
  // (e.g. right after a refresh, before /auth/me settles, or while genuinely
  // signed out) can trip the backend's anti-abuse IP ban and lock the user
  // out of logging back in.
  useEffect(() => {
    if (!user) return
    refreshCount()
    const interval = setInterval(refreshCount, 30000)
    return () => clearInterval(interval)
  }, [user])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleOpen = async () => {
    const next = !open
    setOpen(next)
    if (next) {
      setLoading(true)
      setLoadError('')
      try {
        setNotifications(await notificationsApi.list())
      } catch (err) {
        setLoadError(extractErrorMessages(err, 'Could not load your notifications — check your connection and open the bell again.').join(' '))
      } finally {
        setLoading(false)
      }
    }
  }

  const markAllRead = async () => {
    await notificationsApi.markAllRead()
    setUnreadCount(0)
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
  }

  const handleClickNotification = async (n: Notification) => {
    if (!n.is_read) {
      await notificationsApi.markAsRead(n.id)
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)))
      setUnreadCount((c) => Math.max(0, c - 1))
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={toggleOpen}
        style={{
          position: 'relative',
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '1px solid rgba(0,0,0,0.1)',
          background: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label="Notifications"
      >
        <Bell size={17} color="#57534e" />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 16,
              height: 16,
              borderRadius: 9999,
              background: '#dc2626',
              color: '#fff',
              fontSize: 9.5,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 44,
            width: 340,
            background: '#fff',
            borderRadius: 14,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
            zIndex: 60,
            overflow: 'hidden',
          }}
        >
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1f1108' }}>Notifications</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {unreadCount > 0 && (
                <button onClick={markAllRead} style={{ fontSize: 11.5, fontWeight: 600, color: '#FF7A45', background: 'none', border: 'none', cursor: 'pointer' }}>
                  Mark all read
                </button>
              )}
              <button
                onClick={toggleNotificationsEnabled}
                disabled={savingPref}
                title={notificationsEnabled ? 'Turn notifications off' : 'Turn notifications on'}
                aria-label={notificationsEnabled ? 'Turn notifications off' : 'Turn notifications on'}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: notificationsEnabled ? '#78716c' : '#a8a29e',
                  background: 'none',
                  border: '1px solid rgba(0,0,0,0.1)',
                  borderRadius: 8,
                  padding: '3px 8px',
                  cursor: savingPref ? 'default' : 'pointer',
                  opacity: savingPref ? 0.6 : 1,
                }}
              >
                {notificationsEnabled ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          {!notificationsEnabled && (
            <div style={{ padding: '8px 16px', fontSize: 11.5, color: '#a8a29e', background: '#fafaf9', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              Notifications are turned off. You won&apos;t receive new alerts here or in Teams until you turn them back on.
            </div>
          )}

          {loading ? (
            <p style={{ fontSize: 12.5, color: '#a8a29e', padding: 16, margin: 0 }}>Loading…</p>
          ) : loadError ? (
            <p style={{ fontSize: 12.5, color: '#b91c1c', padding: 16, margin: 0 }}>{loadError}</p>
          ) : notifications.length === 0 ? (
            <p style={{ fontSize: 12.5, color: '#a8a29e', padding: 16, margin: 0 }}>No notifications yet.</p>
          ) : (
            notifications.map((n) => {
              const href = DELETED_TYPE_LINK[n.notification_type] ?? (n.entity_id ? NOTIFICATION_TYPE_LINK[n.notification_type]?.(refOf(n, 'entity_id')) : undefined) ?? (n.entity_type && n.entity_id ? ENTITY_LINK[n.entity_type]?.(refOf(n, 'entity_id')) : undefined) ?? hrNotificationHref(n)
                ?? (n.notification_type === 'approval' ? '/dashboard/organization/approvals' : undefined)
              const content = (
                <div
                  onClick={() => handleClickNotification(n)}
                  style={{
                    padding: '10px 16px',
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                    background: n.is_read ? '#fff' : 'rgba(244,113,59,0.04)',
                    cursor: 'pointer',
                  }}
                >
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: '#1f1108', margin: '0 0 2px' }}>{n.title}</p>
                  <p style={{ fontSize: 12, color: '#78716c', margin: 0 }}>{n.message}</p>
                  {n.created_at && (
                    <p style={{ fontSize: 10.5, color: '#a8a29e', margin: '4px 0 0' }}>{new Date(n.created_at).toLocaleString()}</p>
                  )}
                </div>
              )
              return href ? (
                <Link key={n.id} href={href} style={{ textDecoration: 'none', display: 'block' }} onClick={() => setOpen(false)}>
                  {content}
                </Link>
              ) : (
                <div key={n.id}>{content}</div>
              )
            })
          )}
        </div>
        </div>
      )}
    </div>
  )
}
