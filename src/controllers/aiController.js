import Activity from "../models/Activity.js";
import ai from "../services/aiService.js";
import mongoose from "mongoose";
import cloudinary from "../config/cloudinary.js";

const generationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    prompt: {
      type: String,
      required: true,
    },

    caption: {
      type: String,
      required: true,
    },

    imageUrl: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const Generation =
  mongoose.models.Generation ||
  mongoose.model("Generation", generationSchema);


// @desc Generate AI image + text
// @route POST /api/ai/generate
export const generateContent = async (req, res, next) => {
  try {
    const prompt = String(req.body.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({
        message: "Please enter a prompt.",
      });
    }

    if (prompt.length > 2000) {
      return res.status(400).json({
        message: "Prompt cannot exceed 2000 characters.",
      });
    }

    // 1. Generate AI image and text

    const [image, caption] = await Promise.all([
      ai.generateImage({
        prompt,
      }),

      ai.generateText({
        prompt,
      }),
    ]);

    // 2. Convert Base64 image to data URL

    const imageData =
      `data:${image.mimeType};base64,${image.base64}`;

    // 3. Upload image to Cloudinary

    const uploadResult =
      await cloudinary.uploader.upload(imageData, {
        folder: "ai-generated",
        resource_type: "image",
      });

    // 4. Get Cloudinary URL

    const imageUrl = uploadResult.secure_url;

    // 5. Save ONLY Cloudinary URL in MongoDB

    const generation = await Generation.create({
      user: req.user._id,
      prompt,
      caption,
      imageUrl,
    });

    // 6. Create activity

    await Activity.create({
      user: req.user._id,
      type: "ai_generated",
      message: "Generated a new AI image and caption",
    });

    // 7. Send response

    res.status(201).json({
      generation,
    });

  } catch (err) {
    next(err);
  }
};


// @desc List recent AI generations
// @route GET /api/ai/generations
export const listGenerations = async (req, res, next) => {
  try {
    const generations = await Generation.find({
      user: req.user._id,
    })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      generations,
    });

  } catch (err) {
    next(err);
  }
};