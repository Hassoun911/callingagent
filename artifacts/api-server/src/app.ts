import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import bookingFlowSettingsRouter from "./routes/booking-flow-settings";
import twilioAiGuardRouter from "./routes/twilio-ai-guard";
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

// Must run before the main API router. It prevents booking/availability turns
// from hanging up when the AI tells the caller to wait and the caller stays silent.
app.use("/api", twilioAiGuardRouter);
app.use("/api", bookingFlowSettingsRouter);
app.use("/api", router);

const frontendDist = path.resolve(process.cwd(), "artifacts/call-center/dist/public");
app.use(express.static(frontendDist));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

export default app;
