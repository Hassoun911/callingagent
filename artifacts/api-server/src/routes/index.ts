import { Router, type IRouter } from "express";
import healthRouter from "./health";
import phoneNumbersRouter from "./phone-numbers";
import contactsRouter from "./contacts";
import companiesRouter from "./companies";
import callLogsRouter from "./call-logs";
import aiVoiceRouter from "./ai-voice";
import dashboardRouter from "./dashboard";
import twilioWebhooksRouter from "./twilio-webhooks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(phoneNumbersRouter);
router.use(contactsRouter);
router.use(companiesRouter);
router.use(callLogsRouter);
router.use(aiVoiceRouter);
router.use(dashboardRouter);
router.use(twilioWebhooksRouter);

export default router;
