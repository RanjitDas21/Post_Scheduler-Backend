/**
 * Zernio integration. The public API contract is kept behind this service so
 * controllers and the scheduler remain independent from provider details.
 */

const isLive = () => process.env.ZERNIO_MODE === "live" && !!process.env.ZERNIO_API_KEY;
const baseUrl = () => (process.env.ZERNIO_API_BASE_URL || "https://zernio.com/api/v1").replace(/\/$/, "");
const headers = (requestId) => ({
  Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`,
  "Content-Type": "application/json",
  ...(requestId ? { "x-request-id": requestId } : {}),
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const platformMeta = {
  twitter: { label: "Twitter / X" },
  linkedin: { label: "LinkedIn" },
  facebook: { label: "Facebook" },
  instagram: { label: "Instagram" },
};

const request = async (method, path, body, { requestId, timeoutMs = 20000 } = {}) => {
  if (!isLive()) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: headers(requestId),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const error = new Error(err.name === "AbortError" ? "Zernio request timed out." : `Zernio network error: ${err.message}`);
    error.retryable = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Zernio request failed (${response.status})`);
    error.status = response.status;
    error.code = data?.code || data?.details?.code || null;
    error.details = data?.details;
    error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    error.retryAfter = response.headers.get("retry-after") || null;
    throw error;
  }

  return { data, status: response.status };
};

export const createProfile = async ({ name, description }) => {
  if (isLive()) {
    const { data } = await request("POST", "/profiles", { name, description });
    return { profileId: data.profile?._id || data.profile?.id };
  }
  await delay(50);
  return { profileId: `mock_profile_${Math.random().toString(36).slice(2, 10)}` };
};

export const getConnectUrl = async ({ platform, profileId, redirectUrl }) => {
  if (!platformMeta[platform]) throw new Error(`Unsupported platform: ${platform}`);
  if (isLive()) {
    const query = new URLSearchParams({ profileId, redirect_url: redirectUrl });
    const { data } = await request("GET", `/connect/${platform}?${query.toString()}`);
    return { authUrl: data.authUrl };
  }
  await delay(50);
  return { authUrl: null };
};

export const listAccounts = async ({ profileId }) => {
  if (isLive()) {
    // Explicit pagination avoids relying on provider defaults and keeps this
    // compatible with Zernio's current pagination contract.
    const { data } = await request("GET", `/accounts?profileId=${encodeURIComponent(profileId)}&page=1&limit=100`);
    return data.accounts || [];
  }
  await delay(50);
  return [];
};

export const deleteAccount = async ({ zernioAccountId }) => {
  if (isLive()) {
    await request("DELETE", `/accounts/${encodeURIComponent(zernioAccountId)}`);
    return true;
  }
  await delay(50);
  return true;
};

export const createPost = async ({ content, mediaUrl, accounts, scheduledAt, timezone, publishNow, requestId }) => {
  const platforms = accounts.map((a) => ({ platform: a.platform, accountId: a.zernioAccountId }));
  if (isLive()) {
    const body = {
      content,
      platforms,
      ...(mediaUrl ? { mediaUrls: [mediaUrl] } : {}),
      ...(publishNow
        ? { publishNow: true }
        : { scheduledFor: scheduledAt.toISOString(), timezone: timezone || "UTC" }),
    };
    const { data, status } = await request("POST", "/posts", body, { requestId });
    const post = data.post || data.existingPost;
    return {
      zernioPostId: post?._id || post?.id,
      status: post?.status || (status === 207 ? "partial" : "scheduled"),
      platforms: post?.platforms || [],
      existing: Boolean(data.existingPost),
    };
  }
  await delay(100);
  return {
    zernioPostId: `mock_post_${Math.random().toString(36).slice(2, 10)}`,
    status: publishNow ? "published" : "scheduled",
    platforms: platforms.map((p) => ({ ...p, status: publishNow ? "published" : "scheduled" })),
  };
};

export const getPost = async ({ zernioPostId }) => {
  if (isLive()) {
    const { data } = await request("GET", `/posts/${encodeURIComponent(zernioPostId)}`);
    return data.post;
  }
  await delay(50);
  return { status: "published", platforms: [] };
};

export const updatePost = async ({ zernioPostId, profileId, accounts, scheduledAt, timezone, publishNow }) => {
  if (!isLive()) return { status: publishNow ? "published" : "scheduled" };
  const body = {
    profileId,
    platforms: accounts.map((a) => ({ platform: a.platform, accountId: a.zernioAccountId })),
    ...(publishNow ? { publishNow: true, isDraft: false } : { scheduledFor: scheduledAt.toISOString(), timezone: timezone || "UTC", isDraft: false }),
  };
  const { data } = await request("PUT", `/posts/${encodeURIComponent(zernioPostId)}`, body);
  return data.post || data;
};

export const cancelPost = async ({ zernioPostId }) => {
  if (!isLive()) return true;
  await request("DELETE", `/posts/${encodeURIComponent(zernioPostId)}`);
  return true;
};

export const retryPost = async ({ zernioPostId, requestId }) => {
  if (!isLive()) return { status: "published" };
  const { data } = await request("POST", `/posts/${encodeURIComponent(zernioPostId)}/retry`, {}, { requestId });
  return data.post || data;
};

export const getPlatformMeta = () => platformMeta;

export default {
  createProfile,
  getConnectUrl,
  listAccounts,
  deleteAccount,
  createPost,
  getPost,
  updatePost,
  cancelPost,
  retryPost,
  getPlatformMeta,
  isLive,
};
