// Stock by bin now lives on the Bins page (each bin shows what it holds) —
// old links and bookmarks land there.
import { redirect } from 'next/navigation'

export default function StoreBinStockRedirect() {
  redirect('/dashboard/store/bins')
}
