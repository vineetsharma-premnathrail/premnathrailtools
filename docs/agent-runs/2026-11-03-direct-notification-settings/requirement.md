# Direct notifications under Role & Permissions (2026-11-03)

## Requirement (owner, Hindi/English)
Role & Permissions › Notifications shows one thing, code does another. R&D task
assignment notifications reach every role member with full access, while the
assignee gets only a bell line (no Teams). Owner: "sab add karo".

## Root cause
- Two notification paths: role events (notify_event, ~108 call sites, shown in the
  Role editor) and direct sends (notify_user / broadcast_notification, ~191 call
  sites, NOT shown anywhere, channels hard-coded: bell, Teams only if teams=True).
- Role event "Requirement task assigned" = "tell this role about everyone's tasks";
  it skips the assignee. Reads like "notify the assignee".
- R&D heads() falls back to every R&D user when Organization › Department has no
  R&D head, so "head" notices fan out to everyone.

## Decisions (Manager)
1. Every direct notification_type is registered (register_direct) with module,
   label, recipient ("The assignee"…), trigger, kind, default channels.
2. Channels for a direct notification: personal override > union of the user's
   roles' setting (empty list = off) > default. Roles never add recipients.
3. Defaults: approval / reminder / assignment = bell + Teams (owner agreed
   assignment goes to Teams); info/result = bell. Reverses the 2026-10-01
   "Teams only approvals + reminders" rule for assignments only.
4. Role editor shows per module two groups: "Sent to a person directly" (with
   recipient) and "Watch everyone's activity" (role subscriptions).
5. R&D heads() no longer falls back to every R&D user; with no head set the
   notices go to admins and a warning is logged.
