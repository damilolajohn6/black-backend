require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const validator = require("validator");
const crypto = require("crypto");

const userSchema = new mongoose.Schema({
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
  username: {
    type: String,
    required: [true, "Please enter your name!"],
  },
  email: {
    type: String,
    required: [true, "Please provide your email"],
    unique: true,
    lowercase: true,
    validate: [validator.isEmail, "Please provide a valid email"],
  },
  password: {
    type: String,
    required: [true, "Please enter your password"],
    minLength: [6, "Password should be at least 6 characters"],
    select: false,
  },
  phoneNumber: {
    countryCode: {
      type: String,
      required: false,
      match: [/^\+\d{1,3}$/, "Invalid country code (e.g., +1, +44)"],
    },
    number: {
      type: String,
      required: false,
      match: [/^\d{7,15}$/, "Phone number must be 7-15 digits"],
    },
  },
  addresses: [
    {
      country: { type: String },
      city: { type: String },
      address1: { type: String },
      address2: { type: String },
      zipCode: { type: Number },
      addressType: { type: String },
    },
  ],
  role: {
    type: String,
    enum: ["user", "seller", "instructor", "serviceProvider", "admin"],
    default: "user",
  },
  approvalStatus: {
    isSellerApproved: { type: Boolean, default: false },
    isInstructorApproved: { type: Boolean, default: false },
    isServiceProviderApproved: { type: Boolean, default: false },
  },
  avatar: {
    public_id: { type: String, required: false },
    url: { type: String, required: false },
  },
  verificationOtp: { type: String },
  verificationOtpExpiry: { type: Number },
  isVerified: { type: Boolean, default: false },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  resetPasswordOtp: { type: String },
  resetPasswordOtpExpiry: { type: Number },
});

// Hash password
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// JWT token
userSchema.methods.getJwtToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET_KEY, {
    expiresIn: process.env.JWT_EXPIRES,
  });
};

// Compare password
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Create password reset OTP
userSchema.methods.createPasswordResetOtp = function () {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.resetPasswordOtp = otp;
  this.resetPasswordOtpExpiry = Date.now() + 10 * 60 * 1000;
  return otp;
};

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });

module.exports = mongoose.model("User", userSchema);
