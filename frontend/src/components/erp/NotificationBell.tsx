'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { notificationsApi } from '@/lib/api'
import { Notification } from '@/types'

const ENTITY_LINK: Record<string, (id: number) => string> = {
  service_request: (id) => `/dashboard/erp/service-requests/${id}`,
  project: (id) => `/dashboard/erp/projects/${id}`,
  organization: (id) => `/dashboard/crm/organizations/${id}`,
  inquiry: (id) => `/dashboard/crm/inquiries/${id}`,
  tender: (id) => `/dashboard/crm/tenders/${id}`,
}

// Deleted entities 404 on their normal detail route (soft-deleted rows are excluded
// from the GET-by-id queries) — send these straight to the recycle bin instead.
const DELETED_TYPE_LINK: Record<string, string> = {
  sr_deleted: '/dashboard/erp/recycle-bin',
  project_deleted: '/dashboard/erp/recycle-bin',
  organization_deleted: '/dashboard/crm/recycle-bin',
  inquiry_deleted: '/dashboard/crm/recycle-bin',
  tender_deleted: '/dashboard/crm/recycle-bin',
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const refreshCount = () => {
    notificationsApi.getUnreadCount().then((r) => setUnreadCount(r.count)).catch(() => {})
  }

  useEffect(() => {
    refreshCount()
    const interval = setInterval(refreshCount, 30000)
    return () => clearInterval(interval)
  }, [])

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
      try {
        setNotifications(await notificationsApi.list())
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
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#57534e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
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
            maxHeight: 420,
            overflowY: 'auto',
            background: '#fff',
            borderRadius: 14,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
            zIndex: 60,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1f1108' }}>Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} style={{ fontSize: 11.5, fontWeight: 600, color: '#fa9b9b', background: 'none', border: 'none', cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
          </div>

          {loading ? (
            <p style={{ fontSize: 12.5, color: '#a8a29e', padding: 16, margin: 0 }}>Loading…</p>
          ) : notifications.length === 0 ? (
            <p style={{ fontSize: 12.5, color: '#a8a29e', padding: 16, margin: 0 }}>No notifications yet.</p>
          ) : (
            notifications.map((n) => {
              const href = DELETED_TYPE_LINK[n.notification_type] ?? (n.entity_type && n.entity_id ? ENTITY_LINK[n.entity_type]?.(n.entity_id) : undefined)
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
      )}
    </div>
  )
}
