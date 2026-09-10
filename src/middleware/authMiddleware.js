import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Not authorized. Please sign in." });
    }

    const token = authHeader.slice(7).trim();
    if (!token) return res.status(401).json({ message: "Not authorized. Please sign in." });
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured.");

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "loop-api",
      audience: "loop-client",
    });
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: "Session expired. Please sign in again." });

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Session invalid. Please sign in again." });
  }
};
