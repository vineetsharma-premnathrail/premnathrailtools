# User Acceptance Testing (UAT)

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Testing
**Document:** User Acceptance Testing
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Template

---

# 1. Purpose

This document defines the User Acceptance Testing (UAT) process for ERP-PremnathRail.

UAT validates the application from a **business-user perspective** and confirms that implemented functionality satisfies the approved business requirements before release.

This document is a reusable UAT template. A completed UAT cycle must be maintained separately for each release or applicable module.

---

# 2. UAT Principles

UAT shall:

* Be performed by an actual business user.
* Validate business workflows rather than implementation details.
* Use a staging or approved test environment.
* Use representative test data.
* Record Pass, Fail, or Pass with Notes.
* Link failures to bug records.
* Require resolution or formal acceptance of critical failures before release.
* Maintain historical UAT results for completed releases.

The developer who implemented the functionality should not be the sole person performing its business acceptance.

---

# 3. UAT Process

```text
Approved Requirement
        ↓
UAT Scenario
        ↓
Business User Testing
        ↓
Pass / Fail
        ↓
Bug Logged if Failed
        ↓
Fix
        ↓
Retest
        ↓
Final Sign-Off
```

---

# 4. UAT Entry Criteria

UAT should begin when:

* Required functionality is available.
* Relevant development/testing is complete.
* The deployment is available in the approved test environment.
* Required test data is available.
* Known blocking defects have been addressed.
* The UAT tester has access to the required modules and permissions.

---

# 5. UAT Exit Criteria

A UAT cycle may be completed when:

* Required scenarios have been executed.
* Critical business workflows have passed.
* Critical/blocking defects are resolved or formally accepted.
* Failed scenarios have been retested.
* Business users have provided their acceptance decision.
* Final sign-off has been recorded.

---

# 6. Cross-Module Baseline

This baseline should be executed for every applicable release.

| ID           | Acceptance Criteria                                                          | Result | Notes / Bug |
| ------------ | ---------------------------------------------------------------------------- | ------ | ----------- |
| UAT-BASE-001 | User can log in through Microsoft OAuth using an authorized company account. |        |             |
| UAT-BASE-002 | Unauthorized email-domain login is rejected.                                 |        |             |
| UAT-BASE-003 | Inactive/deactivated users cannot access protected functionality.            |        |             |
| UAT-BASE-004 | Session remains valid after page refresh.                                    |        |             |
| UAT-BASE-005 | Logout terminates the user's session.                                        |        |             |
| UAT-BASE-006 | User sees only assigned modules and authorized functionality.                |        |             |
| UAT-BASE-007 | Authorized cross-department data can be accessed where permitted.            |        |             |

**Sign-off**

Tester: ____________________
Date: ____________________
Result: Pass / Fail / Pass with Notes

---

# 7. Platform / Administration

| ID            | Acceptance Criteria                                           | Result | Notes / Bug |
| ------------- | ------------------------------------------------------------- | ------ | ----------- |
| UAT-ADMIN-001 | Admin can view users.                                         |        |             |
| UAT-ADMIN-002 | Admin can change a user's role.                               |        |             |
| UAT-ADMIN-003 | Admin cannot deactivate their own account.                    |        |             |
| UAT-ADMIN-004 | Admin can deactivate another user.                            |        |             |
| UAT-ADMIN-005 | Deactivated users lose access.                                |        |             |
| UAT-ADMIN-006 | Admin can assign/remove application access.                   |        |             |
| UAT-ADMIN-007 | ERP permissions can be granted/revoked.                       |        |             |
| UAT-ADMIN-008 | Non-admin users cannot access administrator functionality.    |        |             |
| UAT-ADMIN-009 | Azure user synchronization behaves correctly where available. |        |             |

**Sign-off**

Tester: ____________________
Date: ____________________
Result: Pass / Fail / Pass with Notes

---

# 8. ERP — Projects & Service Requests

| ID          | Acceptance Criteria                                                       | Result | Notes / Bug |
| ----------- | ------------------------------------------------------------------------- | ------ | ----------- |
| UAT-ERP-001 | User can create a project with required information.                      |        |             |
| UAT-ERP-002 | Created project appears correctly in the project list.                    |        |             |
| UAT-ERP-003 | User can edit an existing project.                                        |        |             |
| UAT-ERP-004 | Project changes persist after refresh.                                    |        |             |
| UAT-ERP-005 | Project attachment can be uploaded and retrieved.                         |        |             |
| UAT-ERP-006 | Restricted attachment access is correctly enforced.                       |        |             |
| UAT-ERP-007 | User can create a Service Request against a project.                      |        |             |
| UAT-ERP-008 | Materials can be added to a Service Request.                              |        |             |
| UAT-ERP-009 | Users without required ERP permissions cannot perform restricted actions. |        |             |
| UAT-ERP-010 | Purchase Requisition can be raised from Service Request materials.        |        |             |
| UAT-ERP-011 | ERP-to-Purchase handoff creates the expected Purchase record.             |        |             |

