// Shared format validators — used by every form field across CRM/ERP so
// invalid emails/GSTINs/websites are caught before submit, not silently
// saved as free text. (Phone validation lives in components/erp/PhoneField,
// which is already wired into every phone field in the app.)

// RFC 5322-lite: good enough to catch obvious garbage ("sfdgdfgsf442sfg")
// without rejecting real-world addresses with +tags, subdomains, etc.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// GSTIN: 2-digit state code, 10-char PAN, 1 entity code digit, 'Z', 1 checksum
// alphanumeric char. 15 characters total.
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

const WEBSITE_RE = /^(https?:\/\/)?([\w-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/[^\s]*)?$/

const PIN_RE = /^\d{6}$/

export function isValidEmail(value: string): boolean {
  if (!value) return true // empty is handled by required-field checks separately
  return EMAIL_RE.test(value.trim())
}

export function isValidGST(value: string): boolean {
  if (!value) return true
  return GST_RE.test(value.trim().toUpperCase())
}

export function isValidWebsite(value: string): boolean {
  if (!value) return true
  return WEBSITE_RE.test(value.trim())
}

export function isValidPinCode(value: string): boolean {
  if (!value) return true
  return PIN_RE.test(value.trim())
}

export const VALIDATION_MESSAGES = {
  email: 'Enter a valid email address (e.g. name@company.com).',
  gst: 'Enter a valid 15-character GSTIN (e.g. 27ABCDE1234F1Z5).',
  website: 'Enter a valid website URL (e.g. https://company.com).',
  pin: 'Enter a valid 6-digit PIN code.',
}
