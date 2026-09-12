import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
// import path from "path";
import crypto from "crypto";

import connectDB from "./config/db.js";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";
import { startSchedulerJob } from "./services/schedulerJob.js";
import mongoose from "mongoose";

import authRoutes from "./routes/authRoutes.js";
import accountRoutes from "./routes/accountRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";

dotenv.config();

const required = ["MONGO_URI", "JWT_SECRET"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is required.`);
}
if (process.env.ZERNIO_MODE === "live" && !process.env.ZERNIO_API_KEY) throw new Error("ZERNIO_API_KEY is required when ZERNIO_MODE=live.");
if (process.env.ZERNIO_MODE === "live" && !process.env.ZERNIO_WEBHOOK_SECRET) throw new Error("ZERNIO_WEBHOOK_SECRET is required when ZERNIO_MODE=live.");
if (process.env.AI_PROVIDER && process.env.AI_PROVIDER !== "mock" && !process.env.AI_API_KEY) throw new Error("AI_API_KEY is required when AI_PROVIDER is not mock.");

const app = express();
app.set("trust proxy", 1);

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173").split(",").map((o) => o.trim()).filter(Boolean);
app.use((req, res, next) => {
  req.requestId = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
});
app.use(cors({ origin: (origin, callback) => (!origin || allowedOrigins.includes(origin) ? callback(null, true) : callback(new Error(`Origin ${origin} is not allowed by CORS`))), credentials: true }));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use("/api/webhooks", express.raw({ type: "application/json", limit: "2mb" }), webhookRoutes);
app.use(express.json({ limit: "10mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
// app.use("/uploads", express.static(path.resolve("uploads"), { maxAge: "1h", fallthrough: false }));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

app.get('/',(req, res) => {
  res.send('Server is Live!');
});


app.use("/api", globalLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/ai/generate", aiLimiter);

app.get("/api/health", (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "not_ready", database: ready ? "connected" : "disconnected", time: new Date().toISOString(), requestId: req.requestId });
});
app.get("/api/health/live", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
let server;

const shutdown = async (signal) => {
  console.log(`${signal} received. Shutting down gracefully...`);
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.close(false).catch(() => {});
  process.exit(0);
};

const start = async () => {
  await connectDB();
  server = app.listen(PORT, () => console.log(`Loop API running on http://localhost:${PORT}`));
  startSchedulerJob();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});

export default app;
