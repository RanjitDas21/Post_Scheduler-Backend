import mongoose from "mongoose";
import "../models/Account.js";
import "../models/Post.js";
import "../models/Activity.js";

const connectDB = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    // The original MVP enforced one account per platform. Remove that legacy
    // index so existing databases can safely adopt the provider-account model.
    try {
      await conn.connection.collection("accounts").dropIndex("user_1_platform_1");
    } catch (err) {
      if (!String(err?.message || "").includes("index not found")) console.warn("Legacy Account index migration skipped:", err.message);
    }
    await mongoose.model("Account").syncIndexes();
    await mongoose.model("Post").syncIndexes();
    await mongoose.model("Activity").syncIndexes();
    mongoose.connection.on("error", (err) => console.error("MongoDB error:", err.message));
    mongoose.connection.on("disconnected", () => console.error("MongoDB disconnected."));
  } catch (err) {
    console.error(`MongoDB connection failed: ${err.message}`);
    throw err;
  }
};

export default connectDB;
