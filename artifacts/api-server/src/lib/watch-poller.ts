import { eq } from "drizzle-orm";
import { db, numberWatchesTable } from "@workspace/db";
import { logger } from "./logger";
import twilio from "twilio";

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("Twilio credentials not configured");
  return twilio(accountSid, authToken);
}

async function searchForWatch(watch: any): Promise<any[]> {
  const client = getTwilioClient();
  const country = watch.country || "US";
  const searchParams: any = { limit: 20 };
  if (watch.areaCode) searchParams.areaCode = watch.areaCode;
  if (watch.city) searchParams.inLocality = watch.city;
  const results = await client.availablePhoneNumbers(country).local.list(searchParams);
  return results.map((n: any) => ({
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName,
    locality: n.locality || null,
    region: n.region || null,
    isoCountry: n.isoCountry,
  }));
}

export async function pollWatches() {
  let watches: any[] = [];
  try {
    watches = await db.select().from(numberWatchesTable).where(eq(numberWatchesTable.status, "watching"));
  } catch {
    return; // DB not ready yet
  }

  for (const watch of watches) {
    try {
      const found = await searchForWatch(watch);
      const now = new Date();

      if (found.length > 0) {
        await db.update(numberWatchesTable).set({
          status: "available",
          foundNumbers: JSON.stringify(found),
          lastChecked: now,
          notifiedAt: now,
        }).where(eq(numberWatchesTable.id, watch.id));
        logger.info({ watchId: watch.id, count: found.length }, "Watch: numbers found");
      } else {
        await db.update(numberWatchesTable).set({ lastChecked: now })
          .where(eq(numberWatchesTable.id, watch.id));
        logger.info({ watchId: watch.id }, "Watch: still no numbers");
      }
    } catch (err: any) {
      logger.warn({ watchId: watch.id, err: err.message }, "Watch poll failed");
    }
  }
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function startWatchPoller() {
  logger.info("Watch poller started (5-min interval)");
  // Run immediately after startup, then on interval
  setTimeout(async () => {
    await pollWatches();
    setInterval(pollWatches, POLL_INTERVAL_MS);
  }, 10_000); // 10s delay to let DB settle
}
