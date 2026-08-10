import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import bookingFlowSettingsRouter, { refreshStoredBookingFlowPrompts } from "./routes/booking-flow-settings";
import bookingIntakeGuardRouter from "./routes/booking-intake-guard";
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

// Booking calls are now handled in layers: the intake guard prevents generic
// booking intent from guessing a service, then the state-driven orchestrator
// owns scheduling state, real availability, preference changes, and slot holds.
app.use("/api", bookingIntakeGuardRouter);
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
