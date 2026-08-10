import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, companiesTable, phoneNumbersTable } from "@workspace/db";
import { sendAdminWhatsappTemplate } from "../lib/admin-whatsapp-template";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const ONE_SHOT_TEST_TOKEN = "iknY2eEb8AH0nZERqrBOqk_iRXiHFxJc";
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

    const phones = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.companyId, company.id));
    const configuredSender = process.env.TWILIO_WHATSAPP_FROM?.trim();
    const sender = configuredSender || phones.find(p => p.number)?.number?.trim();
    if (!sender) {
      used = false;
      res.status(400).json({ error: "No WhatsApp sender is configured", companyId: company.id, companyName: company.name, destination });
      return;
    }

    const sid = await sendAdminWhatsappTemplate({
      from: sender,
      to: destination,
      context: {
        companyName: company.name,
        callerName: "CallingAgent Test",
        callerPhone: "+10000000000",
        duration: "Test",
        callType: "WhatsApp Admin Test",
        location: "Test location",
        summary: "This is a CallingAgent admin WhatsApp delivery test.",
        action: "No action required",
        appointmentTitle: "WhatsApp Admin Test",
        appointmentDateTime: new Date().toISOString(),
        status: "Test",
      },
    });

    logger.info({ companyId: company.id, companyName: company.name, destination, sender, sid }, "One-shot admin WhatsApp test sent");
    res.json({ ok: true, companyId: company.id, companyName: company.name, destination, sender, sid });
  } catch (error: any) {
    used = false;
    logger.error({ err: error?.message, code: error?.code }, "One-shot admin WhatsApp test failed");
    res.status(500).json({
      ok: false,
      error: error?.message || "WhatsApp test failed",
      code: error?.code ?? null,
      moreInfo: error?.moreInfo ?? null,
    });
  }
});

export default router;
