const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const validator = require("validator");

const shopSchema = new mongoose.Schema({
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
  name: {
    type: String,
    required: [true, "Please enter your shop name"],
    trim: true,
    maxlength: [100, "Shop name cannot exceed 100 characters"],
  },
  email: {
    type: String,
    required: [true, "Please provide your email"],
    lowercase: true,
    validate: [validator.isEmail, "Please provide a valid email"],
  },
  password: {
    type: String,
    required: [true, "Please enter your password"],
    minLength: [6, "Password should be greater than 6 characters"],
    select: false,
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, "Description cannot exceed 500 characters"],
  },
  address: {
    type: String,
    required: true,
  },
  phoneNumber: {
    countryCode: {
      type: String,
      match: [/^\+\d{1,3}$/, "Invalid country code (e.g., +1, +44)"],
    },
    number: {
      type: String,
      match: [/^\d{7,15}$/, "Phone number must be 7-15 digits"],
    },
  },
  role: {
    type: String,
    default: "Seller",
    enum: ["Seller", "Admin"],
  },
  avatar: {
    public_id: { type: String, required: false },
    url: { type: String, required: true },
  },
  approvalStatus: {
    isSellerApproved: { type: Boolean, default: false },
    approvalReason: { type: String, default: "" },
    approvedAt: { type: Date },
  },
  zipCode: {
    type: String,
    required: true,
  },
  withdrawMethod: {
    type: {
      type: String,
      enum: ["BankTransfer", "PayPal", "Other"],
    },
    details: {
      type: Object,
    },
  },
  availableBalance: {
    type: Number,
    default: 0,
    min: [0, "Available balance cannot be negative"],
  },
  pendingBalance: {
    type: Number,
    default: 0,
    min: [0, "Pending balance cannot be negative"],
  },
  transactions: [
    {
      withdrawId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Withdraw",
      },
      amount: {
        type: Number,
        required: true,
      },
      type: {
        type: String,
        enum: ["Withdrawal", "Deposit", "Refund"],
        required: true,
      },
      status: {
        type: String,
        enum: ["Processing", "Approved", "Rejected", "Succeeded", "Failed"],
        default: "Processing",
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
      updatedAt: {
        type: Date,
      },
      metadata: {
        type: Object,
        default: {},
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  verificationOtp: String,
  verificationOtpExpiry: Number,
  isVerified: { type: Boolean, default: false },
  resetPasswordToken: String,
  resetPasswordTime: Date,
});

// Hash password
shopSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    next();
  }
  this.password = await bcrypt.hash(this.password, 10);
});

// JWT token
shopSchema.methods.getJwtToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET_KEY, {
    expiresIn: process.env.JWT_EXPIRES,
  });
};

// Compare password
shopSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Password reset OTP
shopSchema.methods.createPasswordResetToken = function () {
  const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
  this.resetPasswordToken = resetToken;
  this.resetPasswordTime = Date.now() + 10 * 60 * 1000; // 10 minutes
  return resetToken;
};

// Indexes for faster queries
shopSchema.index({ email: 1 });
shopSchema.index({ name: 1 });

module.exports = mongoose.model("Shop", shopSchema);
