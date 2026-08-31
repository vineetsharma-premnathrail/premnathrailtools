# ERP-PremnathRail — Bug Tracking

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Testing
**Document:** Bug Tracking
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines how defects in ERP-PremnathRail are identified, recorded, prioritized, assigned, fixed, verified, and closed.

It establishes a standard defect lifecycle so that every important defect can be traced from discovery to resolution.

---

# 2. Current State

At present, no dedicated bug-tracking system has been confirmed as actively used for ERP-PremnathRail.

There is currently no confirmed:

* GitHub Issue template
* Jira workflow
* Linear project
* Trello bug board
* Dedicated in-repository defect register

Git commits may contain references to fixes, but commit history alone does not provide a complete defect lifecycle.

Therefore, this document defines the standard process to be used until an official tracking tool is adopted.

---

# 3. Bug Lifecycle

```text
Bug Discovered
      ↓
Bug Report Created
      ↓
Triage
      ↓
Severity Assigned
      ↓
Priority Assigned
      ↓
Assigned to Owner
      ↓
Investigation
      ↓
Fix Implemented
      ↓
Regression Test
      ↓
Verification
      ↓
Accepted
      ↓
Closed
```

If verification fails:

```text
Verification Failed
       ↓
Reopen
       ↓
Fix
       ↓
Retest
```

---

# 4. Bug Status

| Status                 | Meaning                              |
| ---------------------- | ------------------------------------ |
| New                    | Bug has been reported                |
| Triaged                | Bug has been reviewed and classified |
| Assigned               | Owner has been identified            |
| In Progress            | Investigation/fix is underway        |
| Fixed                  | Developer has implemented the fix    |
| Ready for Verification | Fix is ready for testing             |
| Verified               | Fix has been successfully tested     |
| Reopened               | Problem still exists                 |
| Closed                 | Bug is completely resolved           |

---

# 5. Bug Severity

Severity describes the technical/business impact of the defect.

| Severity | Meaning                                           |
| -------- | ------------------------------------------------- |
| Blocker  | Prevents critical application/business operation  |
| Major    | Important functionality is significantly affected |
| Minor    | Limited functionality is affected                 |
| Cosmetic | Visual or non-functional issue                    |

---

# 6. Bug Priority

Priority determines how quickly the defect should be addressed.

| Priority | Meaning                                 |
| -------- | --------------------------------------- |
| Critical | Immediate attention                     |
| High     | Fix in the current development cycle    |
| Medium   | Schedule according to business priority |
| Low      | Fix when appropriate                    |

Severity and priority should be recorded separately.

---

# 7. Required Bug Information

Every bug should contain enough information for another person to reproduce and investigate it.

Minimum information:

```text
Bug ID:

Title:

Module:

Severity:

Priority:

Environment:

Browser / Device:

Application Version:

Reported By:

Reported Date:

Found During:

Steps to Reproduce:

Expected Result:

Actual Result:

Screenshots / Logs:

Assigned To:

Related Requirement:

Related Test Case:

Fix / PR:

Verification Result:

Status:
```

---

# 8. Module Classification

Bugs should be associated with the affected application module.

Current module categories include:

```text
ERP
CRM
R&D
Purchase
P2P
Main / Platform
Design
Electrical
HR
Store
Vendor
```

Additional modules should be added as ERP-PremnathRail expands.

---

# 9. Environment

The environment should be recorded because the same defect may occur only in a specific environment.

Examples:

```text
Development
Testing
Staging
Production
```

The report should also record the relevant browser, operating system, or device when applicable.

---

# 10. Bug Reporting Process

When a user or tester discovers a defect:

```text
1. Confirm the problem.
2. Attempt reproduction.
3. Record the required information.
4. Identify the affected module.
5. Assign severity.
6. Create the bug record.
```

Duplicate reports should be linked to the existing defect instead of creating unnecessary duplicate records.

---

# 11. Bug Triage

During triage, the responsible project/technical owner determines:

* Whether the reported behavior is actually a defect.
* Affected module.
* Severity.
* Priority.
* Reproducibility.
* Business impact.
* Required owner.
* Related requirement or test case.

Possible triage outcomes:

```text
Valid Bug
Duplicate
Not a Bug
Cannot Reproduce
Needs More Information
Change Request
```

A feature request or scope change should not automatically be classified as a bug.

---

# 12. Bug Assignment

After triage, the defect is assigned to the appropriate technical owner.

