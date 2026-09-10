import Post from "../models/Post.js";
import Account from "../models/Account.js";
import Activity from "../models/Activity.js";

export const getDashboard = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const [scheduledCount, scheduledToday, publishedCount, connectedCount, recentActivity] = await Promise.all([
      Post.countDocuments({ user: userId, status: "scheduled" }),
      Post.countDocuments({ user: userId, status: "scheduled", scheduledAt: { $gte: startOfToday, $lt: endOfToday } }),
      Post.countDocuments({ user: userId, status: "published" }),
      Account.countDocuments({ user: userId, status: "connected" }),
      Activity.find({ user: userId }).sort({ createdAt: -1 }).limit(8),
    ]);

    res.json({
      stats: { scheduledPosts: scheduledCount, scheduledToday, publishedPosts: publishedCount, connectedAccounts: connectedCount },
      recentActivity,
    });
  } catch (err) {
    next(err);
  }
};
