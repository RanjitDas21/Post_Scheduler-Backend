/**
 * Seeds the database with one sample user + connected accounts + posts
 * + activity, so the dashboard has something to show on first run.
 *
 * Run with: npm run seed
 * Demo login: demo@loop.app / password123
 */
import dotenv from "dotenv";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Account from "../models/Account.js";
import Post from "../models/Post.js";
import Activity from "../models/Activity.js";

dotenv.config();

const run = async () => {
  if (process.env.NODE_ENV === "production") throw new Error("Seed is disabled in production.");
  await connectDB();

  await Promise.all([
    User.deleteMany({ email: "demo@loop.app" }),
  ]);

  const user = await User.create({
    name: "Demo User",
    email: "demo@loop.app",
    password: "password123",
    avatarColor: "#C1583A",
  });

  await Account.deleteMany({ user: user._id });
  await Post.deleteMany({ user: user._id });
  await Activity.deleteMany({ user: user._id });

  const linkedin = await Account.create({
    user: user._id,
    platform: "linkedin",
    displayName: "Demo User",
    handle: "in/demo-user",
    zernioAccountId: "mock_linkedin_demo",
    status: "connected",
  });

  const now = Date.now();

  const posts = await Post.insertMany([
    {
      user: user._id,
      content: "This is a test post, please ignore.",
      platforms: ["linkedin"],
      mediaUrl: null,
      mediaType: null,
      scheduledAt: new Date(now - 1000 * 60 * 60 * 24),
      status: "published",
      publishedAt: new Date(now - 1000 * 60 * 60 * 24),
      zernioResults: [{ platform: "linkedin", externalPostId: "mock_post_1", status: "success" }],
    },
    {
      user: user._id,
      content: "Test post.",
      platforms: ["instagram"],
      mediaUrl: null,
      mediaType: null,
      scheduledAt: new Date(now - 1000 * 60 * 60 * 20),
      status: "published",
      publishedAt: new Date(now - 1000 * 60 * 60 * 20),
      zernioResults: [{ platform: "instagram", externalPostId: "mock_post_2", status: "success" }],
    },
    {
      user: user._id,
      content:
        "We are thrilled to announce the official launch of our new, comprehensive AI course! Designed for professionals and aspiring innovators, this program offers an in-depth look at building real products with modern AI tools.",
      platforms: ["linkedin", "instagram"],
      mediaUrl: "https://picsum.photos/seed/loop-launch/800/800",
      mediaType: "image",
      source: "ai",
      tone: "Professional",
      scheduledAt: new Date(now - 1000 * 60 * 60 * 3),
      status: "published",
      publishedAt: new Date(now - 1000 * 60 * 60 * 3),
      zernioResults: [
        { platform: "linkedin", externalPostId: "mock_post_3a", status: "success" },
        { platform: "instagram", externalPostId: "mock_post_3b", status: "success" },
      ],
    },
    {
      user: user._id,
      content: "Sneak peek of next week's feature drop \u2014 stay tuned!",
      platforms: ["linkedin"],
      scheduledAt: new Date(now + 1000 * 60 * 60 * 24 * 2),
      status: "scheduled",
    },
  ]);

  await Activity.insertMany([
    {
      user: user._id,
      type: "published",
      message: "Published post to linkedin, instagram",
      relatedPost: posts[2]._id,
      platforms: ["linkedin", "instagram"],
      createdAt: new Date(now - 1000 * 60 * 60 * 3),
    },
    {
      user: user._id,
      type: "published",
      message: "Published post to instagram",
      relatedPost: posts[1]._id,
      platforms: ["instagram"],
      createdAt: new Date(now - 1000 * 60 * 60 * 20),
    },
    {
      user: user._id,
      type: "published",
      message: "Published post to linkedin",
      relatedPost: posts[0]._id,
      platforms: ["linkedin"],
      createdAt: new Date(now - 1000 * 60 * 60 * 24),
    },
    {
      user: user._id,
      type: "connected",
      message: "Connected LinkedIn",
      platforms: ["linkedin"],
      createdAt: new Date(now - 1000 * 60 * 60 * 30),
    },
  ]);

  console.log("Seed complete.");
  console.log("Demo login -> email: demo@loop.app / password: password123");
  console.log(`Connected account: ${linkedin.platform}`);
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
