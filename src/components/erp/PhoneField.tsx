'use client'

export function sanitizePhone(value: string): string {
  return value.replace(/[^\d\s+\-()]/g, '')
}

export function isPhoneValid(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length === 0 || (digits.length >= 7 && digits.length <= 15)
}

export default function PhoneField({
  value,
  onChange,
  placeholder = '+91 98765 43210',
  style,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  style?: React.CSSProperties
}) {
  const digits = value.replace(/\D/g, '')
  const valid = isPhoneValid(value)

  return (
    <div>
      <input
        value={value}
        maxLength={15}
        onChange={(e) => onChange(sanitizePhone(e.target.value))}
        placeholder={placeholder}
        style={{
          ...style,
          ...(digits.length > 0 && !valid ? { borderColor: '#f87171' } : {}),
        }}
      />
      {digits.length > 0 && !valid && (
        <p style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, margin: '4px 0 0' }}>
          Enter a valid phone number (7–15 digits).
        </p>
      )}
    </div>
  )
}
