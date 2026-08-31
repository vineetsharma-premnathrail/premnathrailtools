# ERP-PremnathRail — Test Plan

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Testing
**Document:** Test Plan
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the testing approach for ERP-PremnathRail, including test levels, test organization, execution, coverage, regression testing, security testing, and acceptance testing.

The plan reflects the current implementation while establishing a consistent structure for future testing.

---

# 2. Testing Objectives

Testing shall verify that:

* Business requirements work as intended.
* Application workflows function correctly.
* User permissions are enforced.
* Data is correctly created, updated, and retrieved.
* Integrations behave correctly.
* Security controls operate as expected.
* Existing functionality does not regress after changes.
* Critical business workflows are validated before release.

---

# 3. Test Levels

ERP-PremnathRail uses the following testing levels:

| Level       | Purpose                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| Unit        | Validate isolated functions, methods, and logic                           |
| Integration | Validate API, database, authentication, and module interactions           |
| Workflow    | Validate complete multi-step business processes                           |
| Security    | Validate authentication, authorization, middleware, and security controls |
| UAT         | Validate business requirements with business users                        |
| Manual UI   | Validate frontend behavior and usability                                  |

The current automated suite is primarily integration-oriented.

---

# 4. Current Testing Technology

The backend currently uses:

* **pytest**
* FastAPI `TestClient`
* In-memory SQLite test database

There is currently no automated frontend test framework such as Jest, Vitest, Playwright, or Cypress. Frontend correctness is therefore validated manually.

---

# 5. Test Structure

Current backend tests are located under:

```text
backend/app/tests/
```

The repository also contains:

```text
backend/app/tests/
├── e2e/
├── integration/
└── unit/
```

These directories are currently empty scaffolding rather than active test classifications.

Therefore, test classification should be based on the actual behavior being tested rather than the folder location.

---

# 6. Shared Test Fixtures

The primary shared fixtures are:

| Fixture             | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `db`                | Provides an isolated in-memory SQLite database session      |
| `client`            | Provides a FastAPI `TestClient` with application middleware |
| `_reset_rate_store` | Resets the shared security rate limiter between tests       |

The rate-store reset is important because the security middleware maintains a module-level rate limiter that can otherwise cause unrelated tests to receive false `429` responses.

---

# 7. Authentication Testing Pattern

Tests requiring authenticated users should create a test user and generate an access token.

The established pattern is:

```python
def make_user(db, email, role="user", assigned_apps=None):
    apps = ["crm"] if assigned_apps is None else assigned_apps

    user = User(
        email=email,
        name=email.split("@")[0],
        role=role,
        is_active=True,
        assigned_apps=apps
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user
```

Authentication headers are generated using the application's access-token mechanism.

An empty application list must remain an empty list; using `assigned_apps or ["crm"]` would incorrectly grant CRM access because an empty Python list is falsy.

---

# 8. Unit Testing

Unit tests should validate isolated business logic without unnecessary HTTP requests.

Current examples include:

* `test_user_model.py`
* `test_rnd_latex_escaping.py`

These represent the closest current examples of true unit-level testing.

New pure functions and model-level logic should receive unit tests where practical.

---

# 9. Integration Testing

Integration testing is the dominant automated testing approach.

A typical integration test exercises:

```text
HTTP Request
     ↓
FastAPI Route
     ↓
Authentication / Middleware
     ↓
Business Logic
     ↓
SQLAlchemy
     ↓
Test Database
     ↓
HTTP Response
```

This provides coverage of multiple application layers in one test.

---

# 10. Workflow Testing

Multi-step business workflows should be tested as complete sequences.

Example:

```text
Create
  ↓
Submit
  ↓
Approve
  ↓
Process
  ↓
Receive
  ↓
Complete
```

Current examples include purchase requisition lifecycle tests, Teams SSO flows, and security violation-to-ban sequences.

---

# 11. Security Testing

Security functionality requires dedicated testing.

Current security tests cover:

* Authentication pre-checks
* Injection protection
* SSRF protection
* Path traversal protection
* XSS protection
* Rate limiting
* IP banning
* Security headers
* API-key authentication
* API-key scoping
* Bulk-delete protections

These tests operate through actual HTTP requests so that externally observable behavior is validated.

---

# 12. Microsoft Authentication Testing

Microsoft OAuth tests mock Microsoft's OAuth endpoints.

Coverage includes:

* Login
* User creation
* User synchronization
* Domain restrictions
* JWT validation
* Inactive-user denial
* Session-cookie behavior

Teams SSO testing additionally validates:

* Token audience
* Token issuer
* Token replay protection
* On-behalf-of exchange
* Session creation

No real Microsoft account or live OAuth exchange is required for these automated tests.

---

# 13. Scheduled Job Testing

Scheduled jobs should separate their production entry point from testable business logic.

The current follow-up reminder implementation uses an underscore-prefixed logic function that accepts the test database session.

This prevents tests from accidentally interacting with the real production database.

Future scheduled jobs should follow the same pattern.

---

# 14. Test Coverage Snapshot

The preparation source records approximately **259 tests across 21 files** in the current test directory, compared with an earlier snapshot of 260 tests across 22 files.

Major coverage areas include:

