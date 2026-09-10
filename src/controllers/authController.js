import User from "../models/User.js";
import Activity from "../models/Activity.js";
import generateToken from "../utils/generateToken.js";
import zernio from "../services/zernioService.js";

const avatarPalette = ["#C1583A", "#2F6F62", "#D98C3D", "#5B6FA8", "#A5455C"];
const randomColor = () => avatarPalette[Math.floor(Math.random() * avatarPalette.length)];

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

export const signup = async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are all required." });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address." });
    if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters." });

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: "An account with this email already exists." });

    const user = await User.create({ name, email, password, avatarColor: randomColor() });

    try {
      const { profileId } = await zernio.createProfile({
        name: `loop_user_${user._id}`,
        description: user.email,
      });
      user.zernioProfileId = profileId;
      await user.save();
    } catch (err) {
      // Signup remains available if the provider is temporarily unavailable;
      // account connection retries profile creation later.
      console.error("Zernio profile creation failed at signup:", err.message);
    }

    await Activity.create({
      user: user._id,
      type: "connected",
      message: "Welcome to Loop! Your workspace is ready.",
    });

    res.status(201).json({ token: generateToken(user._id), user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

export const login = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    if (!email || !password) return res.status(400).json({ message: "Email and password are required." });

    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "That email and password don't match." });
    }

    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    res.json({ token: generateToken(user._id), user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

export const getMe = async (req, res) => {
  res.json({ user: req.user.toSafeObject() });
};
