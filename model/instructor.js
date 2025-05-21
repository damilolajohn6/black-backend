const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const validator = require("validator");

const instructorSchema = new mongoose.Schema({
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
  phoneNumber: {
    countryCode: {
      type: String,
      required: [true, "Phone country code is required"],
      match: [/^\+\d{1,3}$/, "Invalid country code (e.g., +1, +44)"],
    },
    number: {
      type: String,
      required: [true, "Phone number is required"],
      match: [/^\d{7,15}$/, "Phone number must be 7-15 digits"],
    },
  },
  email: {
    type: String,
    required: [true, "Please provide your email"],
    unique: true,
    lowercase: true,
    trim: true,
    validate: [validator.isEmail, "Please provide a valid email"],
  },
  password: {
    type: String,
    required: [true, "Please enter your password"],
    minLength: [6, "Password should be greater than 6 characters"],
    select: false,
  },
  bio: {
    type: String,
    trim: true,
    maxlength: [1000, "Bio cannot exceed 1000 characters"],
  },
  expertise: {
    type: [String],
    default: [],
    validate: {
      validator: function (arr) {
        return arr.every(
          (item) => typeof item === "string" && item.length <= 50
        );
      },
      message:
        "Expertise items must be strings and cannot exceed 50 characters",
    },
  },
  socialLinks: {
    website: {
      type: String,
      validate: {
        validator: function (v) {
          return !v || validator.isURL(v);
        },
        message: "Invalid website URL",
      },
    },
    linkedin: {
      type: String,
      validate: {
        validator: function (v) {
          return !v || validator.isURL(v);
        },
        message: "Invalid LinkedIn URL",
      },
    },
    twitter: {
      type: String,
      validate: {
        validator: function (v) {
          return !v || validator.isURL(v);
        },
        message: "Invalid Twitter URL",
      },
    },
  },
  avatar: {
    public_id: {
      type: String,
    },
    url: {
      type: String,
    },
  },
  role: {
    type: String,
    default: "Instructor",
    enum: ["Instructor"],
  },
  approvalStatus: {
    isInstructorApproved: { type: Boolean, default: false },
    approvalReason: { type: String, default: "" },
    approvedAt: { type: Date },
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
  passwordResetOtp: String,
  passwordResetOtpExpiry: Date,
});

// Hash password
instructorSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }
  console.debug("Hashing password for instructor:", { email: this.email });
  try {
    this.password = await bcrypt.hash(this.password, 10);
    console.debug("Password hashed successfully:", { email: this.email });
    next();
  } catch (error) {
    console.error("PASSWORD HASH ERROR:", error);
    next(error);
  }
});

// JWT token
instructorSchema.methods.getJwtToken = function () {
  console.debug("getJwtToken called for instructor:", { id: this._id });
  const token = jwt.sign(
    { id: this._id, model: "Instructor" },
    process.env.JWT_SECRET_KEY,
    {
      expiresIn: process.env.JWT_EXPIRES || "7d",
    }
  );
  console.debug("Token generated:", { token });
  return token;
};

// Compare password
instructorSchema.methods.comparePassword = async function (enteredPassword) {
  console.debug("comparePassword called:", { enteredPassword });
  const isValid = await bcrypt.compare(enteredPassword, this.password);
  console.debug("Password comparison result:", { isValid });
  return isValid;
};

// Password reset OTP
instructorSchema.methods.createPasswordResetOtp = function () {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.passwordResetOtp = otp;
  this.passwordResetOtpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  return otp;
};

module.exports = mongoose.model("Instructor", instructorSchema);
