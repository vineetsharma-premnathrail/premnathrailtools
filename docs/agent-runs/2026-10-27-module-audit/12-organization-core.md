# Organization / Users / Roles / Approval engine / Auth / Reports — audit 2026-10-27

## High
1. **Someone else's approvals can be delegated to yourself.** A Delegations-Create holder can delegate a Partner's approvals to themselves (organization/routes/delegations.py:47-104).
2. **A non-admin workflow editor can switch approval off.** Putting a never-matching condition on every stage makes submit() auto-approve; the guard is only a warning (approval_engine.py:1229, 695-726).
3. **A Department or Branch editor can make themselves head, and so an approver** (department.py:196-218, branch.py:141-157).
4. **Expired temporary roles still widen data scope:** user_scope ignores GRC validity (core/data_scope.py:113-124).

## Medium
5. An "every one must approve" stage can be passed by one person (an escalation target or a delegate of several approvers).
6. Any module-Settings editor can switch approvals off or raise the auto-approve limits (settings_framework.py:515).
7. Azure Global Admins become portal admins permanently, and this is never reset (auth.py:234, azure_sync.py:118).
8. The login page accepts `?token=` from the URL and stores it in localStorage, which allows session fixation (login/page.tsx:36, authStore.ts:83).
9. Idle timeout does not work: it is measured from the last refresh, and background polling keeps the session alive (security.py:146-153).
10. The Management Cockpit ignores data scope and the money right (analytics.py:226-240).
11. A non-admin can make another user's temporary access permanent (grc.py:68-118).
12. A user can widen their own scope by adding themselves to plants or departments (branch.py:346, department.py:135).
13. The workflow self-naming guard has a loophole: once named anywhere, the editor can add themselves to every stage (approval_engine.py:1100).
14. A Users-Edit holder can set approval flags (director, finance manager) on colleagues (users.py:607-660).

## Low
15. An admin standing in skips the module's segregation-of-duties checks.
16. Any Cancel holder can cancel approval requests outside their scope.
17. The Teams sign-in replay cache can be poisoned before the token is verified.
18. A Teams keys (JWKS) fetch failure gives a raw 500.
19. Production safety depends on the environment variable: secret guard, /docs hiding and SECURE_COOKIES default to off (verify on prod).
20. The "access token minutes" security setting is not applied to the cookie.
21. Re-use of a stolen refresh token does not revoke the session.
22. The Cockpit shows raw exception text.
23. "Who's viewing" leaks across data scope.
24. Phantom permission: Delegations › Delete has no endpoint.
25. require_admin checks role only, not Azure admins.
26. The Effective Permissions panel shows expired roles as held.
27. Role "assign-to rules" need no feature permission.
28. A non-admin Security editor can act on admin accounts (revoke sessions, send temporary passwords).

Clean: sign-in, CSRF, cookies, role-grant guards, engine row locks, four-eyes, F821, UI rules.
