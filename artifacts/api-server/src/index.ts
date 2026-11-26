import app from "./app";
import { ensurePlanCatalog } from "./routes/plan-catalog";
import { ensureStripeBillingSchema } from "./routes/stripe-billing";
import { ensureCompanySignupSchema } from "./routes/company-signup";
import { ensureCompanyFullAccessSchema } from "./lib/company-full-access";
import { ensureAiCreditSchema } from "./lib/ai-credit-wallet";
import { ensureInboundAiUsageSchema } from "./lib/inbound-ai-usage";
import { ensureInboundAiReservationSchema } from "./lib/inbound-ai-reservations";
import { ensureInboundAiTopupSchema } from "./lib/inbound-ai-topups";
import { ensureTelnyxUsageSchema, reconcileVerifiedTelnyxInboundDurations } from "./lib/telnyx-carrier-usage";
import { ensureTelnyxCpsSchema } from "./lib/telnyx-cps-guard";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./lib/logger";
import { startWatchPoller } from "./lib/watch-poller";
import { startReminderPoller } from "./lib/reminders";
import { ensureBookingSchema } from "./lib/booking-schema";
import { ensureExtensionSchema } from "./lib/extension-schema";
import { ensureAiBookingBehavior } from "./lib/ai-booking-behavior";
import { warmTtsCache } from "./routes/twilio-webhooks";
import { recoverConfirmedTelnyxOrder } from "./lib/recover-telnyx-order";

// All server-side date formatting defaults to Eastern Time unless a
// phone-number-specific timezone is supplied by the notification workflow.
// This prevents customer SMS/email reminders from exposing raw UTC times.
process.env.TZ = process.env.DEFAULT_TIMEZONE || "America/Toronto";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  await ensurePlanCatalog();
  await ensureStripeBillingSchema();
  await ensureCompanySignupSchema();
  await ensureCompanyFullAccessSchema();
  await ensureAiCreditSchema();
  await ensureInboundAiUsageSchema();
  await ensureInboundAiReservationSchema();
  await ensureInboundAiTopupSchema();
  await ensureTelnyxUsageSchema();
  // Safe, idempotent historical duration repair. Failure cannot interrupt VoIP:
  // signed carrier evidence may arrive late or some records may be unmatched.
  try {
    const repaired = await reconcileVerifiedTelnyxInboundDurations();
    logger.info({ repaired, billingCertified:false }, "Verified Telnyx inbound duration recovery completed");
  } catch(error:any) {
    logger.warn({ message:error?.message }, "Telnyx history recovery unavailable; retaining missing durations");
  }

  await ensureTelnyxCpsSchema();
  await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS google_site text`);
  await ensureBookingSchema();
  await ensureExtensionSchema();
  await ensureAiBookingBehavior();
  await recoverConfirmedTelnyxOrder();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port, timezone: process.env.TZ }, "Server listening");
    startWatchPoller();
    startReminderPoller();
    warmTtsCache();
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
