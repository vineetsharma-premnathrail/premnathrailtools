'use client'

import { Eye, EyeSlash, Lock } from '@phosphor-icons/react'
import { VisibilityPreviewContext, type VisibilityApi, type VisibilityPreviewValue } from '@/lib/visibility'
import { Pill, smallSecondaryBtnStyle } from '@/components/shared/ui'
import { TEXT, BORDER, BRAND } from '@/lib/theme'

/**
 * How a screen puts role-wise visibility on the page (see lib/visibility.ts).
 *
 *   const vis = useVisibility('p2p:purchase_requisitions')
 *   <VisSection vis={vis} k="remarks" frame={{ padding: '20px 24px' }}> … </VisSection>
 *   <VisTh vis={vis} table="requisitions" k="priority" style={th}>Priority</VisTh>
 *   <VisTd vis={vis} table="requisitions" k="priority">{row.priority}</VisTd>
 *   <Select … /> <VisOptionValues vis={vis} dropdown="purpose" />
 *
 * Normal use: a hidden section / column draws nothing. In the Role editor's
 * "Preview & choose" the same wrappers draw everything, dimmed when hidden,
 * with a toggle (a button, aria-pressed) to hide / show it.
 */

export function VisibilityPreviewProvider({ value, children }: { value: VisibilityPreviewValue; children: React.ReactNode }) {
  return <VisibilityPreviewContext.Provider value={value}>{children}</VisibilityPreviewContext.Provider>
}

const HIDDEN_OUTLINE = '2px dashed #d97706'

function Toggle({ shown, label, onToggle, compact }: { shown: boolean; label: string; onToggle: () => void; compact?: boolean }) {
  const Icon = shown ? Eye : EyeSlash
  return (
    <button type="button" data-vis-toggle onClick={onToggle} aria-pressed={!shown}
      aria-label={`${shown ? 'Hide' : 'Show'} ${label}`} title={`${shown ? 'Hide' : 'Show'} ${label}`}
      style={compact
        ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, minWidth: 24, marginLeft: 6, padding: 0, borderRadius: 9999, cursor: 'pointer', verticalAlign: 'middle',
            border: `1px solid ${shown ? BORDER.normal : '#d97706'}`, background: shown ? '#fff' : 'rgba(245,158,11,0.12)', color: shown ? TEXT.secondary : '#b45309' }
        : { ...smallSecondaryBtnStyle, borderColor: shown ? BORDER.normal : '#d97706', background: shown ? '#fff' : 'rgba(245,158,11,0.12)', color: shown ? TEXT.secondary : '#b45309' }}>
      <Icon size={14} aria-hidden="true" />
      {!compact && (shown ? 'Shown' : 'Hidden')}
    </button>
  )
}

/**
 * A section of a screen. `frame` = the section's own box (the grid column div and its padding / border): it
 * is drawn only while the section shows, so a hidden section leaves no empty column behind.
 */
export function VisSection({ vis, k, frame, children }: { vis: VisibilityApi; k: string; frame?: React.CSSProperties; children: React.ReactNode }) {
  const shown = vis.showSection(k)
  const box = (inner: React.ReactNode, extra?: React.CSSProperties) => (frame || extra ? <div style={{ ...frame, ...extra }}>{inner}</div> : <>{inner}</>)
  if (!vis.preview || !vis.tracks('section', k)) return shown || vis.preview ? box(children) : null
  const locked = vis.isLocked(k)
  const label = vis.sectionLabel(k)
  return box(
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 6 }}>
        {locked
          ? <Pill hex="#64748b" title={`${label} holds a field that is needed to save the record`}
              label={<><Lock size={12} aria-hidden="true" style={{ marginRight: 4 }} />Required — always shown</>} />
          : <Toggle shown={shown} label={label} onToggle={() => vis.toggleSection(k)} />}
      </div>
      <div style={{ opacity: shown ? 1 : 0.4, filter: shown ? undefined : 'grayscale(0.6)' }}>{children}</div>
    </>,
    { position: 'relative', outline: shown ? undefined : HIDDEN_OUTLINE, outlineOffset: -3 },
  )
}

/** A column header of a table. In the preview it carries the show / hide toggle. */
export function VisTh({ vis, table, k, children, style, ...rest }: { vis: VisibilityApi; table: string; k: string } & React.ThHTMLAttributes<HTMLTableCellElement>) {
  const shown = vis.showColumn(table, k)
  if (!vis.preview || !vis.tracks('table', table)) return shown || vis.preview ? <th style={style} {...rest}>{children}</th> : null
  return (
    <th style={{ ...style, outline: shown ? undefined : HIDDEN_OUTLINE, outlineOffset: -2 }} {...rest}>
      <span style={{ opacity: shown ? 1 : 0.4 }}>{children}</span>
      <Toggle compact shown={shown} label={vis.columnLabel(table, k)} onToggle={() => vis.toggleColumn(table, k)} />
    </th>
  )
}

/** A cell of a hideable column; in the preview a hidden column's cells stay, dimmed. */
export function VisTd({ vis, table, k, children, style, ...rest }: { vis: VisibilityApi; table: string; k: string } & React.TdHTMLAttributes<HTMLTableCellElement>) {
  const shown = vis.showColumn(table, k)
  if (!vis.preview || !vis.tracks('table', table)) return shown || vis.preview ? <td style={style} {...rest}>{children}</td> : null
  return <td style={{ ...style, opacity: shown ? 1 : 0.3, background: shown ? style?.background : 'rgba(245,158,11,0.06)' }} {...rest}>{children}</td>
}

/** Preview only: under a dropdown, the values the role is offered, one tick button per value (the last one stays). */
export function VisOptionValues({ vis, dropdown }: { vis: VisibilityApi; dropdown: string }) {
  if (!vis.preview || !vis.tracks('option', dropdown)) return null
  const values = vis.optionValues(dropdown)
  if (!values.length) return null
  return (
    <div role="group" aria-label="Values offered to this role" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: TEXT.secondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>Offered values</span>
      {values.map(([value, label]) => {
        const on = vis.optionOn(dropdown, value)
        return (
          <button key={value} type="button" data-vis-toggle aria-pressed={on} onClick={() => vis.toggleOption(dropdown, value)}
            title={on ? `Stop offering ${label}` : `Offer ${label}`}
            style={{ ...smallSecondaryBtnStyle, borderColor: on ? BRAND.primary : BORDER.normal, background: on ? 'rgba(244,113,59,0.08)' : '#fff',
              color: on ? BRAND.primaryActive : TEXT.muted, textDecoration: on ? undefined : 'line-through' }}>
            {on ? '✓ ' : ''}{label}
          </button>
        )
      })}
    </div>
  )
}
