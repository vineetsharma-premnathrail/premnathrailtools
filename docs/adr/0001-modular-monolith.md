# ADR 0001: Modular Monolith Architecture

**Status:** Accepted

**Date:** 2025-07-24

## Context

We need to build a complex application (CRM + ERP + RnD) that may grow into multiple services later. We need to balance:
- Ease of development (single deployment)
- Ability to split into microservices (future flexibility)
- Clear team boundaries (different teams work on CRM, ERP, RnD)

## Decision

Adopt a **modular monolith** architecture:
- Single FastAPI application
- Well-defined modules — as actually built: `main` (users/auth/notifications),
  `erp`, `crm`, `rnd`, `purchase` (PRs raised from ERP Service Requests), and
  `p2p` (a newer, independent, any-department P2P request module — see
  [ADR 0003](./0003-independent-p2p-module.md))
- Each module has: models, schemas, routes (in practice, routes query the DB
  directly — see the "Module Structure" note in
  [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) for why the originally-planned
  separate repositories/services layers were dropped)
- Clear layer separation: routes → services → repositories

## Rationale

### Why not microservices?
- ❌ Too complex for a new project
- ❌ Requires distributed tracing, messaging, service discovery
- ❌ Debugging is harder
- ❌ Operational overhead

### Why not layered monolith?
- ❌ Hard to identify which code is which feature
- ❌ Package by layer (api/, models/, services/) doesn't scale
- ❌ Difficult to split later

### Why modular monolith?
- ✅ Single deployment
- ✅ Clear feature boundaries
- ✅ Easy to split to microservices later
- ✅ Teams can own entire modules
- ✅ Good for teams <20 people

## Consequences

### Advantages
- Fast local development
- Easy testing (single database)
- Clear code organization
- Can become microservices if needed

### Disadvantages
- Single points of failure (one service down = everything down)
- Difficult to scale one module independently
- All services share database (initially)

## When to Revisit

If any of these happen:
1. **10+ engineers** — Consider splitting services
2. **CRM module at 10K+ lines** — Consider extraction
3. **RnD calculations slow down APIs** — Extract to async service

## References

- [Building Microservices: Designing Fine-Grained Systems](https://samnewman.ie/building-microservices/) by Sam Newman
- [Modular Monolith Pattern](https://www.milanjovanovic.net/blog/modular-monolith-pattern-a-way-to-organize-your-project) by Milan Jovanovic
