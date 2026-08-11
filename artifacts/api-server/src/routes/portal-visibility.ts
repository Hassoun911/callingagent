import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const router: IRouter = Router();

export type PortalVisibility = {
  pages: {
    dashboard: boolean;
    phoneNumbers: boolean;
    campaigns: boolean;
    callLogs: boolean;
    messages: boolean;
    contacts: boolean;
    bookings: boolean;
    users: boolean;
    notifications: boolean;
  };
  dashboard: {
    liveCalls: boolean;
    unreadSms: boolean;
    todaysBookings: boolean;
    activeCampaigns: boolean;
    phoneLines: boolean;
    activityFeed: boolean;
    upcomingBookings: boolean;
    quickActions: boolean;
  };
  phoneNumber: {
    answerMode: boolean;
    forwarding: boolean;
    greeting: boolean;
    language: boolean;
    aiInstructions: boolean;
    voice: boolean;
    voicemailGreeting: boolean;
    lineIdentity: boolean;
    notificationEmail: boolean;
    testCall: boolean;
    twilioStatus: boolean;
  };
  notifications: {
    adminWhatsapp: boolean;
    notificationEmail: boolean;
  };
};

export const DEFAULT_PORTAL_VISIBILITY: PortalVisibility = {
  pages: {
    dashboard: true,
    phoneNumbers: true,
    campaigns: true,
    callLogs: true,
    messages: true,
    contacts: true,
    bookings: true,
    users: true,
    notifications: false,
  },
  dashboard: {
    liveCalls: true,
    unreadSms: true,
    todaysBookings: true,
    activeCampaigns: true,
    phoneLines: true,
    activityFeed: true,
    upcomingBookings: true,
    quickActions: true,
  },
  phoneNumber: {
    answerMode: true,
    forwarding: true,
    greeting: true,
    language: true,
    aiInstructions: false,
    voice: false,
    voicemailGreeting: true,
    lineIdentity: true,
    notificationEmail: true,
    testCall: true,
    twilioStatus: true,
  },
  notifications: {
    adminWhatsapp: true,
    notificationEmail: true,
  },
};

function mergeVisibility(value: any): PortalVisibility {
  return {
    pages: { ...DEFAULT_PORTAL_VISIBILITY.pages, ...(value?.pages ?? {}) },
    dashboard: { ...DEFAULT_PORTAL_VISIBILITY.dashboard, ...(value?.dashboard ?? {}) },
    phoneNumber: { ...DEFAULT_PORTAL_VISIBILITY.phoneNumber, ...(value?.phoneNumber ?? {}) },
    notifications: { ...DEFAULT_PORTAL_VISIBILITY.notifications, ...(value?.notifications ?? {}) },
  };
}

async function ensureTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS company_portal_visibility (
      company_id INTEGER PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function getPortalVisibility(companyId: number): Promise<PortalVisibility> {
  await ensureTable();
  const result: any = await db.execute(sql`
    SELECT settings FROM company_portal_visibility WHERE company_id = ${companyId}
  `);
  const row = result?.rows?.[0] ?? result?.[0];
  return mergeVisibility(row?.settings);
}

function scopedCompanyId(req: Request): number | null {
  return Number((req.user as any)?.companyId) || null;
}

function canRead(req: Request, companyId: number): boolean {
  return (req.user as any)?.role === "super_admin" || scopedCompanyId(req) === companyId;
}

router.get("/companies/:id/portal-visibility", async (req, res): Promise<void> => {
  const companyId = Number(req.params.id);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    res.status(400).json({ error: "Invalid company id" });
    return;
  }
  if (!canRead(req, companyId)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  res.json(await getPortalVisibility(companyId));
});

router.put("/companies/:id/portal-visibility", async (req, res): Promise<void> => {
  if ((req.user as any)?.role !== "super_admin") {
    res.status(403).json({ error: "Only the main administrator can change portal visibility" });
    return;
  }
  const companyId = Number(req.params.id);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    res.status(400).json({ error: "Invalid company id" });
    return;
  }
  const settings = mergeVisibility(req.body);
  await ensureTable();
  await db.execute(sql`
    INSERT INTO company_portal_visibility (company_id, settings, updated_at)
    VALUES (${companyId}, ${JSON.stringify(settings)}::jsonb, NOW())
    ON CONFLICT (company_id)
    DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()
  `);
  res.json(settings);
});

const mutationFeatureRules: Array<{ pattern: RegExp; page: keyof PortalVisibility["pages"] }> = [
  { pattern: /^\/phone-numbers(?:\/|$)/, page: "phoneNumbers" },
  { pattern: /^\/campaigns(?:\/|$)/, page: "campaigns" },
  { pattern: /^\/call-logs(?:\/|$)/, page: "callLogs" },
  { pattern: /^\/sms(?:\/|$)/, page: "messages" },
  { pattern: /^\/contacts(?:\/|$)/, page: "contacts" },
  { pattern: /^\/appointments(?:\/|$)/, page: "bookings" },
  { pattern: /^\/platform-users(?:\/|$)/, page: "users" },
];

export async function enforceCompanyPortalVisibility(req: Request, res: Response, next: NextFunction): Promise<void> {
  const role = (req.user as any)?.role;
  const companyId = scopedCompanyId(req);
  if (!companyId || role === "super_admin" || req.method === "GET" || req.method === "HEAD") {
    next();
    return;
  }

  const rule = mutationFeatureRules.find(item => item.pattern.test(req.path));
  if (!rule) {
    next();
    return;
  }

  try {
    const visibility = await getPortalVisibility(companyId);
    if (!visibility.pages[rule.page]) {
      res.status(403).json({ error: "This feature is hidden by the main administrator" });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export default router;
