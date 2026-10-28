import { Router, type IRouter } from "express";
import healthRouter from "./health";
import planCatalogRouter from "./plan-catalog";
import authRouter from "./auth";
import phoneNumbersRouter from "./phone-numbers";
import contactsRouter from "./contacts";
import companiesRouter from "./companies";
import callLogsRouter from "./call-logs";
import bookingAiExtractRouter from "./booking-ai-extract";
import aiVoiceRouter from "./ai-voice";
import dashboardRouter from "./dashboard";
import costsRouter from "./costs";
import twilioWebhooksRouter from "./twilio-webhooks";
import telnyxVoiceWebhooksRouter from "./telnyx-voice-webhooks";
import telnyxSmsWebhooksRouter from "./telnyx-sms-webhooks";
import phoneRecBridgeRouter from "./phone-rec-bridge";
import watchesRouter from "./watches";
import smsRouter from "./sms";
import campaignsRouter from "./campaigns";
import extensionsRouter from "./extensions";
import companyCallOutRouter from "./company-call-out";
import platformUsersRouter from "./platform-users";
import appointmentsRouter from "./appointments";
import companyAppointmentsRouter from "./company-appointments";
import companyEventsRouter from "./company-events";
import portalVisibilityRouter, { enforceCompanyPortalVisibility } from "./portal-visibility";
import { routeAccessControl } from "../middleware/route-access";
import { aiCallFinalizer } from "../middleware/ai-call-finalizer";
import { aiDateContext } from "../middleware/ai-date-context";
import { companyAdminWhatsappSync } from "../middleware/company-admin-whatsapp";

const router: IRouter = Router();

// Public routes and Twilio callbacks remain outside the dashboard permission gate.
router.use(healthRouter);
router.use(planCatalogRouter);
router.use(authRouter);
router.use(aiDateContext);
router.use(aiCallFinalizer);
router.use(phoneRecBridgeRouter);
router.use(twilioWebhooksRouter);
router.use(telnyxVoiceWebhooksRouter);
router.use(telnyxSmsWebhooksRouter);

// Every dashboard/API route below is checked against the authenticated user's role.
router.use(routeAccessControl);
router.use(companyAdminWhatsappSync);
router.use(portalVisibilityRouter);
router.use(enforceCompanyPortalVisibility);
router.use(companyEventsRouter);
router.use(platformUsersRouter);
router.use(phoneNumbersRouter);
router.use(contactsRouter);
router.use(companiesRouter);
router.use(callLogsRouter);
// Mount the corrected extraction handler before the legacy AI voice router.
router.use(bookingAiExtractRouter);
router.use(aiVoiceRouter);
router.use(dashboardRouter);
router.use(costsRouter);
router.use(watchesRouter);
router.use(smsRouter);
router.use(campaignsRouter);
router.use(extensionsRouter);
router.use(companyCallOutRouter);
// Company users must be scoped before the shared appointments router can handle the request.
router.use(companyAppointmentsRouter);
router.use(appointmentsRouter);

export default router;
