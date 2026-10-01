# CallingAgent — Call Center Platform

A full-featured call center management platform with Twilio phone number provisioning, AI voice answering, voicemail, call forwarding, CRM (contacts + companies), call logs with recordings, and a live dashboard.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm --filter @workspace/call-center run dev` — run the React frontend (port 21722, proxied at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — apply integration patches, typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- Phone Rec bridge env: `PHONE_REC_INTEGRATION_KEY` — shared secret entered in Phone Rec under More → AI Receptionist
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

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for dashboard API contracts)
- `lib/db/src/schema/` — Drizzle schema files (phone-numbers, companies, contacts, call-logs, ai-voice-config, phone-rec-rules)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/call-center/src/pages/` — React pages (dashboard, numbers, number-detail, calls, contacts, companies, settings)
- `artifacts/call-center/src/components/` — Shared layout and UI components
- `artifacts/api-server/src/routes/phone-rec-bridge.ts` — authenticated Phone Rec rule-sync bridge
- `scripts/apply-phone-rec-bridge.mjs` — applies Phone Rec caller-rule behavior to the Twilio voice route before builds/deploy sync

## Phone Rec Integration

Phone Rec is the per-contact control surface; CallingAgent is the live telephony/AI engine.

1. Set `PHONE_REC_INTEGRATION_KEY` in the CallingAgent deployment environment.
2. In Phone Rec → More → AI Receptionist, enter the published CallingAgent server URL, the same integration key, and the CallingAgent/Twilio number that will receive forwarded calls.
3. Use the Phone Rec Test & Sync button. Caller rules are stored in `phone_rec_rules` and matched by CallingAgent line + caller number; an `__unknown_callers__` rule acts as fallback.
4. Configure the mobile carrier's conditional/no-answer call forwarding to the CallingAgent/Twilio line. The carrier controls the actual forwarding delay; Phone Rec cannot directly inject AI audio into an unanswered cellular carrier call.
5. Once Twilio receives the forwarded call, CallingAgent applies the Phone Rec rule: `message` routes to voicemail; `script` and `conversation` route to CallingAgent AI voice. Business knowledge, approved offers and booking permissions come from the synchronized Phone Rec payload.

## Architecture decisions

- Contract-first: OpenAPI spec → Orval codegen → typed React Query hooks + Zod schemas
- Twilio webhooks at `/api/twilio/voice` (call handling) and `/api/twilio/status` (status callbacks) — configured automatically when provisioning numbers
- AI voice uses per-number `aiSystemPrompt` override; falls back to global config in `ai_voice_config` table
- Phone Rec exact-caller rules override the line's normal answer mode for forwarded calls; unknown-caller fallback is supported
- Phone number `answerMode` controls routing when Phone Rec does not override it: `forward` → dial forwardTo, `ai_voice` → AI greeting + conversation, `voicemail` → record, `reject` → hang up
- Dark cockpit aesthetic forced via CSS custom properties; no light mode toggle (ops tool, always dark)

## Product

- Dashboard: live stats (calls today, active numbers, AI answered, voicemails, avg duration) + recent activity feed
- Phone Numbers: provision US/Canada numbers by area code, toll-free search; configure per-number routing
- Number Detail: full config — caller ID, company, forward-to, ring count (1-10), answer mode, AI prompt, voicemail greeting
- Call Logs: searchable/filterable history with inline audio recording player
- Contacts CRM: searchable contacts with company associations and tags
- Companies CRM: company directory with industry, phone, email, website
- AI Settings: global voice (6 OpenAI TTS options), greeting, system prompt, max call duration
- Phone Rec bridge: caller-specific scripts, message-taking, business answers, approved offers, lead intake and appointment permissions

## User preferences

- No emojis in the UI
- Dark cockpit aesthetic (always dark, no toggle)
- Dense, information-rich layouts — not consumer/marketing style

## Gotchas

- Twilio webhook URLs auto-configured using `REPLIT_DEV_DOMAIN` or `REPLIT_DOMAINS` env; production deploy must use the published domain
- `PHONE_REC_INTEGRATION_KEY` must be configured before Phone Rec can sync rules
- Mobile no-answer forwarding is carrier-controlled and must point to the CallingAgent/Twilio line for AI takeover of the user's existing cellular number
- `@apply dark` is NOT valid in Tailwind v4 — use `.dark {}` class in CSS or add the class to the HTML element
- DB push required after any schema changes: `pnpm --filter @workspace/db run push`
- After adding new routes, rebuild: `pnpm --filter @workspace/api-server run build` then restart workflow

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- OpenAPI spec controls generated dashboard types — edit spec first, then run codegen for dashboard-facing APIs
