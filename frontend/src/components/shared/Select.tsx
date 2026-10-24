'use client'

import { Children, Fragment, isValidElement, useState } from 'react'
import SearchableSelect, { type SearchableOption } from '@/components/erp/SearchableSelect'

/**
 * Drop-in replacement for a native <select> — same markup, the app's own list.
 *
 *   <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}>
 *     <option value="">All statuses</option>
 *     {STATUSES.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
 *   </Select>
 *
 * Why: a native <select> draws the browser's own list (grey OS highlight, its own
 * font and height) and is clipped/mis-sized next to SearchableSelect and inputs in
 * the same row. This renders SearchableSelect (portaled list, flips up near the
 * bottom of the screen, keyboard support, search box for long lists) while keeping
 * the <option>/<optgroup> children and the `e.target.value` onChange contract, so
 * converting a page is just renaming the tag.
 *
 * Layout props in `style` (width, flex, margin, min/max width, grid placement) go
 * on the outer box; everything else (padding, font size, background) on the trigger.
 * Not for `multiple` — use a chip multi-select for that.
 */

type SelectChangeEvent = React.ChangeEvent<HTMLSelectElement>

export interface SelectProps {
  value?: string | number | null
  defaultValue?: string | number
  onChange?: (e: SelectChangeEvent) => void
  /** Plain value callback, for new code. */
  onValueChange?: (value: string) => void
  children?: React.ReactNode
  style?: React.CSSProperties
  className?: string
  disabled?: boolean
  required?: boolean
  name?: string
  id?: string
  title?: string
  placeholder?: string
  searchable?: boolean
  autoFocus?: boolean
  'aria-label'?: string
  /** data-* attributes (tour targets, test ids) land on the outer box. */
  [dataAttr: `data-${string}`]: string | number | boolean | undefined
}

const LAYOUT_KEYS = new Set([
  'width', 'minWidth', 'maxWidth', 'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'justifySelf',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginInline', 'marginBlock',
  'gridColumn', 'gridRow', 'gridArea', 'order', 'position', 'top', 'left', 'right', 'bottom', 'zIndex', 'display',
])

// A native <select> with no width is as wide as its longest option; do the
// same (in ch, + room for padding and the caret) so a converted filter in a
// flex row doesn't suddenly take the whole row. An explicit width (inputStyle's
// '100%', a px width, a flex basis or a grid placement) wins.
function splitStyle(style: React.CSSProperties | undefined, longest: number) {
  const outer: Record<string, unknown> = {}
  const inner: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(style || {})) {
    if (k === 'display') continue // the trigger owns its display
    ;(LAYOUT_KEYS.has(k) ? outer : inner)[k] = v
  }
  delete inner.width
  const sized = (outer.width !== undefined && outer.width !== 'auto') || outer.flex !== undefined || outer.flexBasis !== undefined || outer.flexGrow !== undefined || outer.gridColumn !== undefined
  if (!sized) {
    outer.width = `calc(${Math.min(Math.max(longest, 6), 40)}ch + 48px)`
    if (outer.maxWidth === undefined) outer.maxWidth = '100%'
  }
  return { outer: outer as React.CSSProperties, inner: inner as React.CSSProperties }
}

function textOf(node: React.ReactNode): string {
  let out = ''
  Children.forEach(node, (c) => {
    if (c === null || c === undefined || typeof c === 'boolean') return
    if (typeof c === 'string' || typeof c === 'number') out += String(c)
    else if (isValidElement<{ children?: React.ReactNode }>(c)) out += textOf(c.props.children)
  })
  return out
}

function collect(node: React.ReactNode, group: string | undefined, out: SearchableOption[]) {
  Children.forEach(node, (c) => {
    if (!isValidElement(c)) return
    const props = c.props as { children?: React.ReactNode; value?: string | number; label?: string; disabled?: boolean; hidden?: boolean }
    if (c.type === Fragment) collect(props.children, group, out)
    else if (c.type === 'optgroup') collect(props.children, props.label ?? group, out)
    else if (c.type === 'option') {
      if (props.hidden) return
      const label = textOf(props.children) || props.label || ''
      const value = props.value === undefined || props.value === null ? label : String(props.value)
      out.push({ value, label: label || value, disabled: !!props.disabled, group })
    }
  })
}

export default function Select({
  value, defaultValue, onChange, onValueChange, children, style, className, disabled, required,
  name, id, title, placeholder, searchable, autoFocus, 'aria-label': ariaLabel, ...rest
}: SelectProps) {
  const dataAttrs = Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('data-')))
  const options: SearchableOption[] = []
  collect(children, undefined, options)

  const controlled = value !== undefined
  const [inner, setInner] = useState<string>(defaultValue !== undefined ? String(defaultValue) : (options[0]?.value ?? ''))
  const current = controlled ? (value === null ? '' : String(value)) : inner

  const handle = (v: string) => {
    if (!controlled) setInner(v)
    if (onChange) {
      // Minimal event: pages read e.target.value / e.target.name.
      const target = { value: v, name: name ?? '', id: id ?? '' } as unknown as HTMLSelectElement
      onChange({ target, currentTarget: target, preventDefault() {}, stopPropagation() {} } as unknown as SelectChangeEvent)
    }
    onValueChange?.(v)
  }

  const longest = Math.max((placeholder ?? '').length, ...options.map((o) => o.label.length))
  const { outer, inner: triggerStyle } = splitStyle(style, longest)
  return (
    <div className={className ? `ui-select ${className}` : 'ui-select'} {...dataAttrs} style={{ minWidth: 0, ...outer }}>
      <SearchableSelect
        value={current}
        onChange={handle}
        options={options}
        placeholder={placeholder ?? 'Select...'}
        disabled={disabled}
        searchable={searchable}
        triggerStyle={triggerStyle}
        id={id}
        name={name}
        title={title}
        ariaLabel={ariaLabel}
        required={required}
        autoFocus={autoFocus}
      />
    </div>
  )
}
