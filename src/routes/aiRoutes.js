import express from "express";
import { generateContent, listGenerations } from "../controllers/aiController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.post("/generate", generateContent);
router.get("/generations", listGenerations);

export default router;
