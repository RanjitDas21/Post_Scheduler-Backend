import express from "express";
import { handleZernioWebhook } from "../controllers/webhookController.js";

const router = express.Router();

// Note: this route is mounted in server.js with express.raw() (not
// express.json()) so the handler can verify the HMAC signature against the
// exact raw bytes Zernio sent - see docs.zernio.com/webhooks.
router.post("/zernio", handleZernioWebhook);

export default router;
