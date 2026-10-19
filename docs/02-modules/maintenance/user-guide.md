# Maintenance Module — User Guide

**Module:** Maintenance
**Audience:** Shop-floor supervisors and shift in-charges, maintenance technicians, maintenance head / planner
**Prepared by:** Vineet Sharma
**Date:** 6 October 2026

This guide covers how to *do* things. For how the module works (statuses, rules, metric definitions), see [overview.md](overview.md). Steps marked `<!-- verify against code -->` describe features still being built. Check the screens before relying on them.

---

# Who does what

| You are… | You mainly use | Access you need |
|---|---|---|
| **Supervisor / shift in-charge** | Report a Problem, confirm the repair | The Production or Maintenance app |
| **Technician** | My Jobs, the work order page | The Maintenance app, with Work Orders view and edit |
| **Maintenance head / planner** | Requests, work orders, PM Schedule, Spares, Reports, Assets | The Maintenance app, with Work Orders approve and the other tabs as needed |

If a button you expect is missing, you don't have that permission. Ask an admin to add it in the Permission Matrix.

---

# 1. Report a breakdown from your phone

**With a QR tag on the machine** <!-- verify against code -->
1. Open your phone camera and point it at the QR label on the machine.
2. Tap the link. Sign in with your Microsoft account if asked.
3. The **Report a Problem** form opens with the machine already filled in. Go to step 3 below.

**Without a QR tag**
1. Open the portal → **Maintenance** → **Requests** → **+ Report Breakdown**. The **Report a Problem** form opens.
2. In **Machine / Equipment**, type part of the machine number, name or location and pick it.
3. Choose the **Type**:
   - **Breakdown**: it has failed.
   - **Abnormality**: it still runs, but with noise, a leak, vibration or overheating.
   - **Safety**: a guard, an interlock or an electrical hazard.
   - **Improvement**: a change you'd like made.
4. If the machine has stopped, tick **Machine is stopped**. This starts the downtime clock and blocks the machine in Production until it is fixed.
5. **When did it happen?** defaults to now. If it stopped earlier (for example at 02:10 on night shift), change it. Downtime counts from this time.
6. Leave **Priority** as suggested, unless you know better. It is set from the machine's criticality and whether it has stopped.
7. Under **What's wrong?**, write what happened and what you saw or heard.
8. Under **Photos**, take a photo of the problem.
9. Tap **Raise Request**. Every maintenance user of your plant gets a notification.

You can follow your request under **Requests**. You only see the requests you raised.

---

# 2. Confirm the repair (supervisor)

When maintenance marks the job completed, you get a bell notification: "MWO-… done — please confirm".

1. Open the notification, or go to **Requests** and open your request.
2. Check the machine on the floor.
3. Tap **Yes, it's working** if it's fine. The maintenance head can now close the job.
4. Tap **No, still a problem** if it isn't. Write what's still wrong. The job goes back to the technician.

The job can't be closed until you confirm. If you're away, an admin can confirm on your behalf.

---

# 3. Triage a new request (maintenance head)

1. Go to **Maintenance** → **Requests**, or use **Open requests** on the Dashboard. Urgent ones are marked.
2. Open the request and read the problem and photos.
3. Choose one:
   - **Acknowledge**: "We've seen it." This is optional, but it tells the floor you're on it.
   - **Create Work Order**: confirm the job type, priority and title, and pick a technician. The downtime clock carries over from the original report time.
   - **Mark Duplicate**: someone already reported it. Give the existing request number as the reason.
   - **Reject**: give a reason. The requester sees it.

---

# 4. Handle a work order end to end (technician)

Find your jobs under **Work Orders** with **My jobs** ticked, or on the Dashboard under **My work orders**.

1. **Start Job.** Tap it when you begin work. If the machine is down, its status changes to Under Maintenance.
2. **Spares.** In the Spares section, tap **Issue from Store**:
   - Pick the spare and the store, then enter the quantity.
   - The stock is taken out of Store against this job straight away.
   - If there isn't enough, the message tells you how many are available. Issue what's there, ask Store to transfer stock in, or ask the head to raise a PR.
3. **Waiting?** Tap **Put On Hold** and give the reason, for example "waiting for bearing" or "OEM engineer coming Thursday". Tap **Resume** when you're back on it.
4. **Checklist.** Mark every line **OK**, **Not OK** or **N/A**. Enter the measured value where one is asked for. You can't complete the job with blank lines.
5. **Labour.** Tap **+ Log Time**. Enter who worked and either the hours or the start and end times. Leave the hourly rate at 0 unless your plant has agreed a rate.
6. **Unused spares.** Tap **Return** on the spare line. The unused quantity goes back into Store stock.
7. **Mark Completed.** Fill in:
   - **Failure category**: what kind of failure it was (mechanical, electrical, hydraulic and so on).
   - **Root cause**: *why* it failed, not just what broke. For example, "Bearing seized because the lubrication line was blocked", not "Bearing failed".
   - **Action taken**: what you did.
   - **Handed back at**: when the machine was back in use. This stops the downtime clock.

   Breakdown and corrective jobs can't be completed without the first three. They feed the repeat-failure reports.
