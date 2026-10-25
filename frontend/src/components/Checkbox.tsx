'use client'

// iOS-style checkbox (Uiverse.io pattern, brand-colored). Drop-in replacement
// for a plain `<input type="checkbox" checked={...} onChange={...} />` —
// same checked/onChange signature so existing call sites swap mechanically.
// The real input stays focusable (visually hidden, see globals.css) so the
// switch works from the keyboard (Tab to reach, Space to toggle).

interface CheckboxProps {
  checked: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  id?: string
  variant?: 'default' | 'red'
  disabled?: boolean
  /** Expose as an on/off switch (role="switch") instead of a plain checkbox. */
  asSwitch?: boolean
  /** Accessible name when no visible <label> wraps / points at it. */
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

export default function Checkbox({ checked, onChange, id, variant = 'default', disabled, asSwitch, ...aria }: CheckboxProps) {
  return (
    <label className={`ios-checkbox${variant === 'red' ? ' red' : ''}`}>
      <input
        type="checkbox"
        role={asSwitch ? 'switch' : undefined}
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-checked={asSwitch ? checked : undefined}
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        aria-describedby={aria['aria-describedby']}
      />
      <div className="checkbox-wrapper">
        <div className="checkbox-bg" />
        <svg className="checkbox-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <path className="check-path" d="M4 12l6 6L20 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </label>
  )
}
