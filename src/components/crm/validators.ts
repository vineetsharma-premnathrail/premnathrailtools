// Re-exported from the app-wide shared module so CRM and ERP forms validate
// emails/GSTINs/websites identically instead of maintaining separate copies.
export { isValidEmail, isValidGST, isValidWebsite } from '@/lib/validation'
