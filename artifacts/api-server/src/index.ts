import app from "./app";
import { logger } from "./lib/logger";
import { startWatchPoller } from "./lib/watch-poller";
import { startReminderPoller } from "./lib/reminders";
import { ensureBookingSchema } from "./lib/booking-schema";
import { warmTtsCache } from "./routes/twilio-webhooks";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  await ensureBookingSchema();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
    startWatchPoller();
    startReminderPoller();
    warmTtsCache();
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
