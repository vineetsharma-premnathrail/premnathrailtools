import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-planning',
  pageTitle: 'Production Planning',
  steps: [
    {
      target: 'production-nav-calendar',
      title: 'Planning tab',
      purpose: 'Answers three questions: do we have the material, are the workstations overloaded, and when is each order due?',
    },
    {
      target: 'production-plan-requirements',
      title: 'Material Requirements vs Stock',
      purpose: 'For every component still needed by open work orders: Needed (outstanding), Reserved (already held for them), Free Stock (on hand minus reserved, across all stores) and Shortage. "Covered" in green means Store can supply it; a red number is the quantity missing.',
      why: 'This is MRP (Material Requirements Planning) in its simplest form — finding shortages before the shop floor runs out, not after.',
    },
    {
      target: 'production-plan-include-draft',
      title: 'Include draft orders',
      purpose: 'Tick to also count material for Draft work orders (not yet released).',
      why: 'Useful for looking ahead: drafts are planned work, so ordering their material early avoids a wait at release time.',
    },
    {
      target: 'production-plan-short-only',
      title: 'Shortages only',
      purpose: 'Tick to hide items that are fully covered, so only the problems are listed.',
    },
    {
      target: 'production-plan-pr-btn',
      title: 'Raise PR',
      purpose: 'Shown for a short, bought-out item. Opens a Purchase Request pre-filled with the item, the shortage quantity and the work orders that need it.',
      after: 'You review and submit the PR in Procurement. When the stock arrives, open the work order and click "Top Up Reservation".',
    },
    {
      target: 'production-plan-build-btn',
      title: 'Build',
      purpose: 'Shown when the short item is itself made in-house (it has its own active BOM). Opens a new work order for the shortfall quantity.',
    },
    {
      target: 'production-plan-load',
      title: 'Workstation Load',
      purpose: 'Remaining planned hours of open operations at each workstation, converted into working days using its daily capacity. Green = up to 5 days, amber = 5–10 days, red = over 10 days of queued work.',
      why: 'A red bar is a bottleneck — either add a shift/overtime there, move work to another workstation or push out due dates.',
    },
    {
      target: 'production-plan-schedule',
      title: 'Schedule',
      purpose: 'Each open work order as a bar from planned start to planned end; the filled part is progress. The orange vertical line is today, and red bars are overdue. Click an order number to open it.',
    },
  ],
}

export default config
