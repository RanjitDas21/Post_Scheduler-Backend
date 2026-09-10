import cron from "node-cron";
import Post from "../models/Post.js";
import Activity from "../models/Activity.js";
import zernio from "../services/zernioService.js";

const platformLabel = (list) => list.join(", ");
const staleLock = () => new Date(Date.now() - 5 * 60 * 1000);

const claimDuePost = async () =>
  Post.findOneAndUpdate(
    {
      status: { $in: ["scheduled", "publishing"] },
      scheduledAt: { $lte: new Date() },
      $or: [{ syncLockedAt: null }, { syncLockedAt: { $lte: staleLock() } }],
    },
    { $set: { syncLockedAt: new Date() } },
    { new: true, sort: { scheduledAt: 1 } }
  );

export const startSchedulerJob = () => {
  cron.schedule("* * * * *", async () => {
    try {
      // Claim one post at a time atomically. This keeps the existing cron
      // architecture but prevents duplicate work when more than one API
      // process happens to run the job.
      for (;;) {
        const post = await claimDuePost();
        if (!post) break;
        try {
          if (zernio.isLive() && post.zernioPostId) await syncFromZernio(post);
          else await simulatePublish(post);
        } finally {
          await Post.updateOne({ _id: post._id }, { $set: { syncLockedAt: null } }).catch(() => {});
        }
      }
    } catch (err) {
      console.error("Scheduler job error:", err.message);
    }
  });
  console.log("Scheduler job started (checks every minute for due posts).");
};

const normalizeResults = (platforms = []) =>
  platforms.map((p) => ({
    platform: p.platform,
    accountId: p.accountId || p.account?.accountId || p.account?.id || null,
    externalPostId: p.platformPostId || p.externalPostId || null,
    platformPostUrl: p.platformPostUrl || p.url || null,
    status: p.status === "published" ? "success" : p.status === "cancelled" || p.status === "deleted" ? "cancelled" : p.status === "failed" ? "failed" : "pending",
    error: p.errorMessage || p.error || null,
    publishedAt: p.status === "published" ? new Date() : null,
  }));

const syncFromZernio = async (post) => {
  try {
    const remote = await zernio.getPost({ zernioPostId: post.zernioPostId });
    const previousStatus = post.status;
    const status = remote.status;
    post.status = status === "published" ? "published" : status === "partial" ? "partial" : status === "failed" ? "failed" : status === "publishing" ? "publishing" : status === "cancelled" ? "cancelled" : "scheduled";
    post.zernioResults = normalizeResults(remote.platforms || []);
    post.lastSyncedAt = new Date();
    if (post.status === "published") {
      post.publishedAt = post.publishedAt || new Date();
      post.lastError = null;
    } else if (post.status === "failed" || post.status === "partial") {
      post.lastError = (remote.platforms || []).find((p) => p.errorMessage || p.error)?.errorMessage || (remote.platforms || []).find((p) => p.error)?.error || null;
    }
    await post.save();

    if (previousStatus !== post.status && ["published", "partial", "failed", "cancelled"].includes(post.status)) {
      await Activity.create({
        user: post.user,
        type: post.status === "published" ? "published" : post.status === "cancelled" ? "cancelled" : "failed",
        message:
          post.status === "published"
            ? `Published post to ${platformLabel(post.platforms)}`
            : post.status === "partial"
              ? `Some platforms failed while publishing to ${platformLabel(post.platforms)}`
              : `Zernio reported ${post.status} for ${platformLabel(post.platforms)}`,
        relatedPost: post._id,
        platforms: post.platforms,
      });
    }
  } catch (err) {
    // Provider/network errors are not treated as social-post failures. The
    // next tick retries reconciliation, while the local post remains intact.
    console.error(`Zernio status sync failed for post ${post._id}:`, err.message);
  }
};

const simulatePublish = async (post) => {
  if (!["scheduled", "publishing"].includes(post.status)) return;
  post.status = "published";
  post.publishedAt = new Date();
  post.lastSyncedAt = new Date();
  post.zernioResults = post.platforms.map((platform) => ({
    platform,
    externalPostId: `mock_post_${Math.random().toString(36).slice(2, 10)}`,
    status: "success",
    publishedAt: new Date(),
  }));
  await post.save();

  await Activity.create({
    user: post.user,
    type: "published",
    message: `Published post to ${platformLabel(post.platforms)}`,
    relatedPost: post._id,
    platforms: post.platforms,
  });
};
