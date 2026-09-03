import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const userSchema = new mongoose.Schema({
    fullName: { 
      type: String, 
      required: true, 
      trim: true },
    email: { 
      type: String, 
      required: true, 
      unique: true, 
      lowercase: true, 
      trim: true },
    password: { 
      type: String, 
      required: true, 
      minlength: 6
     },
  }, { timestamps: true }
);

userSchema.methods.generateAuthToken = function() {
    const token = jwt.sign(
        {
            id: this._id
        },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRY
        }
    )
    return token;
}


userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

userSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    avatarColor: this.avatarColor,
    plan: this.plan,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model("User", userSchema);
