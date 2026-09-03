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


userSchema.statics.hashPassword = async function(password) {
  return await bcrypt.hash(password, 10);
}

userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

export const User = mongoose.model("User", userSchema);
