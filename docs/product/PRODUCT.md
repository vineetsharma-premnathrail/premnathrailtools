# Product Overview

## Premnathrail Portal

Unified platform for managing three critical business domains:
- **CRM** — Customer relationships, notes, opportunities
- **ERP** — Enterprise resource planning, projects, procurement
- **R&D** — Research & development, calculations, reports

## Vision

"A single, integrated platform where Premnathrail employees can manage all aspects of our rail business — from customer relations to engineering calculations."

## Core Features

### CRM Module
- Customer contact management
- Sales pipeline tracking
- Note taking and collaboration
- Activity history

### ERP Module
- Project management
- Purchase order tracking
- Vendor management
- Budget tracking

### R&D Module
- Calculation tools (braking, hydraulic, load distribution, etc.)
- Report generation (PDF)
- Data sharing between calculations
- Historical tracking

## User Personas

### Sales Manager
- Creates and tracks customer opportunities
- Manages sales pipeline
- Exports reports for leadership

### Project Manager
- Tracks projects and tasks
- Manages budgets
- Collaborates with team
- Generates project reports

### Engineer
- Runs R&D calculations
- Generates technical reports
- Shares results with team
- Archives historical data

### Admin
- Manages users and access
- Monitors system health
- Manages settings
- Handles integrations

## Key Metrics

We measure success with:
- **Adoption**: % of employees using portal
- **Engagement**: Daily/weekly active users
- **Satisfaction**: User feedback/NPS score
- **Performance**: Page load time, API latency

## Roadmap

### Phase 1 (Current — Q3 2025)
- [ ] Basic auth (Microsoft SSO)
- [ ] CRM module (CRUD operations)
- [ ] Simple frontend (HTML/JS)
- [ ] Database setup (PostgreSQL)

### Phase 2 (Q4 2025)
- [ ] ERP module
- [ ] Reporting/exports
- [ ] User roles & permissions
- [ ] Audit logging

### Phase 3 (Q1 2026)
- [ ] R&D calculation tools
- [ ] PDF report generation
- [ ] Advanced search/filtering
- [ ] Mobile app

### Phase 4 (Q2 2026+)
- [ ] Analytics dashboard
- [ ] Integration with external systems
- [ ] Automation/workflows
- [ ] AI features

## Business Value

### For Sales
- Faster customer response (centralized notes)
- Better pipeline visibility
- Reduced deal loss

### For Operations
- Centralized project management
- Budget control
- Team coordination

### For Engineering
- Faster calculations
- Report generation
- Knowledge sharing

## Success Criteria

We'll know we succeeded when:
1. **80% adoption** — 8 out of 10 employees regularly use portal
2. **Productivity gain** — 1 hour/week saved per user on average
3. **Satisfaction > 4/5** — User satisfaction score
4. **Uptime > 99.5%** — System reliably available
5. **Performance < 2s** — Page load times acceptable

## Constraints

- **Budget** — Limited IT budget
- **Timeline** — Needed by end of Q3 2025
- **Users** — ~100 concurrent users
- **Data** — ~10GB per year
- **Compliance** — GDPR, enterprise standards

## Assumptions

- Microsoft 365 licensing continues
- Business processes remain stable
- Team can dedicate 2-3 engineers
- Users want to adopt new system

## Risks

- **User adoption** — If users don't adopt, limited value
- **Scope creep** — Building too many features
- **Performance** — System too slow for users
- **Data migration** — Legacy data hard to migrate

## Non-Goals

We will NOT build:
- ❌ Accounting/finance module (exists in SAP)
- ❌ HR module (exists in ADP)
- ❌ Email client (use Outlook)
- ❌ Document management (use SharePoint)

## Terms & Definitions

- **Portal** — Web application at api.premnathrail.com
- **Module** — CRM, ERP, or R&D (distinct business domain)
- **Feature** — Specific capability (create note, export report)
- **User** — Company employee with portal access
- **Admin** — User with elevated permissions

## Contact

- **Product Manager** — [name]
- **Technical Lead** — [name]
- **Stakeholder** — [name]

## Next Steps

1. Get user feedback on roadmap
2. Prioritize Phase 2 features
3. Plan UI/UX design
4. Prepare training materials
