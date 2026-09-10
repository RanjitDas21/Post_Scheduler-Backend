import Activity from "../models/Activity.js";
import ai from "../services/aiService.js";

// In-memory-free: generations are stored as lightweight activity-less records
// on the fly and returned to the client; the client keeps its own recent list
// per session, while published/scheduled ones become real Posts.
import mongoose from "mongoose";

const generationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    prompt: String,
    tone: String,
    caption: String,
    imageUrl: String,
  },
  { timestamps: true }
);

const Generation = mongoose.models.Generation || mongoose.model("Generation", generationSchema);

// @desc  Generate a caption (and optional image) from a prompt
// @route POST /api/ai/generate
export const generateContent = async (req, res, next) => {
  try {
    const prompt = String(req.body.prompt || "").trim();
    const tone = String(req.body.tone || "Professional").trim();
    const withImage = req.body.withImage === true || req.body.withImage === "true";
    const allowedTones = new Set(["Professional", "Creative", "Funny", "Minimalist", "Excited"]);

    if (!prompt) return res.status(400).json({ message: "Tell us what you'd like to create." });
    if (prompt.length > 2000) return res.status(400).json({ message: "Prompt cannot exceed 2000 characters." });
    if (!allowedTones.has(tone)) return res.status(400).json({ message: "Unsupported tone." });

    const [caption, imageUrl] = await Promise.all([
      ai.generateCaption({ prompt, tone }),
      withImage ? ai.generateImage({ prompt }) : Promise.resolve(null),
    ]);

    const generation = await Generation.create({
      user: req.user._id,
      prompt,
      tone,
      caption,
      imageUrl,
    });

    await Activity.create({
      user: req.user._id,
      type: "ai_generated",
      message: "Generated new AI content",
    });

    res.status(201).json({ generation });
  } catch (err) {
    next(err);
  }
};

// @desc  List recent AI generations for the user
// @route GET /api/ai/generations
export const listGenerations = async (req, res, next) => {
  try {
    const generations = await Generation.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(20);
    res.json({ generations });
  } catch (err) {
    next(err);
  }
};
