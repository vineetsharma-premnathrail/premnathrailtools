// Saves a Blob as a file (the Excel exports).
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** ASCII file name such as erp_turnaround_2026-10-01_to_2026-10-26.xlsx. */
export function exportFilename(module: string, report: string, from?: string, to?: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_')
  return `${safe(module)}_${safe(report)}${from && to ? `_${from}_to_${to}` : ''}.xlsx`
}
