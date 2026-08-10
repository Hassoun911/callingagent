import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, companiesTable } from "@workspace/db";
import { sendAdminWhatsappTemplate } from "../lib/admin-whatsapp-template";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const ONE_SHOT_TEST_TOKEN = "zM8yQ1nK5vT7pR2cL9xF4aH6wD3sJ0uB";
let used = false;

router.post("/internal/admin-whatsapp-test", async (req, res): Promise<void> => {
  const token = String(req.get("x-whatsapp-test-token") || "");
  if (token !== ONE_SHOT_TEST_TOKEN) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (used) {
    res.status(409).json({ error: "This one-shot test endpoint has already been used" });
    return;
  }

  used = true;
  try {
    const requestedName = String(req.body?.companyName || "All Tire Mobile Shop").trim().toLowerCase();
    const companies = await db.select().from(companiesTable);
    const company = companies.find(c => c.name?.trim().toLowerCase() === requestedName)
      ?? companies.find(c => c.name?.trim().toLowerCase().includes(requestedName));

    if (!company) {
      used = false;
      res.status(404).json({ error: `Company not found: ${requestedName}` });
      return;
    }

    const destination = company.adminWhatsapp?.trim();
    if (!destination) {
      used = false;
      res.status(400).json({ error: "Company admin WhatsApp is not configured", companyId: company.id, companyName: company.name });
      return;
    }

    const sid = await sendAdminWhatsappTemplate({
      from: "",
      to: destination,
      context: {
        companyName: company.name,
        callerName: "CallingAgent Production Test",
        callerPhone: "+10000000000",
        duration: "Test",
        callType: "WhatsApp Admin Test",
        location: "Test location",
        summary: "Production WhatsApp sender delivery test.",
        action: "No action required",
        appointmentTitle: "WhatsApp Admin Test",
        appointmentDateTime: new Date().toISOString(),
        status: "Test",
      },
    });

    logger.info({ companyId: company.id, companyName: company.name, destination, sid }, "One-shot production admin WhatsApp test sent");
    res.json({ ok: true, companyId: company.id, companyName: company.name, destination, sid });
  } catch (error: any) {
    used = false;
    logger.error({ err: error?.message, code: error?.code }, "One-shot production admin WhatsApp test failed");
    res.status(500).json({ ok: false, error: error?.message || "WhatsApp test failed", code: error?.code ?? null, moreInfo: error?.moreInfo ?? null });
  }
});

export default router;
