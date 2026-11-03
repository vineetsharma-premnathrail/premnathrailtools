// While a Role-editor "Preview & choose" overlay is open, the sample screen inside it must never write.
// Screens already skip their saves in preview; this is the safety net at the API layer (lib/api.ts).
let openPreviews = 0

export function beginPreviewWriteGuard(): () => void {
  openPreviews += 1
  return () => { openPreviews = Math.max(0, openPreviews - 1) }
}

export function previewBlocksWrites(): boolean {
  return openPreviews > 0
}
