# New Project = machine form (2026-10-27)

## Requirement (owner, Hindi/English)
"Machine registry kuch nahi hai. Machine registry ka form jo tha, wo ab new project ya add new project ka form hoga. Usi se saari cheezein aage kaam karengi. Ek baar add new project kar diya, to saara form fill kara jaaye. Uske baad uske andar milestones create kar sakte hain and uska poora dekh sakte hain."

Core flow: Machine (installed base) is born with the order project; milestones run Design → Production → QC → Dispatch → Commissioning; Service later raises SRs on the same machine.

## Decisions (Manager)
- One form, one save: `POST /api/v1/projects/with-machine` creates the PM project and the machine (`erp_projects`) atomically; `erp_projects.pm_project_id` links them (migration `b6e2d8f4a1c7`, nullable, past machines NULL).
- Form = the old machine form (Machine Identity, Client & Site, Technical Specs, Timeline & Warranty, Documents) with a first tab "Project" (project number, name, SO number, start/closing date, project manager, scope). Client company and customer PO are entered once (machine fields) and copied to the PM project.
- Serial number may be blank: it becomes the project number (PEW-78). Engine/chassis/commissioning/warranty can be filled later.
- Authority: PM "create projects" authority (management) — the machine is part of the project, no separate machine-create grant needed. Machine approval setting still applies to the machine.
- Project workspace gets a "Machine" tab (details + edit link to the machine record).
- Old "Add New Project" on the machine register (`/dashboard/projects/service-projects/new`) redirects to `/dashboard/projects/new`. The machine register list stays (past projects, SRs, import).
- Building on top of the uncommitted 2026-10-26 work (owner said yes).
