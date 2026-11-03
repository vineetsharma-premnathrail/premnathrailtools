# UAT: role-wise screen visibility (Purchase Requisitions)

Purpose: prove that a role can narrow what its members see on the Purchase Requisition form and list, and that the narrowing is removed again when a wider role is added. Nothing here uses real data: create a test role and a test user, delete both at the end.

Before you start
- The database change has been applied on your local machine and the portal is running at http://localhost:3000.
- You need: one admin login (yours), one ordinary test user with the Procurement app assigned and no other roles ("Test Keeper").
- Use a private/incognito window for the Test Keeper so you stay signed in as admin in the normal window.

## A. Build the narrow role (as Admin)

1. Sign in as Admin. Go to Organization, then Role & Permissions, then click New Role.
   Expected: an empty role form opens.
2. Name the role "Store Keeper (test)". In the Permission Matrix open Procurement, then Purchase Requisitions, and tick View and Create.
   Expected: both boxes stay ticked on that row.
3. On the same Purchase Requisitions row, find the chip "Visibility: shows everything" and click it.
   Expected: a popup "Visibility - Purchase Requisitions" opens with three groups: Sections, Dropdowns, Tables.
   Failure looks like: no chip on the row, or the popup is cut off / hidden behind the page.
4. In Sections, look at "Purpose & Charging" and "Item Details".
   Expected: both are ticked, cannot be unticked, and say "Always shown (has a required field)".
5. In Sections, untick "Remarks".
   Expected: Remarks shows a "Hidden" tag.
6. In Dropdowns, find Purpose and switch "All values" off. Untick every value except "Store stock refill".
   Expected: only "Store stock refill" stays ticked.
7. Still on Purpose, untick "Store stock refill" as well so none is ticked, then click Apply.
   Expected: a red message "Pick at least one Purpose value, or switch it back to All values." and the popup stays open. Tick "Store stock refill" again.
8. In Tables, under "Requisitions list", untick the column "Priority".
   Expected: Priority shows a "Hidden" tag.
9. Click Apply.
   Expected: the popup closes and the chip now reads something like "Visibility: 1 section hidden, Purpose: 1 of 6 values, 1 column hidden".
10. Click Save on the role.
    Expected: the role saves with a success message and appears in the role list.
    Failure looks like: a red message naming a section or a value (a real reason is shown, not "Something went wrong").
11. Re-open the role and the Visibility chip.
    Expected: your choices (Remarks hidden, only Store stock refill, Priority column hidden) are still there.

## B. Give the role to the test user (as Admin)

12. In the role, open the Users tab (or go to the test user and assign roles) and add "Test Keeper".
    Expected: Test Keeper now shows as a member of "Store Keeper (test)".

## C. What the narrow user sees (as Test Keeper, private window)

13. Sign in as Test Keeper. Go to Procurement, then New Requisition.
    Expected: the form opens normally.
14. Open the Purpose dropdown.
    Expected: only "Store stock refill" is offered (not Project, Service, New development, Department running cost, Asset / capital purchase).
15. Scroll the form.
    Expected: Purpose & Charging, Request Details (Required Date, Priority) and Item Details are all there. The Remarks block is not on the form. Attachments is still there.
    Failure looks like: Remarks still visible, or a required section missing.
16. Pick Store stock refill, add one item and raise the requisition.
    Expected: it saves and gets a requisition number.
17. Go to the Purchase Requisitions list.
    Expected: the list shows your requisition. The Priority column is not there. PR number, Status and the other columns (Category, Project, Required By) are still there.
18. Open the saved requisition for editing, change only the Project name and save.
    Expected: it saves without any visibility message.
19. (Optional, needs a developer tool such as the browser Network tab or an API client; skip if not comfortable.) Send a create request by hand with Purpose set to "customer_order".
    Expected: refused with status 422 and the message "Purpose 'Project' isn't available to your role - you can pick: Store stock refill. Ask an admin to widen it in Organization > Role & Permissions > Procurement > Purchase Requisitions > Visibility."
    Failure looks like: the requisition is created, or the message is a generic error.

## D. Widen with a second role (as Admin, then Test Keeper)

20. As Admin create a second role "Requisition Open (test)" with Procurement, Purchase Requisitions, View ticked only, and do NOT open its Visibility chip. Save, and add Test Keeper to it.
    Expected: the chip on that row still reads "Visibility: shows everything".
21. As Test Keeper, refresh the page (or sign out and in) and open New Requisition, then the Purpose dropdown.
    Expected: all six purposes are offered. Remarks is back on the form. The list shows the Priority column again.
    Why: a person holding two roles gets the wider of the two (roles add access, never take it away).
22. As Admin, edit "Requisition Open (test)" and remove the Purchase Requisitions View tick (leave the role otherwise empty). Save.
    Expected: Test Keeper, after a refresh, is narrowed again: only Store stock refill, no Remarks, no Priority column. A role that does not open the screen does not widen it.
23. As Admin, edit "Requisition Open (test)" and tick Purchase Requisitions View again. Save. As Test Keeper, refresh.
    Expected: everything is offered again. (Setting the role to inactive instead of removing the tick should narrow Test Keeper again.)

## E. Admin and Partner are never narrowed

24. As Admin, add "Store Keeper (test)" to your own account (Users tab of the role, add yourself), then refresh. Open Procurement, then New Requisition.
    Expected: all six purposes, Remarks, and the Priority column on the list are all visible. Admins are never narrowed.
25. If you have a Partner login: add the same role to that account as well and repeat step 24.
    Expected: same result, everything visible.

## F. Things that must be refused (as Admin)

26. Edit "Store Keeper (test)", open the Visibility chip. Try to untick "Purpose & Charging".
    Expected: you cannot (it is locked). If a request is forced by hand, it is refused with "'Purpose & Charging' holds a required field, so it can't be hidden. Leave it visible."
27. Tick all six Purpose values and Apply.
    Expected: the chip goes back to showing only the other changes (Remarks, Priority column), or "shows everything" if nothing else is set. Purpose is treated as unrestricted.
28. Log in as a user without the Role & Permissions Edit right, open the same role.
    Expected: the Visibility chip opens read-only (no Apply button) or the role cannot be edited at all, and no change is possible.

## G. Clean up

29. As Admin remove yourself (and the Partner, if added) from "Store Keeper (test)".
    Expected: your account shows no test roles.
30. Delete "Store Keeper (test)" and "Requisition Open (test)" from the role list.
    Expected: both disappear; Test Keeper falls back to no extra roles. Delete or deactivate the Test Keeper user if you created it only for this test.
31. Check the requisition you raised in step 16 is only test data, and cancel it if your process allows.
    Expected: it is cancelled or clearly marked as test.

## Not covered by this script
- Item-line columns on the form (Make, Part Code, UOM, In Stock, Ship To): hide one in step 8's group "Item lines on the form" and confirm it disappears from the item table on New Requisition. Only the code is checked automatically.
- Phone width (390x844) and laptop width (1366x768) of the Visibility popup and of the New Requisition form with Remarks hidden: look for clipped content or odd empty gaps.
- Hiding a section only hides it on screen; the server does not refuse data for hidden sections or columns (by design, see spec section 2). Only dropdown values are refused by the server.
