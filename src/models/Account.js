import mongoose from "mongoose";

const accountSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    platform: {
      type: String,
      enum: ["twitter", "linkedin", "facebook", "instagram"],
      required: true,
    },
    displayName: { type: String, required: true, trim: true },
    handle: { type: String, trim: true },
    zernioAccountId: { type: String, required: true },
    status: {
      type: String,
      enum: ["connected", "syncing", "warning", "expired", "disconnected", "error"],
      default: "connected",
      index: true,
    },
    lastError: { type: String, default: null },
    lastSyncedAt: { type: Date, default: null },
    connectedAt: { type: Date, default: Date.now },
    disconnectedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// A user may have multiple accounts on the same platform. The provider
// account id is the durable identity we use for uniqueness and webhooks.
accountSchema.index({ user: 1, zernioAccountId: 1 }, { unique: true });
accountSchema.index({ zernioAccountId: 1 });
accountSchema.index({ user: 1, platform: 1, status: 1 });

export default mongoose.model("Account", accountSchema);
