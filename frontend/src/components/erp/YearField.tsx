'use client'

function isFinancialYearValid(v: string): boolean {
  if (!v) return true
  const m = v.match(/^(\d{4})-(\d{2})$/)
  if (!m) return false
  const y1 = parseInt(m[1], 10)
  const y2 = parseInt(m[2], 10)
  return y1 >= 1900 && y1 <= 2100 && y2 === (y1 + 1) % 100
}

export default function YearField({
  value,
  onChange,
  placeholder = 'e.g. 2026-27',
  style,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  style?: React.CSSProperties
}) {
  const showError = value.length >= 5 && !isFinancialYearValid(value)

  return (
    <div>
      <input
        value={value}
        maxLength={7}
        onChange={(e) => {
          // Auto-format as the user types: digits only, dash auto-inserted
          // after the 4th digit (YYYY-YY) — no need to type the dash or blur.
          const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
          const formatted = digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits
          onChange(formatted)
        }}
        onBlur={() => {
          const v = value.trim()
          if (/^\d{4}$/.test(v)) {
            const y = parseInt(v, 10)
            onChange(`${v}-${String((y + 1) % 100).padStart(2, '0')}`)
          }
        }}
        placeholder={placeholder}
        style={{
          ...style,
          ...(showError ? { borderColor: '#f87171' } : {}),
        }}
      />
      {showError && (
        <p style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, margin: '4px 0 0' }}>
          Enter a valid financial year format (e.g. 2026-27).
        </p>
      )}
    </div>
  )
}

export { isFinancialYearValid }
