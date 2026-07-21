import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import phoneNumbersRouter from "./phone-numbers";
import contactsRouter from "./contacts";
import companiesRouter from "./companies";
import callLogsRouter from "./call-logs";
import aiVoiceRouter from "./ai-voice";
import dashboardRouter from "./dashboard";
import costsRouter from "./costs";
import twilioWebhooksRouter from "./twilio-webhooks";
import watchesRouter from "./watches";
import smsRouter from "./sms";
import campaignsRouter from "./campaigns";
import extensionsRouter from "./extensions";
import platformUsersRouter from "./platform-users";
import appointmentsRouter from "./appointments";
import { routeAccessControl } from "../middleware/route-access";

const router: IRouter = Router();

// Public routes and Twilio callbacks remain outside the dashboard permission gate.
router.use(healthRouter);
router.use(authRouter);
router.use(twilioWebhooksRouter);

// Every dashboard/API route below is checked against the authenticated user's role.
router.use(routeAccessControl);
router.use(platformUsersRouter);
router.use(phoneNumbersRouter);
router.use(contactsRouter);
router.use(companiesRouter);
router.use(callLogsRouter);
router.use(aiVoiceRouter);
router.use(dashboardRouter);
router.use(costsRouter);
router.use(watchesRouter);
router.use(smsRouter);
router.use(campaignsRouter);
router.use(extensionsRouter);
router.use(appointmentsRouter);

export default router;