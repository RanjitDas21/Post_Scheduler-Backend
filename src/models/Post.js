import mongoose from "mongoose";

const postSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    content: { type: String, required: true, maxlength: 2000, trim: true },
    platforms: [
      {
        type: String,
        enum: ["twitter", "linkedin", "facebook", "instagram"],
        required: true,
      },
    ],
    mediaUrl: { type: String, default: null },
    mediaType: { type: String, enum: ["image", "video", null], default: null },
    scheduledAt: { type: Date, required: true, index: true },
    timezone: { type: String, default: "UTC" },
    status: {
      type: String,
      enum: ["draft", "validating", "scheduled", "publishing", "published", "partial", "failed", "cancelled"],
      default: "scheduled",
      index: true,
    },
    source: { type: String, enum: ["manual", "ai"], default: "manual" },
    tone: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    // Provider post id once the post has been handed to Zernio.
    zernioPostId: { type: String, default: null, index: true },
    // Internal idempotency key for the logical provider create request.
    requestId: { type: String, default: null, index: true },
    // Used by the existing cron-based synchronizer to prevent two server
    // ticks from processing the same post simultaneously.
    syncLockedAt: { type: Date, default: null },
    zernioResults: [
      {
        platform: { type: String, required: true },
        accountId: { type: String, default: null },
        externalPostId: { type: String, default: null },
        platformPostUrl: { type: String, default: null },
        status: { type: String, enum: ["success", "failed", "pending", "cancelled"], default: "pending" },
        error: { type: String, default: null },
        publishedAt: { type: Date, default: null },
      },
    ],
  },
  { timestamps: true }
);

postSchema.index({ user: 1, status: 1, scheduledAt: 1 });
postSchema.index({ user: 1, createdAt: -1 });
postSchema.index({ user: 1, requestId: 1 }, { unique: true, sparse: true });

export default mongoose.model("Post", postSchema);
