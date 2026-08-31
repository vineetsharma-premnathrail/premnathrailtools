# ADR 0001: Modular Monolith Architecture

**Status:** Accepted
**Date:** 2025-07-24

## Context

We need to build a complex application covering CRM, ERP, and R&D that may grow into multiple services later.

The architecture must balance:

* Ease of development through a single deployment
* Ability to split into microservices in the future
* Clear boundaries between CRM, ERP, and R&D teams

## Decision

Adopt a **Modular Monolith** architecture.

The application uses:

* A single FastAPI application
* Clearly defined modules:

  * `main` — users, authentication, notifications
  * `erp`
  * `crm`
  * `rnd`
  * `purchase` — purchase requisitions raised from ERP Service Requests
  * `p2p` — independent, department-wide P2P request workflow
* Module-specific models, schemas, and routes
* A shared database initially

The intended architectural layering is:

```text
Routes → Services → Repositories
```

However, the current implementation does not consistently follow this separation. Some routes access the database directly. This implementation reality is documented in the architecture documentation.

## Rationale

### Why Not Microservices?

* Too complex for the current project stage
* Requires distributed tracing, messaging, and service discovery
* Makes debugging more difficult
* Introduces additional operational overhead

### Why Not a Traditional Layered Monolith?

* Feature boundaries become harder to identify
* Organizing primarily by technical layer does not scale well
* Individual business capabilities become harder to extract later

### Why Modular Monolith?

* Single deployment
* Clear feature boundaries
* Easier development and testing
* Teams can own complete modules
* Provides a practical path toward future service extraction
* Suitable for the current team and project scale

## Consequences

### Advantages

* Fast local development
* Simple deployment
* Easy testing with a shared database
* Clear code organization
* Future option to extract individual modules

### Disadvantages

* A failure of the shared application can affect multiple modules
* Individual modules cannot be scaled independently
* Modules initially share the same database
* Poor module boundaries could create coupling over time

## When to Revisit

Reconsider this architecture when significant pressure appears:

1. **10+ engineers** — evaluate whether modules should become independently deployable services.
2. **CRM reaches 10K+ lines** — evaluate CRM extraction.
3. **R&D calculations materially slow API requests** — evaluate extraction into an asynchronous service.

These are review triggers, not automatic requirements to adopt microservices.

## References

* *Building Microservices: Designing Fine-Grained Systems* — Sam Newman
* *Modular Monolith Pattern* — Milan Jovanovic
