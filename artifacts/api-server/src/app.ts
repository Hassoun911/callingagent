import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import bookingFlowSettingsRouter, { refreshStoredBookingFlowPrompts } from "./routes/booking-flow-settings";
import bookingServiceAliasGuardRouter from "./routes/booking-service-alias-guard";
import bookingContextGuardRouter from "./routes/booking-context-guard";
import bookingSoonestGuardRouter from "./routes/booking-soonest-guard";
import bookingIntakeGuardRouter from "./routes/booking-intake-guard";
import bookingPreferenceGuardRouter from "./routes/booking-preference-guard";
import bookingIntegrityGuardRouter from "./routes/booking-integrity-guard";
import bookingExactTimeResponseGuardRouter from "./routes/booking-exact-time-response-guard";
import bookingOrchestratorRouter from "./routes/booking-orchestrator";
import twilioAiGuardRouter from "./routes/twilio-ai-guard";
import companyWhatsappNotificationsRouter, { disableLegacyGlobalAdminSms } from "./routes/company-whatsapp-notifications";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

// Clean up legacy global notifications and refresh the persisted booking-rule
// blocks on every deploy so older phone prompts cannot keep stale behavior.
disableLegacyGlobalAdminSms().catch(() => {});
refreshStoredBookingFlowPrompts().catch(() => {});

// Booking calls are handled in layers. Natural service aliases run first so
// ordinary caller wording such as "changing my tire" resolves to the company's
// configured service before strict context validation can reject the phrase.
// Context then persists normalized facts from every caller turn. Soonest requests
// become an explicit earliest-calendar preference; intake prevents generic service
// guesses; time corrections outrank stale offers; integrity enforces company-scoped
// required details before the orchestrator is allowed to confirm or create an appointment.
app.use("/api", bookingServiceAliasGuardRouter);
app.use("/api", bookingContextGuardRouter);
app.use("/api", bookingSoonestGuardRouter);
app.use("/api", bookingIntakeGuardRouter);
app.use("/api", bookingPreferenceGuardRouter);
app.use("/api", bookingIntegrityGuardRouter);
app.use("/api", bookingExactTimeResponseGuardRouter);
app.use("/api", bookingOrchestratorRouter);
app.use("/api", twilioAiGuardRouter);
app.use("/api", companyWhatsappNotificationsRouter);
app.use("/api", bookingFlowSettingsRouter);
app.use("/api", router);

const frontendDist = path.resolve(process.cwd(), "artifacts/call-center/dist/public");
app.use(express.static(frontendDist));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

export default app;