The owner is responsible for:

* Investigation
* Root-cause identification
* Implementation of the fix
* Appropriate regression testing
* Providing the fix for verification

---

# 13. Investigation

The developer should investigate the defect across the appropriate layers.

```text
UI
 ↓
Frontend
 ↓
API
 ↓
Backend Logic
 ↓
Database
 ↓
External Integration
```

The investigation should identify the actual cause rather than only hiding the visible symptom.

---

# 14. Fix Implementation

A fix should be implemented through the normal development process.

Where applicable:

```text
Bug
 ↓
Code Change
 ↓
Test
 ↓
Review
 ↓
Merge
 ↓
Deployment
```

The bug record should reference the relevant commit or pull request where the tracking system supports it.

---

# 15. Regression Testing

A fixed defect should not simply be marked closed because the developer believes the fix works.

The affected functionality must be tested again.

Where practical, a regression test should be added or updated so that the same defect can be automatically detected in future testing.

---

# 16. Verification

The tester or responsible reviewer verifies:

1. Original reproduction steps.
2. Expected result.
3. Actual result after the fix.
4. Related functionality.
5. Regression impact.

If the defect is resolved:

```text
Ready for Verification
        ↓
Verified
        ↓
Closed
```

If it remains:

```text
Ready for Verification
        ↓
Failed
        ↓
Reopened
```

---

# 17. Production Bugs

Production defects require additional attention because they may affect active business operations.

A production bug may also qualify as a production incident.

When the issue has significant operational impact, the **Incident Runbook** should be followed in addition to this bug-tracking process.

```text
Production Problem
       ↓
Assess Impact
       ↓
Incident?
   ┌───┴───┐
  Yes      No
   ↓        ↓
Incident   Bug
Process    Process
```

---

# 18. UAT Bugs

Defects discovered during User Acceptance Testing should be connected to the relevant UAT test case.

Example:

```text
UAT Test Case
      ↓
Bug ID
      ↓
Fix
      ↓
Retest
      ↓
UAT Acceptance
```

A critical unresolved UAT defect should normally prevent acceptance of the affected functionality until formally accepted or waived by the appropriate authority.

---

# 19. Bug Tracking Tool

The official tracking tool should be selected and approved as the project evolves.

Until a dedicated system is formally adopted, the project should maintain a structured defect register rather than relying only on Git commit messages.

Once a tool is selected, this document should be updated with:

* Tool name
* Project/board location
* Workflow
* Labels
* Permissions
* Reporting process
* Retention requirements

---

# 20. Recommended Labels

A future issue tracker may use labels such as:

```text
module:erp
module:crm
module:rnd
module:purchase
module:p2p
module:main

severity:blocker
severity:major
severity:minor
severity:cosmetic

priority:critical
priority:high
priority:medium
priority:low
```

---

# 21. Bug Traceability

Important bugs should be traceable across the development lifecycle.

```text
Requirement
    ↓
Test Case
    ↓
Bug
    ↓
Code Change
    ↓
Regression Test
    ↓
Verification
    ↓
Release
```

This provides a clear relationship between business requirements, testing, development, and release.

---

# 22. Bug Metrics

Once sufficient defect data exists, the project may track:

* Open bugs
* Closed bugs
* Blocker bugs
* Major bugs
* Reopened bugs
* Average resolution time
* Bugs by module
* Bugs by release
* Production defects
* UAT defects
* Regression defects

Metrics should be introduced only when the project has enough reliable data to make them meaningful.

---

# 23. Change Management

This document should be updated when:

* A bug-tracking platform is adopted.
* The defect workflow changes.
* Severity definitions change.
* Priority definitions change.
* New modules are introduced.
* UAT procedures change.
* Production incident handling changes.
* Automated defect tracking is introduced.

---

# 24. Historical Records

Bug records should **not be deleted simply because the bug is closed**.

Closed defects provide historical traceability.

The record should retain:

```text
Original Report
↓
Investigation
↓
Fix
↓
Verification
↓
Closure
```

If the bug-tracking platform supports history/versioning, those records should be retained according to the organization's retention policy.

---

# 25. Related Documents

* Test Plan
* Test Cases
* User Acceptance Testing
* CI/CD
* Release Management
* Incident Runbook
* Requirements / BRD
* PRD
* Change Management

---

# 26. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 27. Document Information

**Document:** Bug Tracking
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Testing
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
