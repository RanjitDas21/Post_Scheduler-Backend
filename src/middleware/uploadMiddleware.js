import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const uploadDir = path.resolve("uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// const storage = multer.diskStorage({
//   destination: (req, file, cb) => cb(null, uploadDir),
//   filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${path.extname(file.originalname).toLowerCase()}`),
// });

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "social-scheduler",
    resource_type: "auto",
  },
});


const allowed = new Map([
  [".jpeg", ["image/jpeg"]],
  [".jpg", ["image/jpeg"]],
  [".png", ["image/png"]],
  [".gif", ["image/gif"]],
  [".webp", ["image/webp"]],
  [".mp4", ["video/mp4"]],
  [".mov", ["video/quicktime"]],
  [".webm", ["video/webm"]],
]);

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimes = allowed.get(ext);
  if (!allowedMimes || !allowedMimes.includes(file.mimetype)) return cb(new Error("Only supported image or video files are allowed."));
  cb(null, true);
};

// const upload = multer({
//   storage,
//   fileFilter,
//   limits: { fileSize: 25 * 1024 * 1024, files: 1 },
// });

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
});

export default upload;
