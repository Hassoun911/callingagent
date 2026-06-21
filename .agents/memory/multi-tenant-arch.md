---
name: Multi-tenant Architecture
description: Main admin vs Company CRM access rules and architecture decisions
---

## Rule

**Main Admin CRM** (`super_admin` role, env-var login or platform_users with role=super_admin):
- Sees ALL companies, ALL phone numbers, ALL campaigns, ALL contacts, ALL call logs
- Can run ANY operation — provisioning, configuring, creating users for any company
- Phone number add/remove (Twilio provisioning) only done here

**Company CRM** (`company_admin` or `company_user` role, platform_users table):
- SAME feature set as main admin, but SCOPED to their company only
- Sees ONLY their company's phone numbers, campaigns, contacts, call logs
- Can configure their own numbers, run campaigns, manage contacts — fully operational
- Cannot see or touch other companies' data
- Cannot provision (add/remove) new phone numbers — that's super_admin only
- Changes made in main admin (e.g. phone number assignment) reflect instantly in company CRM

## Implementation

- `platform_users` table: id, username, password_hash, role, companyId, isActive
- Login checks `platform_users` first, then env-var super admin fallback
- `super_admin` → `AdminRouter` (full main CRM)
- `company_admin` / `company_user` → `CompanyPortal` (/portal) scoped to their companyId
- Company portal at `/portal` — same pages but filtered by companyId
- Super admin creates company users via company-detail page → Portal Users panel

**Why:**
User confirmed: company portal should be "fully functional, just scoped to that company's data" — not read-only.
