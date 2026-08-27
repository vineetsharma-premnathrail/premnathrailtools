'use client'

// iOS-style checkbox (Uiverse.io pattern, brand-colored). Drop-in replacement
// for a plain `<input type="checkbox" checked={...} onChange={...} />` —
// same checked/onChange signature so existing call sites swap mechanically.

interface CheckboxProps {
  checked: boolean
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  id?: string
  variant?: 'default' | 'red'
  disabled?: boolean
}

export default function Checkbox({ checked, onChange, id, variant = 'default', disabled }: CheckboxProps) {
  return (
    <label className={`ios-checkbox${variant === 'red' ? ' red' : ''}`}>
      <input type="checkbox" id={id} checked={checked} onChange={onChange} disabled={disabled} />
      <div className="checkbox-wrapper">
        <div className="checkbox-bg" />
        <svg className="checkbox-icon" viewBox="0 0 24 24" fill="none">
          <path className="check-path" d="M4 12l6 6L20 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </label>
  )
}
