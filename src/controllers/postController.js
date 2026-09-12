import crypto from "crypto";
// import fs from "fs/promises";
import Post from "../models/Post.js";
import Account from "../models/Account.js";
import Activity from "../models/Activity.js";
import zernio from "../services/zernioService.js";
import { getAppBaseUrl } from "../utils/appUrl.js";

const allowedPlatforms = new Set(["twitter", "linkedin", "facebook", "instagram"]);
const platformLabel = (list) => list.join(", ");
// const normalizePlatforms = (platforms) => [...new Set((Array.isArray(platforms) ? platforms : []).map(String).map((p) => p.trim().toLowerCase()))];

const normalizePlatforms = (platforms) => {
  const list = Array.isArray(platforms)
    ? platforms
    : platforms
      ? [platforms]
      : [];

  return [
    ...new Set(
      list
        .map(String)
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean)
    )
  ];
};

console.log(normalizePlatforms)

const providerStatusToLocal = (status) => {
  if (status === "published") return "published";
  if (status === "partial") return "partial";
  if (status === "failed") return "failed";
  if (status === "publishing") return "publishing";
  if (status === "cancelled") return "cancelled";
  return "scheduled";
};

const resultsFromProvider = (platforms = []) =>
  platforms.map((p) => ({
    platform: p.platform,
    accountId: p.accountId || p.account?.accountId || p.account?.id || null,
    externalPostId: p.platformPostId || p.externalPostId || null,
    platformPostUrl: p.platformPostUrl || p.url || null,
    status: p.status === "published" ? "success" : p.status === "cancelled" ? "cancelled" : p.status === "failed" ? "failed" : "pending",
    error: p.errorMessage || p.error || null,
    publishedAt: p.status === "published" ? new Date() : null,
  }));

export const listPosts = async (req, res, next) => {
  try {
    const { status, limit: rawLimit, cursor } = req.query;
    const limit = Math.min(Math.max(Number(rawLimit) || 50, 1), 100);
    const filter = { user: req.user._id };
    if (status) filter.status = status;
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (Number.isNaN(cursorDate.getTime())) return res.status(400).json({ message: "Invalid cursor." });
      filter.createdAt = { $lt: cursorDate };
    }

    const posts = await Post.find(filter).sort({ createdAt: -1 }).limit(limit + 1);
    const hasMore = posts.length > limit;
    if (hasMore) posts.pop();
    const nextCursor = hasMore && posts.length ? posts.at(-1).createdAt.toISOString() : null;
    res.json({ posts, nextCursor });
  } catch (err) {
    next(err);
  }
};

