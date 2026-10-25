# Plan (Manager)

Size: M/L (20+ files, shared components). Pipeline used:
1. Find (read-only, parallel): uiux-agent, accessibility-agent, reviewer-agent
2. Triage (Manager): merged 3 lists, dropped owner-decision items
3. Fix (parallel, disjoint files): frontend-agent x3 (shared components / P2P pages / workflow+quotation+service+role+security), backend-agent (vendor lists by code)
4. Verify: reviewer-agent + qa-agent -> found 2 MAJOR + 6 minor regressions in the fixes
5. Fix-retest round 1: frontend-agent x2 (shared / page-level)
6. Final checks by Manager: tsc + test:ui clean
Not done: browser verification (needs the owner's running app and sign-in).
