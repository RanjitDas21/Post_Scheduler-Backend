import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Account from "../models/Account.js";
import Activity from "../models/Activity.js";
import zernio from "../services/zernioService.js";
import { getAppBaseUrl } from "../utils/appUrl.js";

const buildOAuthState = ({ userId, platform }) =>
  jwt.sign({ purpose: "zernio-oauth", userId: String(userId), platform }, process.env.JWT_SECRET, {
    expiresIn: "10m",
  });

const readOAuthState = (state) => {
  const decoded = jwt.verify(state, process.env.JWT_SECRET);
  if (decoded.purpose !== "zernio-oauth" || !decoded.userId || !decoded.platform) {
    throw new Error("Invalid OAuth state.");
  }
  return decoded;
};

const ensureZernioProfile = async (user) => {
  if (user.zernioProfileId) return user.zernioProfileId;
  const { profileId } = await zernio.createProfile({
    name: `loop_user_${user._id}`,
    description: user.email,
  });
  user.zernioProfileId = profileId;
  await user.save();
  return profileId;
};

export const listAccounts = async (req, res, next) => {
  try {
    const accounts = await Account.find({ user: req.user._id }).sort({ connectedAt: -1 });
    const meta = zernio.getPlatformMeta();
    const allPlatforms = Object.keys(meta);

    res.json({
      accounts,
      platforms: allPlatforms.map((platform) => ({
        platform,
        label: meta[platform].label,
        connected: accounts.some((a) => a.platform === platform && a.status === "connected"),
      })),
    });
  } catch (err) {
    next(err);
  }
};

export const connectAccount = async (req, res, next) => {
  try {
    const { platform } = req.body;
    const meta = zernio.getPlatformMeta();

    if (!meta[platform]) return res.status(400).json({ message: "Unsupported platform." });

    if (zernio.isLive()) {
      const profileId = await ensureZernioProfile(req.user);
      const state = buildOAuthState({ userId: req.user._id, platform });
      const redirectUrl = `${getAppBaseUrl()}/api/accounts/callback?state=${encodeURIComponent(state)}`;
      const { authUrl } = await zernio.getConnectUrl({ platform, profileId, redirectUrl });
      return res.json({ authUrl });
    }

    // Mock mode remains useful for local development and preserves the original
    // one-click demo flow, while still allowing multiple accounts per platform.
    const account = await Account.create({
      user: req.user._id,
      platform,
      displayName: "You",
      handle: "@you",
      zernioAccountId: `mock_${platform}_${Math.random().toString(36).slice(2, 9)}`,
      status: "connected",
      lastSyncedAt: new Date(),
    });

    await Activity.create({
      user: req.user._id,
      type: "connected",
      message: `Connected ${meta[platform].label}`,
      platforms: [platform],
    });

    res.status(201).json({ account });
  } catch (err) {
    next(err);
  }
};

export const zernioCallback = async (req, res) => {
  const clientUrl = (process.env.CLIENT_URL || "http://localhost:5173").split(",")[0].trim();
  const { state, accountId, connected, platform: queryPlatform, username } = req.query;

  try {
    if (!state) throw new Error("Missing OAuth state.");
    const { userId, platform } = readOAuthState(state);
    const user = await User.findById(userId);
    if (!user || !user.zernioProfileId) throw new Error("Could not match this connection to a Loop account.");

    const resolvedPlatform = platform || queryPlatform;
    if (connected === "false" || req.query.error) {
      return res.redirect(`${clientUrl}/dashboard/accounts?error=connection_cancelled`);
    }

    let matched = null;
    if (accountId) {
      const accounts = await zernio.listAccounts({ profileId: user.zernioProfileId });
      matched = accounts.find((a) => String(a._id || a.accountId) === String(accountId));
    } else {
      const accounts = await zernio.listAccounts({ profileId: user.zernioProfileId });
      matched = accounts.filter((a) => a.platform === resolvedPlatform).at(-1);
    }

    if (!matched) return res.redirect(`${clientUrl}/dashboard/accounts?error=connection_cancelled`);

    const providerAccountId = matched._id || matched.accountId;
    const displayName = matched.username || matched.displayName || username || "Connected account";
    const handle = matched.username ? `@${matched.username}` : "";

    const account = await Account.findOneAndUpdate(
      { user: user._id, zernioAccountId: providerAccountId },
      {
        user: user._id,
        platform: matched.platform || resolvedPlatform,
        displayName,
        handle,
        zernioAccountId: providerAccountId,
        status: "connected",
        lastError: null,
        disconnectedAt: null,
        lastSyncedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await Activity.create({
      user: user._id,
      type: "connected",
      message: `Connected ${zernio.getPlatformMeta()[account.platform]?.label || account.platform}`,
      platforms: [account.platform],
    });

    res.redirect(`${clientUrl}/dashboard/accounts?connected=${account.platform}`);
  } catch (err) {
    console.error("Zernio callback error:", err.message);
    res.redirect(`${clientUrl}/dashboard/accounts?error=connection_failed`);
  }
};

export const disconnectAccount = async (req, res, next) => {
  try {
    const account = await Account.findOne({ _id: req.params.id, user: req.user._id });
    if (!account) return res.status(404).json({ message: "Account not found." });

    await zernio.deleteAccount({ zernioAccountId: account.zernioAccountId });
    account.status = "disconnected";
    account.disconnectedAt = new Date();
    account.lastSyncedAt = new Date();
    await account.save();

    await Activity.create({
      user: req.user._id,
      type: "disconnected",
      message: `Disconnected ${account.platform}`,
      platforms: [account.platform],
    });

    res.json({ message: "Account disconnected.", account });
  } catch (err) {
    next(err);
  }
};
