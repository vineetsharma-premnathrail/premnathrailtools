# Approval emails with one-click Approve / Reject

**Requested 2026-10-27 by the owner:** "every approval send a mail to approver, show the details, and let them approve with a comment from the mail in one click."

**Where it sits in the core flow:** across the whole flow. Every module routes approvals through the central approval engine (Organization), so the email goes out for PR, PO, Store, Design, Sales, Finance, HR, Quality and the rest.

## Decisions
| Point | Decision | By |
|---|---|---|
| Login needed for the link | Never (signed link only) | Owner |
| Actions in the mail | Approve and Reject; Return stays in the portal; Reject needs a reason | Owner |
| What clicking does | Opens a confirm page with the details and a comment box; only Confirm (POST) decides | Manager. Mail scanners such as Safe Links open every link, so a link that approved on GET would approve things nobody read |
| Link validity | 72 hours. One step and one person. Stops when the step is decided, skipped, handed over or cancelled | Manager |
| Token storage | No new table: a signed token whose state comes from the step itself | Manager |
| Details in the mail | Generic fields, the type's context fields and earlier decisions; line items for PR and PO | Manager |
| When the mail goes out | After commit, from a background thread | Manager |

## Size
M: backend only, no migration, one module plus a hook.
