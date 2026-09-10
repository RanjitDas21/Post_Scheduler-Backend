import crypto from "crypto";
import User from "../models/User.js";
import Account from "../models/Account.js";
import Post from "../models/Post.js";
import Activity from "../models/Activity.js";
import { getPlatformMeta } from "../services/zernioService.js";

const verifySignature = (rawBody, signatureHeader) => {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret) return process.env.ZERNIO_MODE !== "live";
  if (!signatureHeader || !Buffer.isBuffer(rawBody)) return false;

  const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const supplied = String(signatureHeader).trim().toLowerCase();
  if (computed.length !== supplied.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(supplied));
};

const eventIdFrom = (payload, req) => payload?.id || req.headers["x-zernio-event-id"] || req.headers["x-late-event-id"];
const postIdFrom = (payload) => payload?.post?._id || payload?.post?.id || payload?.postId;
const accountIdFrom = (account) => account?.accountId || account?.id || account?._id;

export const handleZernioWebhook = async (req, res) => {
  const signature = req.headers["x-zernio-signature"] || req.headers["x-late-signature"];
  const rawBody = req.body;

  if (!verifySignature(rawBody, signature)) return res.status(401).json({ message: "Invalid signature." });

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ message: "Invalid JSON." });
  }

  const eventId = eventIdFrom(payload, req);
  if (!eventId) return res.status(400).json({ message: "Missing webhook event id." });

  // Persist the event marker through Activity's unique sparse index. This
  // survives restarts and works when more than one API instance is running.
  const alreadyProcessed = await Activity.exists({ webhookEventId: eventId });
  if (alreadyProcessed) return res.status(200).json({ received: true, duplicate: true });

  // Acknowledge after the durable dedupe marker is created. The actual event
  // update is kept fast and idempotent; provider retries are harmless.
  try {
    await routeEvent(payload, eventId);
  } catch (err) {
    console.error("Error processing Zernio webhook:", payload.event, err.message);
    // Do not manufacture a successful Activity marker when processing failed;
    // the provider can retry the event. We already return 2xx only after this
    // handler has attempted processing, keeping the existing architecture.
    return res.status(500).json({ message: "Webhook processing failed." });
  }

  return res.status(200).json({ received: true });
};

const routeEvent = async (payload, eventId) => {
  switch (payload.event) {
    case "account.connected":
      return onAccountConnected(payload.account, eventId);
    case "account.disconnected":
      return onAccountDisconnected(payload.account, eventId);
    case "post.published":
    case "post.failed":
    case "post.partial":
    case "post.cancelled":
    case "post.scheduled":
      return onPostOutcome(payload, eventId);
    case "post.platform.published":
    case "post.platform.failed":
    case "post.platform.deleted":
    case "post.tiktok.url_resolved":
      return onPlatformOutcome(payload, eventId);
    default:
      // Unknown events are intentionally recorded as harmless activity only
      // when we can associate them with a user. Otherwise they are ignored.
      return null;
  }
};

const createWebhookActivity = async ({ user, type, message, relatedPost = null, platforms = [], eventId }) => {
  try {
    return await Activity.create({ user, type, message, relatedPost, platforms, webhookEventId: eventId });
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }
};