**Sign-off**

Tester: ____________________
Date: ____________________
Result: Pass / Fail / Pass with Notes

---

# 9. CRM

| ID          | Acceptance Criteria                                                           | Result | Notes / Bug |
| ----------- | ----------------------------------------------------------------------------- | ------ | ----------- |
| UAT-CRM-001 | User can create an Organization.                                              |        |             |
| UAT-CRM-002 | User can create an Inquiry.                                                   |        |             |
| UAT-CRM-003 | User can create a Tender.                                                     |        |             |
| UAT-CRM-004 | Organization, Inquiry, and Tender relationships work correctly.               |        |             |
| UAT-CRM-005 | Duplicate records are prevented or appropriately flagged.                     |        |             |
| UAT-CRM-006 | Stage changes are recorded in history.                                        |        |             |
| UAT-CRM-007 | Organization deletion behaves according to the defined cascade/restore rules. |        |             |
| UAT-CRM-008 | Deleted records can be restored where supported.                              |        |             |
| UAT-CRM-009 | SharePoint-backed documents can be uploaded and retrieved.                    |        |             |
| UAT-CRM-010 | Documents can be deleted where permitted.                                     |        |             |
| UAT-CRM-011 | Activities can be created.                                                    |        |             |
| UAT-CRM-012 | Activity attachments/photos behave correctly.                                 |        |             |
| UAT-CRM-013 | Activity information appears correctly on related records.                    |        |             |
| UAT-CRM-014 | Follow-up notifications are generated correctly.                              |        |             |
| UAT-CRM-015 | Users without CRM access cannot access CRM data.                              |        |             |

**Sign-off**

Tester: ____________________
Date: ____________________
Result: Pass / Fail / Pass with Notes

---

# 10. R&D

| ID          | Acceptance Criteria                                              | Result | Notes / Bug |
| ----------- | ---------------------------------------------------------------- | ------ | ----------- |
| UAT-RND-001 | User can execute an applicable R&D calculation/tool.             |        |             |
| UAT-RND-002 | Calculation result is correct.                                   |        |             |
| UAT-RND-003 | Calculation history is saved correctly.                          |        |             |
| UAT-RND-004 | Calculation snapshot is recorded.                                |        |             |
| UAT-RND-005 | Special characters in inputs do not break generated reports.     |        |             |
| UAT-RND-006 | Users without R&D access cannot access restricted functionality. |        |             |

**Sign-off**

Tester: ____________________
Date: ____________________
Result: Pass / Fail / Pass with Notes

---

# 11. Purchase — ERP-Embedded Workflow

| ID          | Acceptance Criteria                                                    | Result | Notes / Bug |
| ----------- | ---------------------------------------------------------------------- | ------ | ----------- |
| UAT-PUR-001 | Purchase Requisition can be raised from ERP Service Request materials. |        |             |
| UAT-PUR-002 | Purchase Requisition can be approved.                                  |        |             |
| UAT-PUR-003 | Approval updates the correct status.                                   |        |             |
| UAT-PUR-004 | Relevant users receive required notifications.                         |        |             |
| UAT-PUR-005 | Purchase Requisition can be rejected.                                  |        |             |
| UAT-PUR-006 | Rejection reason is recorded and visible.                              |        |             |
| UAT-PUR-007 | Purchase Requisition can be cancelled.                                 |        |             |
| UAT-PUR-008 | Partial receiving calculates remaining quantity correctly.             |        |             |
| UAT-PUR-009 | Full receiving completes correctly.                                    |        |             |
| UAT-PUR-010 | Line-item remarks can be recorded.                                     |        |             |
| UAT-PUR-011 | Item photos are displayed according to the defined workflow.           |        |             |
| UAT-PUR-012 | Fully received Purchase Requisition can be closed.                     |        |             |

**Sign-off**

Tester: ____________________
Date: ____________________
Result: Pass / Fail / Pass with Notes

---

# 12. P2P — Standalone Purchase Requisition

The standalone P2P workflow should receive dedicated UAT coverage because automated coverage is currently limited.

