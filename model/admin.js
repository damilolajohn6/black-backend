const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const validator = require("validator");

const adminSchema = new mongoose.Schema({
  fullname: {
    firstName: {
      type: String,
      required: [true, "Please enter your first name"],
      trim: true,
      maxlength: [50, "First name cannot exceed 50 characters"],
    },
    lastName: {
      type: String,
      required: [true, "Please enter your last name"],
      trim: true,
      maxlength: [50, "Last name cannot exceed 50 characters"],
    },
    middleName: {
      type: String,
      trim: true,
      maxlength: [50, "Middle name cannot exceed 50 characters"],
    },
  },
  email: {
    type: String,
    required: [true, "Please provide your email"],
    trim: true,
    lowercase: true,
    validate: [validator.isEmail, "Please provide a valid email"],
  },
  password: {
    type: String,
    required: [true, "Please enter your password"],
    minLength: [6, "Password should be greater than 6 characters"],
    select: false,
  },
  role: {
    type: String,
    default: "Admin",
    enum: ["Admin", "SuperAdmin", "Moderator"], // Support multiple admin roles
  },
  permissions: {
    type: [String],
    default: ["manage_sellers", "manage_withdrawals", "view_reports"],
    enum: [
      "manage_sellers",
      "manage_withdrawals",
      "manage_users",
      "view_reports",
      "manage_settings",
    ], // Define specific permissions
  },
  avatar: {
    public_id: { type: String },
    url: { type: String, default: "" },
  },
  lastLogin: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  verificationOtp: {
    type: String,
  },
  verificationOtpExpiry: {
    type: Number,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  resetPasswordToken: {
    type: String,
  },
  resetPasswordTime: {
    type: Date,
  },
});

// Hash password
adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    next();
  }
  this.password = await bcrypt.hash(this.password, 10);
});

// Update lastLogin on login (call this in login route)
adminSchema.methods.updateLastLogin = async function () {
  this.lastLogin = new Date();
  await this.save();
};

// JWT token
adminSchema.methods.getJwtToken = function () {
  return jwt.sign(
    { id: this._id, model: "Admin" },
    process.env.JWT_SECRET_KEY,
    {
      expiresIn: process.env.JWT_EXPIRES,
    }
  );
};

// Compare password
adminSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Password reset OTP
adminSchema.methods.createPasswordResetToken = function () {
  const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
  this.resetPasswordToken = resetToken;
  this.resetPasswordTime = Date.now() + 10 * 60 * 1000; // 10 minutes
  return resetToken;
};

// Indexes for faster queries
adminSchema.index({ email: 1 });

module.exports = mongoose.model("Admin", adminSchema);