| Area                  | Tests |
| --------------------- | ----: |
| P2P Requests          |    49 |
| ERP Projects          |    22 |
| Security Middleware   |    19 |
| Users                 |    17 |
| ERP Service Requests  |    17 |
| Purchase Requisitions |    16 |
| R&D                   |    15 |
| Microsoft OAuth       |    14 |
| CRM                   |    12 |
| Feedback              |    11 |
| Teams SSO             |    10 |
| R&D Tool Snapshots    |     9 |
| Follow-up Reminders   |     9 |

---

# 15. Test Execution

Run the complete backend test suite:

```bash
pytest app/tests -v
```

Run a specific test file:

```bash
pytest app/tests/test_auth.py -v
```

Run a specific test:

```bash
pytest app/tests/test_auth.py::test_health_endpoint -v
```

Run with coverage:

```bash
pip install pytest-cov
pytest app/tests --cov=app --cov-report=html
```

Watch for changes:

```bash
pip install pytest-watch
ptw app/tests
```

---

# 16. Regression Testing

Every significant defect fix should be followed by regression testing.

Where practical:

```text
Bug
 ↓
Fix
 ↓
Regression Test
 ↓
Full Relevant Test Suite
 ↓
Verification
```

The objective is to ensure that fixing one feature does not break related functionality.

---

# 17. Frontend Testing

Frontend testing is currently manual because no automated frontend test framework is configured.

Manual testing should cover:

* Navigation
* Forms
* Validation
* Responsive layouts
* Authentication
* Permissions
* API error states
* Loading states
* Empty states
* File uploads
* Mobile behavior
* Microsoft Teams embedding

Automated browser testing may be introduced when the frontend testing infrastructure is established.

---

# 18. Test Environment

Automated backend tests use an isolated in-memory SQLite database.

External services such as Microsoft OAuth and SharePoint are mocked where required.

Production data must never be used as the normal test database.

---

# 19. Test Data

Test data should be:

* Synthetic
* Reproducible
* Isolated
* Minimal
* Safe to delete

Tests should create the data required for their execution rather than depending on manually prepared production records.

---

# 20. Test Independence

Each test should be independently executable.

Tests must not depend on:

* Execution order
* Data created by another test
* A developer's local database
* Production data
* Previous authentication state
* Previous rate-limit state

Shared fixtures should provide predictable isolation.

---

# 21. Known Coverage Gaps

Current gaps include:

* Thin CRM activity coverage
* Thin LaTeX escaping coverage relative to its function surface
* Limited direct testing of some purchase notification and SharePoint helpers
* Empty module-level test directories
* Empty `unit`, `integration`, and `e2e` scaffolding
* No automated frontend testing
* No CI pipeline

---

# 22. CI/CD Status

There is currently no CI pipeline.

Tests are therefore not automatically executed on:

* Commit
* Pull request
* Merge

Running the test suite before merging remains a manual responsibility until CI/CD is introduced.

---

# 23. Test Case Management

Detailed test cases should remain separate from this strategic test plan.

The existing test-case inventory should contain individual:

* Test Case ID
* Module
* Preconditions
* Test Steps
* Expected Result
* Actual Result
* Status
* Related Requirement
* Related Bug

The test plan should describe the testing strategy rather than duplicate every individual test case.

---

# 24. Test Reports

Test execution results should be retained as dated test reports.

A test report should record:

* Execution date
* Application version
* Environment
* Tester
* Tests executed
* Passed
* Failed
* Blocked
* Defects discovered
* Final result

Historical reports should not be overwritten.

The existing project convention uses dated test-report files for this purpose.

---

# 25. Defect Integration

Testing defects should be connected to the Bug Tracking process.

```text
Test Case
    ↓
Failure
    ↓
Bug Record
    ↓
Fix
    ↓
Regression Test
    ↓
Verification
    ↓
Close
```

See **Bug Tracking** for the defect lifecycle.

---

# 26. Release Testing

Before a production release, applicable testing should confirm:

* Critical business workflows
* Authentication
* Authorization
* Database operations
* Important integrations
* Security controls
* Regression-sensitive functionality
* Deployment health
* Production configuration

Release approval should not rely solely on successful automated tests.

---

# 27. User Acceptance Testing

UAT is business-facing validation.

UAT confirms that the application satisfies the intended business workflow and requirements.

```text
Business Requirement
        ↓
UAT Scenario
        ↓
Business User
        ↓
Pass / Fail
        ↓
Acceptance
```

UAT defects should be linked to the Bug Tracking process.

---

# 28. Test Documentation Lifecycle

Testing documentation should be maintained as follows:

| Document    | Update Approach                                   |
| ----------- | ------------------------------------------------- |
| Test Plan   | Update when testing strategy changes              |
| Test Cases  | Continuously update as functionality changes      |
| Test Report | Create a new report for each significant test run |
| Bug Record  | Maintain until closure                            |
| UAT Record  | Maintain for each acceptance cycle                |

Historical test reports should remain available rather than being overwritten.

---

# 29. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 30. Related Documents

* Bug Tracking
* User Acceptance Testing
* Test Cases
* Test Reports
* CI/CD
* Release Management
* Deployment
* BRD
* PRD
* Scope Document

---

# 31. Document Information

**Document:** Test Plan
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Testing
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
