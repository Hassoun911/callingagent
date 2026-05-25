# Vanguard.OPS — Call Center Platform

A full-featured call center management platform with Twilio phone number provisioning, AI voice answering, voicemail, call forwarding, CRM (contacts + companies), call logs with recordings, and a live dashboard.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm --filter @workspace/call-center run dev` — run the React frontend (port 21722, proxied at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- Optional env: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` (for AI voice)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + Tailwind CSS v4 + shadcn/ui
- Phone: Twilio SDK
- AI: OpenAI via Replit AI Integrations proxy

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all API contracts)
- `lib/db/src/schema/` — Drizzle schema files (phone-numbers, companies, contacts, call-logs, ai-voice-config)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/call-center/src/pages/` — React pages (dashboard, numbers, number-detail, calls, contacts, companies, settings)
- `artifacts/call-center/src/components/` — Shared layout and UI components

## Architecture decisions

- Contract-first: OpenAPI spec → Orval codegen → typed React Query hooks + Zod schemas
- Twilio webhooks at `/api/twilio/voice` (call handling) and `/api/twilio/status` (status callbacks) — configured automatically when provisioning numbers
- AI voice uses per-number `aiSystemPrompt` override; falls back to global config in `ai_voice_config` table
- Phone number `answerMode` controls routing: `forward` → dial forwardTo, `ai_voice` → AI greeting + record, `voicemail` → record, `reject` → hang up
- Dark cockpit aesthetic forced via CSS custom properties; no light mode toggle (ops tool, always dark)

## Product

- Dashboard: live stats (calls today, active numbers, AI answered, voicemails, avg duration) + recent activity feed
- Phone Numbers: provision US/Canada numbers by area code, toll-free search; configure per-number routing
- Number Detail: full config — caller ID, company, forward-to, ring count (1-10), answer mode, AI prompt, voicemail greeting
- Call Logs: searchable/filterable history with inline audio recording player
- Contacts CRM: searchable contacts with company associations and tags
- Companies CRM: company directory with industry, phone, email, website
- AI Settings: global voice (6 OpenAI TTS options), greeting, system prompt, max call duration

## User preferences

- No emojis in the UI
- Dark cockpit aesthetic (always dark, no toggle)
- Dense, information-rich layouts — not consumer/marketing style

## Gotchas

- Twilio webhook URLs auto-configured using `REPLIT_DEV_DOMAIN` or `REPLIT_DOMAINS` env; production deploy must use the published domain
- `@apply dark` is NOT valid in Tailwind v4 — use `.dark {}` class in CSS or add the class to the HTML element
- DB push required after any schema changes: `pnpm --filter @workspace/db run push`
- After adding new routes, rebuild: `pnpm --filter @workspace/api-server run build` then restart workflow

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- OpenAPI spec controls all generated types — edit spec first, then run codegen
