import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export async function ensureExtensionSchema(): Promise<void> {
  await db.execute(sql`ALTER TABLE extensions ADD COLUMN IF NOT EXISTS agents JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(sql`ALTER TABLE extensions ADD COLUMN IF NOT EXISTS fallback_action TEXT NOT NULL DEFAULT 'voicemail'`);
  await db.execute(sql`ALTER TABLE extensions ADD COLUMN IF NOT EXISTS ring_count INTEGER NOT NULL DEFAULT 4`);
}
