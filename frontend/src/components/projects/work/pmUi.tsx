'use client'

// Labels, pills and small building blocks shared by the department-work
// screens (milestone workspace, department work, my tasks, task detail),
// which all show the same milestone/plan/task statuses.

import { createPortal } from 'react-dom'
import { TEXT, GLASS, SHADOWS, BORDER } from '@/lib/theme'
import { PermissionAction, useCan } from '@/lib/permissions'

/** Project Management features (backend core/features/projects.py, all on
 * projects:overview): milestones, milestone_status, tasks, task_checklist,
 * task_files, task_comments, task_log. They apply to people whose roles open
 * the project workspace; My Tasks is open to everyone, so for anyone else
 * only the record rules (can_* from the server) decide — same as the API. */
export function usePmFeature() {
  const { can, canFeature } = useCan()
  const pmRole = can('projects', 'overview', 'view')
  return (feature: string, action: PermissionAction) => !pmRole || canFeature('projects', 'overview', feature, action)
}

export const MILESTONE_LABELS: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', submitted: 'Submitted', achieved: 'Achieved', cancelled: 'Cancelled',
}
export const MILESTONE_HEX: Record<string, string> = {
  not_started: '#64748b', in_progress: '#2563eb', submitted: '#f59e0b', achieved: '#16a34a', cancelled: '#78716c',
}
export const TASK_LABELS: Record<string, string> = {
  todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled',
}
export const TASK_HEX: Record<string, string> = {
  todo: '#64748b', in_progress: '#2563eb', blocked: '#dc2626', done: '#16a34a', cancelled: '#78716c',
}
export const PROJECT_LABELS: Record<string, string> = {
  planning: 'Open', active: 'Active', on_hold: 'On hold', technically_complete: 'Technically complete', closed: 'Closed', cancelled: 'Cancelled',
}
export const PROJECT_HEX: Record<string, string> = {
  planning: '#64748b', active: '#16a34a', on_hold: '#f59e0b', technically_complete: '#0d9488', closed: '#334155', cancelled: '#78716c',
}
export const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
export const PRIORITY_HEX: Record<string, string> = { low: '#64748b', medium: '#2563eb', high: '#f59e0b', critical: '#dc2626' }
export const HEALTH_LABELS: Record<string, string> = { on_track: 'On track', at_risk: 'At risk', delayed: 'Delayed' }
export const HEALTH_HEX: Record<string, string> = { on_track: '#16a34a', at_risk: '#f59e0b', delayed: '#dc2626' }
export const DOC_TYPE_LABELS: Record<string, string> = {
  drawing: 'Drawing', report: 'Report', certificate: 'Certificate', specification: 'Specification', contract: 'Contract', other: 'Other',
}

// Local date (not toISOString, which is UTC and is yesterday before 05:30 IST).
export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function Pill({ value, labels, hex }: { value?: string | null; labels: Record<string, string>; hex: Record<string, string> }) {
  if (!value) return null
  const color = hex[value] || '#64748b'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap' }}>
      {labels[value] || value}
    </span>
  )
}

export function FlagPill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 9999, background: `${color}1a`, color, whiteSpace: 'nowrap', letterSpacing: '.03em', textTransform: 'uppercase' }}>
      {text}
    </span>
  )
}

