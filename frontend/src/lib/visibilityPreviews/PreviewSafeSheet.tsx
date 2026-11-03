'use client'

import type React from 'react'
import { FormSheet, SheetIcon, SHEET } from '@/components/shared/FormSheet'

/**
 * A FormSheet popup that draws itself IN PLACE while its screen is mounted in the Role editor's
 * "Preview & choose" (`inline`): a portal sheet (z 150) would open underneath the preview overlay.
 * Outside the preview it is exactly the normal FormSheet.
 */
export default function PreviewSafeSheet({ inline, ...props }: React.ComponentProps<typeof FormSheet> & { inline: boolean }) {
  if (!inline) return <FormSheet {...props} />
  return (
    <div data-form-sheet style={{ width: '100%', maxWidth: props.width ?? 960, margin: '0 auto', background: '#fff', borderRadius: 18, border: `1px solid ${SHEET.LINE}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '20px 24px', borderBottom: `1px solid ${SHEET.LINE}` }}>
        <span style={{ width: 42, height: 42, borderRadius: 12, background: props.iconColor ?? SHEET.BLUE, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <SheetIcon name={props.icon} size={22} color="#fff" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 20, fontWeight: 700, color: SHEET.INK, margin: 0 }}>{props.title}</h3>
          {props.subtitle && <p style={{ fontSize: 13, color: SHEET.MUTED, margin: '2px 0 0' }}>{props.subtitle}</p>}
        </div>
      </div>
      {props.children}
      {props.footer && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${SHEET.LINE}`, flexWrap: 'wrap' }}>{props.footer}</div>
      )}
    </div>
  )
}
