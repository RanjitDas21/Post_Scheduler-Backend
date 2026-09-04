import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";

export const verifyUser = async (req, res, next) => {
    const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "Unauthorized Request - No token found" });
    }

    try {
      const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decodedToken?.id).select("-password");

      if(!user) {
          return res.status(401).json({message: "Invalid Token - User not found"})
      }

      req.user = user;
      next();
  } catch (error) {
      console.log("Error in verifyUser middleware", error);
      return res.status(501).json({message: "Internal server error"});
  }
}
