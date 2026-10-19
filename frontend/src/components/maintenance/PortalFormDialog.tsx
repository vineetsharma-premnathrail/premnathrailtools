'use client'

import FormDialog from '@/components/maintenance/FormDialog'

/** Kept for its callers: FormDialog is now a FormSheet, which always renders
 * into document.body, so this is a straight pass-through. */
export default function PortalFormDialog(props: React.ComponentProps<typeof FormDialog>) {
  return <FormDialog {...props} />
}
