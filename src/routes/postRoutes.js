import express from "express";
import { listPosts, createPost, publishPost, cancelPost, retryPost, updatePost } from "../controllers/postController.js";
import { protect } from "../middleware/authMiddleware.js";
import upload from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.use(protect);
router.get("/", listPosts);
router.post("/", upload.single("media"), createPost);
router.patch("/:id", updatePost);
router.post("/:id/publish", publishPost);
router.post("/:id/cancel", cancelPost);
router.post("/:id/retry", retryPost);
router.delete("/:id", cancelPost);

export default router;