export function ProgressBar({ value, width = 120 }: { value: number; width?: number | string }) {
  const v = Math.max(0, Math.min(100, value || 0))
  const color = v >= 100 ? '#16a34a' : '#6366f1'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <div style={{ width, height: 6, borderRadius: 9999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden', flex: 'none' }}>
        <div style={{ width: `${v}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.secondary }}>{v}%</span>
    </div>
  )
}

export function ErrorBanner({ error }: { error: string | string[] }) {
  if (!error || (Array.isArray(error) && error.length === 0)) return null
  return (
    <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
      {Array.isArray(error) ? error.join(' ') : error}
    </div>
  )
}

export function Notice({ tone, children }: { tone: 'info' | 'warn' | 'bad'; children: React.ReactNode }) {
  const color = tone === 'bad' ? '#b91c1c' : tone === 'warn' ? '#b45309' : '#1d4ed8'
  return (
    <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 10, background: `${color}12`, border: `1px solid ${color}33`, color, fontSize: 13 }}>
      {children}
    </div>
  )
}

export const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
export const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
export const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
  color: TEXT.muted, position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1, whiteSpace: 'nowrap',
}
export const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: TEXT.body, borderTop: `1px solid ${BORDER.light}`, verticalAlign: 'top' }

/** Popup for add / edit forms. Rendered into document.body (portal): the
 * glass section cards use backdrop-filter, which traps a position:fixed
 * child inside the card instead of covering the screen. */
export function Modal({ open, title, onClose, children, width = 560, busy }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; width?: number; busy?: boolean }) {
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div onClick={() => !busy && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,8,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 150, padding: '8vh 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: width, background: '#fff', borderRadius: 18, boxShadow: '0 20px 50px rgba(0,0,0,.18)', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: TEXT.heading, margin: 0 }}>{title}</h3>
          <button type="button" onClick={() => !busy && onClose()} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 20, lineHeight: 1, cursor: 'pointer', color: TEXT.muted }}>×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Pick files to send with a form: button + removable chips (max 10). */
export function FilePicker({ files, onChange, label = 'Attach files' }: { files: File[]; onChange: (f: File[]) => void; label?: string }) {
  return (
    <div>
      <label style={{ ...actionBtn('secondary'), display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        📎 {label}
        <input type="file" multiple hidden onChange={(e) => { onChange([...files, ...Array.from(e.target.files || [])].slice(0, 10)); e.target.value = '' }} />
      </label>
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 9999, background: 'rgba(0,0,0,0.05)', color: TEXT.body }}>
              {f.name}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 700, marginLeft: 4, color: TEXT.muted }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Small text button for row actions in tables (Edit, Cancel, Reopen…). */
export function linkBtn(color = '#4f46e5', disabled = false): React.CSSProperties {
  return { background: 'none', border: 'none', padding: '2px 4px', fontSize: 12.5, fontWeight: 600, color, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap' }
}

export function actionBtn(kind: 'primary' | 'secondary' | 'danger', disabled = false): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '8px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1, whiteSpace: 'nowrap',
  }
  if (kind === 'primary') return { ...base, border: 'none', background: '#6366f1', color: '#fff' }
  if (kind === 'danger') return { ...base, border: '1px solid rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.06)', color: '#b91c1c' }
  return { ...base, border: `1px solid ${BORDER.normal}`, background: 'rgba(255,255,255,.8)', color: TEXT.body }
}

export function AttachmentList({ files, onOpen, onDelete, canDelete }: {
  files: { id: number; file_name: string; title?: string; doc_type?: string; uploaded_by_name?: string | null; created_at?: string; uploaded_by_id?: number | null }[]
  onOpen: (id: number, name: string) => void
  onDelete?: (id: number) => void
  canDelete?: (f: { uploaded_by_id?: number | null }) => boolean
}) {
  if (files.length === 0) return <p style={{ fontSize: 12.5, color: TEXT.muted, margin: 0 }}>No files attached.</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {files.map((f) => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,.6)', border: `1px solid ${BORDER.light}`, flexWrap: 'wrap' }}>
          <a href="#" onClick={(e) => { e.preventDefault(); onOpen(f.id, f.file_name) }} style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', textDecoration: 'none', wordBreak: 'break-all' }}>
            {f.title && f.title !== f.file_name ? `${f.title} — ${f.file_name}` : f.file_name}
          </a>
          {f.doc_type && f.doc_type !== 'other' && <span style={{ fontSize: 10.5, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase' }}>{DOC_TYPE_LABELS[f.doc_type] || f.doc_type}</span>}
          <span style={{ fontSize: 11.5, color: TEXT.muted, marginLeft: 'auto' }}>{[f.uploaded_by_name, f.created_at ? new Date(f.created_at).toLocaleDateString('en-GB') : ''].filter(Boolean).join(' · ')}</span>
          {onDelete && (!canDelete || canDelete(f)) && (
            <button type="button" onClick={() => onDelete(f.id)} style={{ ...actionBtn('danger'), padding: '3px 9px', fontSize: 11 }}>Remove</button>
          )}
        </div>
      ))}
    </div>
  )
}
