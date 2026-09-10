import mongoose from "mongoose";

const activitySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: ["published", "scheduled", "connected", "disconnected", "ai_generated", "failed", "cancelled"],
      required: true,
    },
    message: { type: String, required: true },
    relatedPost: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },
    platforms: [{ type: String }],
    // Provider webhook event id. Sparse unique index makes webhook handling
    // idempotent across restarts and multiple API instances.
    webhookEventId: { type: String, default: null },
  },
  { timestamps: true }
);

activitySchema.index({ user: 1, createdAt: -1 });
activitySchema.index({ webhookEventId: 1 }, { unique: true, sparse: true });

export default mongoose.model("Activity", activitySchema);
