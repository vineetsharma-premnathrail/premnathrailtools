# Architecture Decision Records (ADR)

An Architecture Decision Record (ADR) is a document that captures an important architectural decision.

## Format

Each ADR has:
- **Title** — What decision?
- **Status** — Proposed, Accepted, Deprecated, Superseded
- **Context** — Why this decision?
- **Decision** — What was decided?
- **Consequences** — What are the trade-offs?

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-modular-monolith.md) | Modular Monolith Architecture | Accepted |
| [0002](0002-microsoft-sso.md) | Microsoft SSO for Authentication | Accepted |
| [0003](0003-sqlalchemy-orm.md) | SQLAlchemy ORM for Database | Accepted |
| [0004](0004-fastapi-framework.md) | FastAPI as Web Framework | Accepted |

## How to Add

1. Copy `template.md`
2. Rename to `000X-description.md`
3. Fill in sections
4. Update this README
5. Submit for review
