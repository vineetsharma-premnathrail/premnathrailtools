# Documentation — Premnathrail Portal

| #  | Folder                                                 | Kya jaata hai                                                                                                |
| -- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 00 | [00-overview/](00-overview/)                           | Project Charter — sponsor, lead, objectives, scope                                                           |
| 01 | [01-architecture/](01-architecture/)                   | System architecture, HLD/LLD, `diagrams/`                                                                    |
| 02 | [02-modules/](02-modules/)                             | Har business module ka apna folder (overview/requirements/workflows/user-stories/permissions/ui/api/testing) |
| 03 | [03-database/](03-database/)                           | Schema, ER diagram, relationships, migrations                                                                |
| 04 | [04-security/](04-security/)                           | Permission matrix, threat model, auth architecture                                                           |
| 05 | [05-integration/](05-integration/)                     | Microsoft Graph/SharePoint/Teams — external system flows                                                     |
| 06 | [06-setup-and-development/](06-setup-and-development/) | Dev setup, coding standards, project structure, env vars                                                     |
| 07 | [07-deployment/](07-deployment/)                       | Deploy, Docker, CI/CD, server config, backup                                                                 |
| 08 | [08-testing/](08-testing/)                             | Test plan, bug tracking, UAT                                                                                 |
| 09 | [09-operations/](09-operations/)                       | Runbook, monitoring, disaster recovery, changelog                                                            |
| 10 | [10-user-and-admin/](10-user-and-admin/)               | User manual, admin manual, FAQ                                                                               |
| 11 | [11-decisions/](11-decisions/)                         | ADRs — never overwritten, new ADR supersedes old                                                             |
| 12 | [12-project-management/](12-project-management/)       | Project plan, tracker, risk register, change requests                                                        |
| —  | [releases/](releases/)                                 | Per-version release notes (own file per version, not chronological log)                                      |

## Purana Content

Poora purana documentation `../old_docs/` mein hai (git history preserve hai).

Migrate karte waqt:

**Sirf abhi accurate content copy karo.**

Is session mein pata chala ki bahut sa content stale tha — for example, five existing modules (`design`, `electrical`, `hr`, `store`, `vendor`) missing the, aur `SETUP.md` jaisi files fictional "future stage" text rakhti thi jabki functionality already ban chuki thi.

Process:

1. Codebase se content verify karo.
2. Accurate content ko new documentation structure mein migrate karo.
3. Migration complete hone ke baad corresponding stale file ko `old_docs/` se hata do.

## Core Principles

* **Project-level documents → `docs/` top-level folders.**
  Module-specific documents → `02-modules/<module>/`.

* **Historical versions → Git.**
  Alag se old-copy files mat rakho — `git log` / `git blame` hi version history hai.

* **ADRs → kabhi overwrite nahi.**
  Naya decision = naya ADR jo purane decision ko supersede kare.

* **Living docs** (`02-modules`, `04-security/permission-matrix`, `01-architecture`) — related code change hone par same PR mein update karo.

* **Stable docs** (`00-overview`, `11-decisions`) — sirf actual decision ya project scope change hone par update karo.

* **Format:** Markdown hamesha.

* Har folder ke apne `README.md` mein:

  * folder ka purpose
  * kya content rakha jaata hai
  * kab documentation update karni hai

---

*Structure recreated: 2026-08-29.*
