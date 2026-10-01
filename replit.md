# CallingAgent — Call Center Platform

A full-featured call center management platform with Twilio phone number provisioning, AI voice answering, voicemail, call forwarding, CRM (contacts + companies), call logs with recordings, appointment booking, and a live dashboard.

## Production deployment

- Production is deployed from GitHub `main` to Render; Replit is not part of the active deployment path.
- Render service: `callingagent`
- Production URL: `https://callingagent-cokp.onrender.com`
- Render build: `pnpm install --frozen-lockfile && BASE_PATH=/ pnpm --filter @workspace/call-center run build && pnpm --filter @workspace/api-server run build`
- Render start: `node artifacts/api-server/dist/index.mjs`
- Required env: `DATABASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- Phone Rec bridge env: `PHONE_REC_INTEGRATION_KEY` — shared secret entered in Phone Rec under More → AI Receptionist
- Optional AI env: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`

## Local commands

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/call-center run dev` — run the React frontend
- `pnpm run typecheck` — full workspace typecheck
- `pnpm run build` — apply integration patches, typecheck + build packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI
- `pnpm --filter @workspace/db run push` — push DB schema changes when intentionally migrating schema

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval
- API build: esbuild
- Frontend: React + Vite + Tailwind CSS v4 + shadcn/ui
- Phone: Twilio
- AI: OpenAI-compatible integration used by the CallingAgent voice engine

## Where things live

- `lib/api-spec/openapi.yaml` — dashboard API contract source
- `lib/db/src/schema/` — Drizzle schema files
- `artifacts/api-server/src/routes/` — Express routes
- `artifacts/call-center/src/pages/` — React dashboard pages
- `artifacts/api-server/src/routes/phone-rec-bridge.ts` — authenticated Phone Rec rule-sync bridge
- `scripts/apply-phone-rec-bridge.mjs` — applies Phone Rec caller-rule behavior to the Twilio voice route during builds

## Phone Rec Integration

Phone Rec is the per-contact control surface; CallingAgent is the live Twilio/AI telephony engine.

1. Configure `PHONE_REC_INTEGRATION_KEY` in the Render `callingagent` service.
2. In Phone Rec → More → AI Receptionist, use `https://callingagent-cokp.onrender.com`, the same integration key, and the CallingAgent/Twilio line that should receive forwarded calls.
3. Use Phone Rec's Test & Sync action. Caller rules are stored by CallingAgent line + caller number; `__unknown_callers__` is the fallback rule.
4. Configure the mobile carrier's conditional/no-answer forwarding to that CallingAgent/Twilio line. The carrier controls the forwarding delay; the Android app cannot inject AI speech directly into an unanswered carrier call.
5. When Twilio receives the forwarded call, CallingAgent applies the synchronized Phone Rec rule: `message` → voicemail; `script`/`conversation` → AI voice. Business knowledge, approved offers, lead intake, and booking permission come from the Phone Rec payload.

## Architecture decisions

- Twilio webhooks at `/api/twilio/voice` and `/api/twilio/status`
- AI voice uses per-number prompt/config with Phone Rec caller-specific overrides
- Exact Phone Rec caller rules take precedence; unknown-caller fallback is supported
- Phone Rec bridge storage self-initializes its additive `phone_rec_rules` table/index when first used, so the Render deploy does not depend on a full DB migration step for this feature
- Default number routing still applies when Phone Rec has no active override: `forward`, `ai_voice`, `voicemail`, or `reject`
- Booking tools remain available only when the caller-specific Phone Rec rule permits booking

## Product

- Dashboard: call stats and recent activity
- Phone Numbers: provision and configure Twilio numbers
- Number Detail: forwarding, AI, voicemail, caller ID and prompts
- Call Logs: history and recordings
- Contacts and Companies CRM
- AI voice settings
- Appointments and AI booking
- Phone Rec bridge: caller-specific scripts, message-taking, business answers, offers, lead intake, and appointment permissions

## Gotchas

- Render auto-deploys `main`; a successful GitHub push should normally trigger the production deploy automatically.
- `PHONE_REC_INTEGRATION_KEY` must be configured before Phone Rec can sync rules.
- Mobile no-answer forwarding must point to the selected CallingAgent/Twilio line for AI takeover of an existing cellular number.
- Phone Rec's ring-delay value describes desired behavior, but the actual handoff timing for a carrier call is controlled by the mobile carrier's conditional-forwarding timer.
- `@apply dark` is not valid in Tailwind v4.

## Pointers

- OpenAPI controls generated dashboard types; edit the spec before dashboard-facing API codegen.
