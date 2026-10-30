// Two-value priority used app-wide: Standard (default) and Urgent.
// Mirrors backend/app/core/priority.py. Never add a third value.

export type Priority = 'standard' | 'urgent';

export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'urgent', label: 'Urgent' },
];

export const DEFAULT_PRIORITY: Priority = 'standard';

const LEGACY_URGENT = new Set(['urgent', 'critical', 'high']);

/** Collapse any stored value (including legacy low/medium/high/critical rows) to a Priority. */
export function normalizePriority(v?: string | null): Priority {
  return LEGACY_URGENT.has(String(v ?? '').trim().toLowerCase()) ? 'urgent' : 'standard';
}

export function isUrgent(v?: string | null): boolean {
  return normalizePriority(v) === 'urgent';
}

export function priorityLabel(v?: string | null): string {
  return isUrgent(v) ? 'Urgent' : 'Standard';
}

export type PriorityTone = { color: string; bg: string };

/** Badge colours: red for Urgent, neutral grey for Standard. */
export function priorityTone(v?: string | null): PriorityTone {
  return isUrgent(v)
    ? { color: '#b91c1c', bg: '#fee2e2' }
    : { color: '#475569', bg: '#f1f5f9' };
}
