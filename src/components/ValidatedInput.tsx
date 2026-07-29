'use client'

import { useState } from 'react'

/** Drop-in replacement for a plain <input> that shows a red border + error
 * message once the value is invalid per `validator` — errors only appear
 * after the field has been touched (blurred), so it doesn't flash red while
 * the user is still mid-typing. */
export default function ValidatedInput({
  value,
  onChange,
  validator,
  errorMessage,
  style,
  type = 'text',
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  validator: (v: string) => boolean
  errorMessage: string
  style?: React.CSSProperties
  type?: string
  placeholder?: string
}) {
  const [touched, setTouched] = useState(false)
  const invalid = touched && value.length > 0 && !validator(value)

  return (
    <div>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        style={{ ...style, ...(invalid ? { borderColor: '#f87171' } : {}) }}
      />
      {invalid && (
        <p style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, margin: '4px 0 0' }}>{errorMessage}</p>
      )}
    </div>
  )
}