| ID          | Acceptance Criteria                                    | Result | Notes / Bug |
| ----------- | ------------------------------------------------------ | ------ | ----------- |
| UAT-P2P-001 | User can create a standalone Purchase Requisition.     |        |             |
| UAT-P2P-002 | Required fields are validated.                         |        |             |
| UAT-P2P-003 | Priority and required-by date are recorded correctly.  |        |             |
| UAT-P2P-004 | Reason/details are preserved through the workflow.     |        |             |
| UAT-P2P-005 | Documents can be attached and retrieved.               |        |             |
| UAT-P2P-006 | Request enters the defined approval chain.             |        |             |
| UAT-P2P-007 | Correct approver receives the request.                 |        |             |
| UAT-P2P-008 | Approval updates status correctly.                     |        |             |
| UAT-P2P-009 | Rejection updates status and records the reason.       |        |             |
| UAT-P2P-010 | Requester can see the appropriate status and result.   |        |             |
| UAT-P2P-011 | Unauthorized users cannot create restricted requests.  |        |             |
| UAT-P2P-012 | Unauthorized users cannot approve restricted requests. |        |             |

**Sign-off**

Tester: ____________________
Date: ____________________
Result: Pass / Fail / Pass with Notes

---

# 13. Cross-Department Access

Because ERP-PremnathRail supports authorized cross-department access, UAT should verify both sides of the permission model.

| Scenario                                            | Expected Result                           | Result |
| --------------------------------------------------- | ----------------------------------------- | ------ |
| User accesses own department data                   | Allowed according to assigned permissions |        |
| User accesses another department without permission | Denied                                    |        |
| User accesses another department with authorization | Allowed                                   |        |
| User attempts restricted modification               | Denied unless permission exists           |        |
| Administrator grants access                         | New access becomes effective              |        |
| Administrator revokes access                        | Access is removed                         |        |

---

# 14. Document & File Acceptance

Where document storage is involved, UAT should verify:

* Upload
* Download/retrieval
* Correct association with business records
* Permission enforcement
* Delete behavior
* File visibility
* Cross-module access where authorized
* SharePoint integration where applicable

---

# 15. Defect Handling During UAT

A failed UAT scenario should not simply be marked "Fail" and forgotten.

```text
UAT Failure
     ↓
Bug Record
     ↓
Developer Fix
     ↓
Retest
     ↓
Pass
     ↓
UAT Sign-Off
```

Each UAT failure should reference the corresponding bug/issue.

---

# 16. UAT Result Definitions

| Result          | Meaning                                                     |
| --------------- | ----------------------------------------------------------- |
| Pass            | Requirement works as expected                               |
| Fail            | Requirement does not work as expected                       |
| Pass with Notes | Works with a documented non-blocking exception              |
| Blocked         | Testing cannot continue because a dependency is unavailable |
| Not Applicable  | Scenario does not apply to the release                      |

---

# 17. UAT Sign-Off Summary

| Area                    | Tester | Date | Result | Notes / Linked Bugs |
| ----------------------- | ------ | ---- | ------ | ------------------- |
| Cross-module baseline   |        |      |        |                     |
| Platform / Admin        |        |      |        |                     |
| ERP                     |        |      |        |                     |
| CRM                     |        |      |        |                     |
| R&D                     |        |      |        |                     |
| Purchase                |        |      |        |                     |
| P2P                     |        |      |        |                     |
| Cross-department access |        |      |        |                     |
| Documents / Files       |        |      |        |                     |

---

# 18. Overall Release Acceptance

**Release / Version:** ____________________

**UAT Environment:** ____________________

**UAT Start Date:** ____________________

**UAT Completion Date:** ____________________

**Overall Result:** Pass / Fail / Pass with Notes

**Outstanding Accepted Exceptions:**

---

---

**Linked Bugs:**

---

---

---

# 19. Final Approval

| Name             | Role                                     | Decision               | Signature | Date |
| ---------------- | ---------------------------------------- | ---------------------- | --------- | ---- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | Accept / Reject        |           |      |
| Business Tester  | Business Acceptance                      | Accept / Reject        |           |      |
| Vineet Sharma    | Project Lead / Product & Technical Owner | Technical Verification |           |      |

---

# 20. UAT Record Retention

Each completed UAT cycle should be retained as a historical record.

A new UAT record should be created for a new release or materially different testing cycle rather than overwriting a previous signed-off record.

Recommended identification:

```text
UAT_<module>_<version>_<YYYYMMDD>
```

Example:

```text
UAT_ERP_v1.0_20260831
```

---

# 21. Related Documents

* Test Plan
* Test Cases
* Test Reports
* Bug Tracking
* Product Requirements Document
* Business Requirements Document
* Scope Document
* Release Management
* Deployment Documentation