export const createPost = async (req, res, next) => {
  try {
    const content = String(req.body.content || "").trim();
    const platforms = normalizePlatforms(req.body.platforms);
    const scheduledAt = new Date(req.body.scheduledAt);
    const timezone = String(req.body.timezone || "UTC");
    const source = req.body.source === "ai" ? "ai" : "manual";
    const tone = req.body.tone ? String(req.body.tone).trim() : null;
    const clientRequestId = String(req.headers["idempotency-key"] || req.headers["x-request-id"] || "").trim();
    const requestId = clientRequestId || crypto.randomUUID();

    if (!content) return res.status(400).json({ message: "Add some content and pick at least one platform." });
    if (content.length > 2000) return res.status(400).json({ message: "Content cannot exceed 2000 characters." });
    if (!platforms.length) return res.status(400).json({ message: "Pick at least one platform." });
    if (platforms.some((p) => !allowedPlatforms.has(p))) return res.status(400).json({ message: "One or more platforms are unsupported." });
    if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ message: "Choose a valid date and time." });

    const existing = await Post.findOne({ user: req.user._id, requestId });
    if (existing) return res.status(200).json({ post: existing, idempotent: true });

    const connectedAccounts = await Account.find({
      user: req.user._id,
      platform: { $in: platforms },
      status: "connected",
    }).sort({ connectedAt: -1 });
    const accountByPlatform = new Map();
    for (const account of connectedAccounts) {
      if (!accountByPlatform.has(account.platform)) accountByPlatform.set(account.platform, account);
    }
    if (platforms.some((p) => !accountByPlatform.has(p))) {
      return res.status(400).json({ message: "One or more selected platforms aren't connected." });
    }
    const accounts = platforms.map((p) => accountByPlatform.get(p));

    // const mediaUrl = req.file
    //   ? `${getAppBaseUrl()}/uploads/${req.file.filename}`
    //   : (req.body.mediaUrl || null);

    const mediaUrl = req.file?.path || req.body.mediaUrl || null;

    if (mediaUrl && !req.file) {
      try {
        const parsed = new URL(mediaUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ message: "Media URL must use HTTP or HTTPS." });
      } catch {
        return res.status(400).json({ message: "Media URL is invalid." });
      }
    }
    const resolvedMediaType = req.file ? (req.file.mimetype.startsWith("video/") ? "video" : "image") : (req.body.mediaType || null);
    if (resolvedMediaType && !["image", "video"].includes(resolvedMediaType)) return res.status(400).json({ message: "Unsupported media type." });

    const post = await Post.create({
      user: req.user._id,
      content,
      platforms,
      mediaUrl,
      mediaType: resolvedMediaType,
      scheduledAt,
      timezone,
      source,
      tone,
      status: "validating",
      requestId,
    });

    const isDue = scheduledAt.getTime() <= Date.now() + 60 * 1000;
    try {
      const zernioResult = await zernio.createPost({
        content,
        mediaUrl,
        mediaType: resolvedMediaType,
        accounts: platforms.map((p) => accountByPlatform.get(p)),
        scheduledAt,
        timezone,
        publishNow: isDue,
        requestId,
      });

      post.zernioPostId = zernioResult.zernioPostId || null;
      post.status = providerStatusToLocal(zernioResult.status);
      post.lastSyncedAt = new Date();
      post.lastError = null;
      post.zernioResults = resultsFromProvider(zernioResult.platforms);
      if (post.status === "published") post.publishedAt = new Date();
      await post.save();
    } catch (err) {
      post.status = "failed";
      post.lastError = err.message;
      await post.save();

      // if (req.file) await fs.unlink(req.file.path).catch(() => {});

      return res.status(err.status && err.status < 500 ? err.status : 502).json({ message: `Zernio rejected this post: ${err.message}` });
    }

    await Activity.create({
      user: req.user._id,
      type: post.status === "published" ? "published" : post.status === "failed" ? "failed" : "scheduled",
      message: post.status === "published" ? `Published post to ${platformLabel(platforms)}` : `Scheduled post for ${platformLabel(platforms)}`,
      relatedPost: post._id,
      platforms,
    });

    res.status(201).json({ post });
  } catch (err) {
    next(err);
  }
};

export const publishPost = async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, user: req.user._id });
    if (!post) return res.status(404).json({ message: "Post not found." });
    if (["published", "publishing"].includes(post.status)) return res.status(400).json({ message: "This post is already being published or is published." });
    if (!post.zernioPostId) return res.status(400).json({ message: "This post has no provider post to publish." });

    const connectedAccounts = await Account.find({ user: req.user._id, platform: { $in: post.platforms }, status: "connected" }).sort({ connectedAt: -1 });
    const accountByPlatform = new Map();
    for (const account of connectedAccounts) if (!accountByPlatform.has(account.platform)) accountByPlatform.set(account.platform, account);
    if (post.platforms.some((p) => !accountByPlatform.has(p))) return res.status(400).json({ message: "One or more target accounts are no longer connected." });
    const accounts = post.platforms.map((p) => accountByPlatform.get(p));

    if (!zernio.isLive()) {
      post.status = "published";
      post.publishedAt = new Date();
      post.zernioResults = post.platforms.map((platform) => ({ platform, externalPostId: `mock_post_${Math.random().toString(36).slice(2, 10)}`, status: "success", publishedAt: new Date() }));
    } else {
      const user = req.user;
      if (!user.zernioProfileId) return res.status(400).json({ message: "Your publishing profile is not ready yet." });
      const remote = await zernio.updatePost({
        zernioPostId: post.zernioPostId,
        profileId: user.zernioProfileId,
        accounts,
        scheduledAt: new Date(),
        timezone: post.timezone,
        publishNow: true,
      });
      post.status = providerStatusToLocal(remote.status);
      post.zernioResults = resultsFromProvider(remote.platforms);
      if (post.status === "published") post.publishedAt = new Date();
      post.lastSyncedAt = new Date();
    }

    await post.save();
    await Activity.create({ user: req.user._id, type: "published", message: `Published post to ${platformLabel(post.platforms)}`, relatedPost: post._id, platforms: post.platforms });
    res.json({ post });
  } catch (err) {
    next(err);
  }
};