8. If the job came from a request, the requester is asked to confirm. If they say it's still not OK, the job comes back to you as In Progress with their comment.

---

# 5. Close, reopen or cancel a job (maintenance head)

- **Verify & Close.** Open a **Completed** job and tap **Verify & Close**. This freezes its cost and puts the machine back to Operational, if nothing else is open on it. If the job came from a request, you can only close it after the requester confirms. The button is disabled until then.
- **Reopen.** Opens a Completed job again. Give the reason.
- **Cancel.** Possible only for Draft, Assigned or On Hold jobs. Give a reason. Any spares issued to the job must be returned first. A cancelled job from a request sends the request back to Acknowledged, so you can create a new job or reject it.
- **Jobs waiting for you.** The Dashboard lists **Awaiting close**, and shows which jobs are still waiting for the requester.

---

# 6. Set up a preventive maintenance (PM) plan <!-- verify against code -->

1. Go to **Maintenance** → **PM Schedule** → **New Plan**.
2. Fill in the basics:
   - **Asset**: the machine.
   - **Title**: for example "Monthly lubrication & oil level check".
   - **Job Type**: Preventive, Calibration or Inspection.
   - **Instructions**: anything the technician should know. These are copied onto every job.
3. **Every.** Set the interval, for example 1 Month, 3 Months (quarterly) or 1 Year.
4. **Next Due From.** Choose how the next date is worked out:
   - **Due date (fixed calendar)**: the next job is one interval after the *due date*, even if the last one was done late. Use this for statutory inspections, calibration and anything you plan shutdowns around.
   - **Last completion (floating)**: the next job is one interval after the job was *actually done*. Use this for oil and filter changes and other wear-based servicing.
5. **Next Due Date.** When the first job falls due.
6. **Lead Days.** How many days before the due date the job should appear. The default is 3. Use more for jobs that need a shutdown planned.
7. **Default Technician.** They get the job automatically. Leave it blank if you want to assign each time.
8. Tick **Requires shutdown** if the machine must stop for the job. It is blocked in Production only once the technician starts the job, not before.
9. **Checklist.** Add one line per check, with the expected value where there is one (for example "Oil level: between min and max marks").
10. **Spares kit.** Add the spares the job always uses. They are copied onto each job as planned quantities, from the plant's default store.
11. Click **Save**.

**What happens next**
- Every morning at 06:00 the system raises the job when it is within the lead days of the due date.
- To raise the next job immediately, open the plan and click **Generate now**.
- When the job is **closed**, not just completed, the plan moves to its next due date. **Close PM jobs promptly**, or the next one won't be raised.
- If a PM job is still open after its due date, the technician and the maintenance heads get a reminder every morning on Teams and in the bell.
- To skip one occurrence, cancel that job with a reason. The plan moves on to the following date.
- To stop a plan, edit it and untick **Active**. Delete it only if it was a mistake. A plan with an open job can't be deleted.

---

# 7. Keep the bill of spares and raise a PR for low spares <!-- verify against code -->

**Bill of spares (per machine)**
1. Open the asset → **Spares**.
2. Add each spare the machine uses, with the **Qty per replacement** (for example 2 for a pair of bearings).
3. Tick **Critical** for the spares that would stop the line if you ran out.
4. Save.

For a critical spare to be watched, Store must have a **minimum stock** (or reorder level) set on the item. If it shows "No min set" on the Spares page, ask Store to set one.

**Spares page**
1. Go to **Maintenance** → **Spares**.
2. Tick **Below minimum only** and/or **Critical only** to see what needs ordering. Critical items that are below minimum are listed first.
3. Each row shows the stock in each store, the minimum and reorder level, which machines use it, and how many were used in the last 90 days.

**Raise a PR**
1. On a below-minimum row, click **Raise PR**. To order several items together, tick them and click **Raise PR for selected**.
2. The P2P purchase request form opens with the items and suggested quantities filled in. Check them and submit as normal.
3. This needs the P2P app. If you don't have it, the page tells you to ask someone who does.

When an issue drops a critical spare below its minimum, the maintenance heads of that plant get a Teams and bell reminder, at most once a day per item.

---

# 8. Read the reports (maintenance head and management)

