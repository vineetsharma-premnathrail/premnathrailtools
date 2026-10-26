// Small shared styles for the reports components (menu rows, text links, chips).
import type { CSSProperties } from 'react'

export const REPORT_INK = '#1f1108'

/** A row in a popover list (period presets, group choices, measure rows). */
export function menuItemStyle(active = false): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 'none',
    background: active ? 'rgba(255,122,69,0.10)' : 'transparent', color: active ? '#c2410c' : '#334155',
    fontSize: 13.5, fontWeight: active ? 700 : 500, minHeight: 34, padding: '0 12px', borderRadius: 8,
    cursor: 'pointer', fontFamily: 'inherit', boxSizing: 'border-box',
  }
}

/** A text-only action (no box): "Reset", "Clear all". */
export const textActionStyle: CSSProperties = {
  background: 'none', border: 'none', color: '#2563eb', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
}

/** An applied-filter chip. */
export const chipStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 28, boxSizing: 'border-box', borderRadius: 999,
  border: '1px solid rgba(0,0,0,0.10)', background: 'rgba(255,255,255,.8)', color: '#334155', fontSize: 12.5, fontWeight: 600,
  paddingLeft: 12, paddingRight: 6, maxWidth: '100%',
}

export const popoverCard: CSSProperties = { padding: 10, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }
