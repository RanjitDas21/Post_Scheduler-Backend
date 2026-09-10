import express from "express";
import { listAccounts, connectAccount, disconnectAccount, zernioCallback } from "../controllers/accountController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/callback", zernioCallback);
router.use(protect);
router.get("/", listAccounts);
router.post("/connect", connectAccount);
router.delete("/:id", disconnectAccount);

export default router;