Go to **Maintenance** → **Reports**. Pick the period (it defaults to this month) and optionally a plant, a machine or a category. Click **Export** for an Excel copy with one sheet per section.

| Number | What it means | What good looks like |
|---|---|---|
| **Downtime** | Hours machines were stopped by breakdowns in the period | Going down month on month |
| **MTTR** | Average time to get a broken machine running again | Low. If it's high, check On Hold reasons: usually waiting for spares or a vendor. |
| **MTBF** | Average running hours between breakdowns | High and rising. This is the proof that PM is working. |
| **Availability %** | Share of working hours the machines weren't broken down. Planned PM stops don't count against it. | Above 95% for critical (A) machines |
| **PM compliance %** | PM jobs done on or before the due date, out of those that fell due | 90% or more |
| **Breakdown vs Planned** | Unplanned jobs against planned (PM, calibration, inspection) jobs | Planned share growing towards 80% |
| **Maintenance cost** | Spares + labour + outside vendor, for jobs finished in the period | Watch the top machines, not just the total |
| **Top 10** | Machines with the most breakdowns and the most downtime | Your improvement list |
| **Backlog** | Open jobs by age and priority | Few jobs over 30 days old |
| **Failure Pareto** | Which failure categories cause most jobs | Attack the top one or two |

How to use them:
- Start with **Top 10 by downtime**. One or two machines usually cause most of the lost hours.
- For those machines, look at the failure categories and root causes in their **History**. Then fix the cause: a new PM plan, a design change or a critical spare.
- If **PM compliance** is low, the PM plans aren't being worked. Fix that before adding more plans.
- Available hours use the plant's working hours and days (or the linked workstation's capacity). **Holidays are not deducted**, so availability is slightly overstated in holiday months.

---

# 9. Import your machine list from Excel <!-- verify against code -->

1. Go to **Maintenance** → **Assets** → **Import from Excel**.
2. Download the **template** and open it.
3. Fill one row per machine:
   - **Required**: `name`, `category`, `plant`.
   - **Useful**: `asset_code` (your machine number; leave it blank to auto-number EQ-0001…), `location`, `make`, `model`, `serial_number`, `criticality` (A, B or C), `commissioned_on`, `workstation_code` (to link a Production workstation).
   - Plant must match the plant name or code in Organization → Plants exactly.
4. Save the file as `.xlsx` and upload it.
5. Click **Validate**. Every row is checked and nothing is saved. Fix any rows listed with errors and upload again.
6. When there are no errors, click **Import**. All rows are saved together. If any row fails, nothing is saved, so you never end up with half a list.

There is a limit of 2,000 rows per file. Machine numbers must be unique, both in the file and against machines already in the register.

After the import, open the critical (A) machines and add their warranty and AMC dates, bill of spares and PM plans.

---

# 10. Watch AMC and warranty expiry <!-- verify against code -->

1. On each machine (**Assets** → open → **Edit**), fill in **Warranty Expiry**, **AMC Vendor** and **AMC Expiry** under "Warranty, AMC & Meter".
2. Go to **Maintenance** → **AMC & Warranty** to see every machine's cover. It shows what is active, what is expiring soon and what has expired.
3. Every morning (06:15) the maintenance heads get a reminder on Teams and in the bell for cover that is about to expire, so the AMC can be renewed in time.
4. Before you fix a breakdown in-house, check this page. If the machine is under warranty or AMC, call the vendor. Record them as the **External Vendor** on the job, with their charge (if any) as **External Cost**.

---

# 11. Common messages and what to do

| Message | What to do |
|---|---|
| "Can't start MWO-…: assign a technician first." | Tap **Assign Technician**, pick someone, then start. |
| "A breakdown work order needs failure category, root cause, action taken…" | Fill in all three in the Mark Completed dialog. |
| "N checklist line(s) have no result yet…" | Mark each line OK, Not OK or N/A. |
| "Only X of Y '…' available at …" | Issue what's available, ask Store to transfer stock in, or raise a PR. |
| "Can't close MWO-… yet: waiting for … to confirm…" | Ask the requester to open their request and confirm. An admin can confirm on their behalf. |
| "Can't cancel MWO-…: N spare line(s) were issued from Store and not returned." | Return the unused spares first, then cancel. |
| "Breakdown and Under Maintenance are set automatically…" | You can only set Operational, Standby or Decommissioned by hand. Close or cancel the open jobs instead. |
| "Can't delete … it has maintenance history…" | Set the machine to **Decommissioned** instead. |
| "… already has an open work order…" (Generate now) | Finish or cancel the open PM job first. |
| "… is Completed but not closed yet." (Generate now) | Close that PM job. Closing moves the plan to its next date. |
