'use client'

/** Dark monospace "terminal" panel matching legacy's report-log style — used
 * by tools whose backend response includes a `report` text string. */
export default function TerminalPanel({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #1e293b' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#1e293b' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} />
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
        <span style={{ fontSize: 10.5, color: '#94a3b8', marginLeft: 6, fontFamily: 'monospace' }}>{title}</span>
      </div>
      <pre style={{
        margin: 0, padding: 14, background: '#0f172a', color: '#4ade80', fontSize: 11.5, lineHeight: 1.6,
        fontFamily: 'Consolas, Menlo, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        maxHeight: 360, overflowY: 'auto',
      }}>
        {text || '> System Ready.\n> Waiting for input parameters...'}
      </pre>
    </div>
  )
}