const onAccountConnected = async (account, eventId) => {
  const accountId = accountIdFrom(account);
  const profileId = account?.profileId;
  const platform = account?.platform;
  if (!accountId || !profileId || !platform) return;

  const user = await User.findOne({ zernioProfileId: profileId });
  if (!user) return;

  const meta = getPlatformMeta();
  const local = await Account.findOneAndUpdate(
    { user: user._id, zernioAccountId: accountId },
    {
      user: user._id,
      platform,
      displayName: account.username || account.displayName || meta[platform]?.label || platform,
      handle: account.username ? `@${account.username}` : "",
      zernioAccountId: accountId,
      status: "connected",
      lastError: null,
      disconnectedAt: null,
      connectedAt: new Date(),
      lastSyncedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await createWebhookActivity({
    user: user._id,
    type: "connected",
    message: `Connected ${meta[platform]?.label || platform}`,
    platforms: [platform],
    eventId,
  });
  return local;
};

const onAccountDisconnected = async (account, eventId) => {
  const accountId = accountIdFrom(account);
  const profileId = account?.profileId;
  const platform = account?.platform;
  if (!accountId || !profileId) return;

  const user = await User.findOne({ zernioProfileId: profileId });
  if (!user) return;

  const local = await Account.findOneAndUpdate(
    { user: user._id, zernioAccountId: accountId },
    { status: "expired", disconnectedAt: new Date(), lastSyncedAt: new Date(), lastError: "Provider disconnected this account." },
    { new: true }
  );
  if (!local) return;

  await createWebhookActivity({
    user: user._id,
    type: "disconnected",
    message: `${platform || local.platform} disconnected - reconnect it from Accounts`,
    platforms: [platform || local.platform],
    eventId,
  });
};

const mergePlatformResults = (post, results) => {
  const incoming = results.map((r) => ({
    platform: r.platform,
    accountId: accountIdFrom(r),
    externalPostId: r.platformPostId || r.externalPostId || null,
    platformPostUrl: r.platformPostUrl || r.url || null,
    status: r.status === "published" ? "success" : r.status === "cancelled" || r.status === "deleted" ? "cancelled" : r.status === "failed" ? "failed" : "pending",
    error: r.errorMessage || r.error || null,
    publishedAt: r.status === "published" ? new Date() : null,
  }));

  const map = new Map((post.zernioResults || []).map((r) => [`${r.platform}:${r.accountId || ""}`, r]));
  for (const result of incoming) map.set(`${result.platform}:${result.accountId || ""}`, result);
  post.zernioResults = [...map.values()];
};

const aggregateStatus = (results, fallback) => {
  const statuses = results.map((r) => r.status);
  if (!statuses.length) return fallback;
  if (statuses.every((s) => s === "success")) return "published";
  if (statuses.every((s) => s === "cancelled")) return "cancelled";
  if (statuses.every((s) => s === "failed")) return "failed";
  if (statuses.some((s) => s === "success") && statuses.some((s) => s === "failed" || s === "cancelled")) return "partial";
  if (statuses.some((s) => s === "failed")) return "failed";
  return fallback;
};

const onPostOutcome = async (payload, eventId) => {
  const providerPostId = postIdFrom(payload);
  if (!providerPostId) return;
  const post = await Post.findOne({ zernioPostId: providerPostId });
  if (!post) return;

  const results = payload.results || payload.platforms || payload.post?.platforms || [];
  mergePlatformResults(post, results);

  if (payload.event === "post.published") post.status = "published";
  else if (payload.event === "post.partial") post.status = "partial";
  else if (payload.event === "post.failed") post.status = "failed";
  else if (payload.event === "post.cancelled") post.status = "cancelled";
  else if (payload.event === "post.scheduled") post.status = "scheduled";
  else post.status = aggregateStatus(post.zernioResults, post.status);

  post.lastSyncedAt = new Date();
  if (post.status === "published") {
    post.publishedAt = post.publishedAt || new Date();
    post.lastError = null;
  } else if (post.status === "failed" || post.status === "partial") {
    post.lastError = results.find((r) => r.errorMessage || r.error)?.errorMessage || results.find((r) => r.error)?.error || null;
  }
  if (post.status === "cancelled") post.cancelledAt = post.cancelledAt || new Date();
  await post.save();

  const type = post.status === "published" ? "published" : post.status === "cancelled" ? "cancelled" : post.status === "failed" || post.status === "partial" ? "failed" : "scheduled";
  await createWebhookActivity({
    user: post.user,
    type,
    message: post.status === "published"
      ? `Published post to ${post.platforms.join(", ")}`
      : post.status === "cancelled"
        ? `Cancelled post to ${post.platforms.join(", ")}`
        : post.status === "partial"
          ? `Some platforms failed while publishing to ${post.platforms.join(", ")}`
          : post.status === "failed"
            ? `Publishing failed for ${post.platforms.join(", ")}`
            : `Post status changed to ${post.status}`,
    relatedPost: post._id,
    platforms: post.platforms,
    eventId,
  });
};

const onPlatformOutcome = async (payload, eventId) => {
  const providerPostId = postIdFrom(payload);
  if (!providerPostId) return;
  const post = await Post.findOne({ zernioPostId: providerPostId });
  if (!post) return;

  const platformPayload = payload.platform || payload.result || payload.post?.platform || {};
  const result = {
    platform: platformPayload.platform || payload.platformName,
    accountId: accountIdFrom(platformPayload.account || platformPayload),
    platformPostId: platformPayload.platformPostId || platformPayload.id || null,
    platformPostUrl: platformPayload.platformPostUrl || platformPayload.url || null,
    status: payload.event === "post.platform.published" || payload.event === "post.tiktok.url_resolved" ? "published" : payload.event === "post.platform.deleted" ? "cancelled" : "failed",
    errorMessage: platformPayload.errorMessage || platformPayload.error,
  };
  mergePlatformResults(post, [result]);
  post.status = aggregateStatus(post.zernioResults, post.status);
  post.lastSyncedAt = new Date();
  if (post.status === "published") post.publishedAt = post.publishedAt || new Date();
  if (result.status === "failed") post.lastError = result.errorMessage || "Platform publishing failed.";
  await post.save();

  await createWebhookActivity({
    user: post.user,
    type: result.status === "published" ? "published" : result.status === "failed" ? "failed" : "cancelled",
    message: `${result.platform || "Platform"} ${result.status}`,
    relatedPost: post._id,
    platforms: result.platform ? [result.platform] : post.platforms,
    eventId,
  });
};
