# Project Context — Utopia SaaS

**Project**: utopia  
**Version**: 0.1.0  
**Status**: in production use; 65+ migrations applied. Current rules live in `AGENTS.md`; this file is historical context.  
**Stack**: Next.js 16 + React 19 + TypeScript 5 + Tailwind CSS 4 + Supabase (wired)

## Executive Summary

Utopía is a multi-tenant SaaS management system for clothing store operations. It's being built as the core of a resellable product that customers can deploy and customize. Phase 1 focuses on establishing the foundational architecture with strict RLS, feature flagging, role-based access control, atomic transactions, and comprehensive UI patterns.

## Core Architecture Principles

### Multi-Tenancy (Hard Requirement)

- **Identity Column**: Every domain table carries `idTenant` (foreign key to tenants table)
- **Row Level Security**: PostgreSQL RLS policies enforce tenant isolation at DB level
- **Zero Trust Verification**: Every API handler and database query must:
  1. Verify the requesting user belongs to the target tenant
  2. Verify the user has the required module + role for the action
  3. Pass the tenant ID explicitly to database operations
- **Feature Flags**: Modules enabled/disabled per tenant configuration
- **Pattern**: Guard clauses before any data access

### Data Integrity & Concurrency

- **Atomic Transactions**: Critical operations (sales, inventory moves) must be ACID-compliant across multiple tables
- **Optimistic Locking**: Physical concurrency handled at DB level using version/timestamp columns (NOT application-level retry logic)
- **Constraint Enforcement**: Database layer is source of truth for invariants
- **Testing**: Concurrency tests required to validate conflict detection and resolution

### User Interface Standards

- **Dark/Light Theming**: Full support, persisted to user preferences
- **Unified Filter Pattern**: Every list implements the same filter UX
- **Export Capability**: Every list supports export to Excel, CSV, and PDF
- **Responsive Design**: Mobile-first approach with Tailwind CSS 4

## Data Model

**Source of Truth**: `utopia-intructivo/DiagramaDeClases.drawio`

Current understanding (to be refined in Explore phase):
- **Tenants**: Tenant configuration and subscription
- **Users**: User accounts with role assignments per tenant
- **Modules**: Feature modules (Inventory, Sales, Finance, etc.)
- **Roles**: Access control roles with permission matrices
- **Inventory**: SKUs, stock levels, physical movements
- **Sales**: Orders, line items, customer data
- **Finance**: Transactions, accounts, reporting
- **Audit Log**: All mutations tracked with user/tenant/timestamp

## Visual Identity & UX

**Source of Truth**: `utopia-intructivo/Utopía Sistema Oficial .html`

Constraints:
- Follow the official design system exactly
- Use provided color palettes, typography, spacing
- Component library must match the visual language

## Critical Project Constraints

### Next.js 16 Compatibility ⚠️

**HARD CONVENTION**: This version has breaking changes from training data.

Before writing ANY code:
1. Read `node_modules/next/dist/docs/` for the relevant guide
2. Check deprecation notices in error messages
3. Do NOT assume patterns from Next.js 12–15 apply

Examples of known breakage areas:
- App Router file conventions
- API route response handling
- Middleware setup
- Image optimization
- Font loading



## Delivery Strategy

- **Versioning**: Semantic versioning (0.1.0 → major.minor.patch)
- **Git Workflow**: GitHub (implied; .git present)
- **PR Strategy**: Force-chained (stacked/chained PRs) with 400-line review budget per PR
- **Commit Style**: Conventional commits (type: scope: message)
- **Testing**: Strict TDD active (`strict_tdd: true` in `config.yaml`; Vitest installed and gated)

## Directory Structure (Current)

```
utopia/
├── app/                          # Next.js App Router
├── components/                   # UI components
├── e2e/                          # Playwright specs
├── lib/                          # Domain logic
│   └── dal/                      # Data Access Layer
├── tests/                        # Vitest DB and unit specs
├── public/                       # Static assets
├── supabase/
│   └── migrations/               # SQL migrations (65 applied)
├── utopia-intructivo/           # Source of truth docs
├── openspec/                     # SDD artifacts
├── package.json
└── README.md
```

## Next Steps (Recommended SDD Flow)

1. **SDD Explore**: 
   - Clarify Supabase auth model (session vs JWT vs OAuth)
   - Define RLS policy structure (by role? by tenant status?)
   - Document expected user stories for Phase 1 features
   - Spike test framework setup (Vitest + Supabase test mode)

2. **SDD Spec**:
   - Specify test framework requirements + RLS test patterns
   - Define authentication flow and session management
   - Outline database schema (simplified Phase 1 subset)

3. **SDD Tasks**:
   - Task 1: Install and configure test framework + RLS harness
   - Task 2: Set up Supabase project + migrations + RLS policies
   - Task 3: Implement auth middleware + session guard
   - Task 4: Build core tables + initial RLS policies

4. **SDD Apply**:
   - Implement in chained PRs (400 lines each)
   - Every PR must include tests for its RLS/transaction scope
   - Verify strict TDD compliance

## References

- **Data Model**: utopia-intructivo/DiagramaDeClases.drawio
- **Design System**: utopia-intructivo/Utopía Sistema Oficial .html
- **Execution Plan**: utopia-intructivo/Ejecucion Utopia (reorganizado).docx.txt
- **Next.js 16 Breaking Changes**: node_modules/next/dist/docs/
- **SDD Config**: openspec/config.yaml
- **Testing Status**: openspec/testing-capabilities.md