export const cancelPost = async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, user: req.user._id });
    if (!post) return res.status(404).json({ message: "Post not found." });
    if (["published", "cancelled"].includes(post.status)) return res.status(400).json({ message: `Cannot cancel a ${post.status} post.` });

    if (zernio.isLive() && post.zernioPostId) await zernio.cancelPost({ zernioPostId: post.zernioPostId });

    post.status = "cancelled";
    post.cancelledAt = new Date();
    await post.save();

    await Activity.create({ user: req.user._id, type: "cancelled", message: `Cancelled post to ${platformLabel(post.platforms)}`, relatedPost: post._id, platforms: post.platforms });
    res.json({ message: "Post cancelled.", post });
  } catch (err) {
    next(err);
  }
};

export const retryPost = async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, user: req.user._id });
    if (!post) return res.status(404).json({ message: "Post not found." });
    if (!post.zernioPostId) return res.status(400).json({ message: "This post has no provider post to retry." });
    if (!["failed", "partial"].includes(post.status)) return res.status(400).json({ message: "Only failed or partially published posts can be retried." });

    const remote = await zernio.retryPost({ zernioPostId: post.zernioPostId, requestId: crypto.randomUUID() });
    post.status = providerStatusToLocal(remote.status);
    post.zernioResults = resultsFromProvider(remote.platforms);
    post.lastError = null;
    post.lastSyncedAt = new Date();
    if (post.status === "published") post.publishedAt = new Date();
    await post.save();

    res.json({ post });
  } catch (err) {
    next(err);
  }
};

export const updatePost = async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, user: req.user._id });
    if (!post) return res.status(404).json({ message: "Post not found." });
    if (["published", "cancelled"].includes(post.status)) return res.status(400).json({ message: `Cannot edit a ${post.status} post.` });

    const scheduledAt = new Date(req.body.scheduledAt || post.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ message: "Choose a valid date and time." });
    const timezone = String(req.body.timezone || post.timezone || "UTC");

    if (zernio.isLive() && post.zernioPostId) {
      const accounts = await Account.find({ user: req.user._id, platform: { $in: post.platforms }, status: "connected" });
      if (accounts.length !== post.platforms.length) return res.status(400).json({ message: "One or more target accounts are no longer connected." });
      const remote = await zernio.updatePost({ zernioPostId: post.zernioPostId, profileId: req.user.zernioProfileId, accounts, scheduledAt, timezone, publishNow: false });
      post.status = providerStatusToLocal(remote.status);
      post.zernioResults = resultsFromProvider(remote.platforms);
    }

    if (req.body.content !== undefined) {
      const content = String(req.body.content).trim();
      if (!content || content.length > 2000) return res.status(400).json({ message: "Content must be between 1 and 2000 characters." });
      post.content = content;
    }
    post.scheduledAt = scheduledAt;
    post.timezone = timezone;
    await post.save();
    res.json({ post });
  } catch (err) {
    next(err);
  }
};

// Backward-compatible DELETE route now performs a real cancellation rather
// than deleting the local record while the provider still has a scheduled post.
export const deletePost = cancelPost;
